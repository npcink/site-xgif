import { createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function portablePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function parseOperationDetails(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const maintenanceActions = new Set(["index_sync", "rebuild"]);

export function parseContentDocument(content) {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const raw = match?.[1] || "";
  const body = match?.[2] || "";
  const data = {};

  for (const line of raw.split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!field) continue;
    const [, key, rawValue] = field;
    const value = rawValue.trim();
    if (value === "true" || value === "false") {
      data[key] = value === "true";
      continue;
    }
    if (value.startsWith('"') || value.startsWith("[") || value.startsWith("{")) {
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = value.replace(/^['"]|['"]$/g, "");
      }
      continue;
    }
    data[key] = value;
  }

  return { data, body };
}

async function listFilesRecursively(directory, predicate) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listFilesRecursively(entryPath, predicate)));
      } else if (predicate(entryPath)) {
        files.push(entryPath);
      }
    }
    return files;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function moveIfExists(source, destination) {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export class LocalDataStore {
  constructor({
    repoRoot,
    workflowRoot,
    databasePath = path.join(workflowRoot, ".runtime", "xgif.sqlite3"),
    migrationsDir = path.join(workflowRoot, "db", "migrations"),
    backupsDir = path.join(workflowRoot, "backups"),
    articlesDir = path.join(repoRoot, "site", "src", "content", "articles"),
    imagesDir = path.join(repoRoot, "site", "src", "content", "images"),
    trashDir = path.join(workflowRoot, "trash", "content"),
  }) {
    this.repoRoot = repoRoot;
    this.workflowRoot = workflowRoot;
    this.databasePath = databasePath;
    this.migrationsDir = migrationsDir;
    this.backupsDir = backupsDir;
    this.articlesDir = articlesDir;
    this.imagesDir = imagesDir;
    this.trashDir = trashDir;
    this.db = null;
    this.recovery = null;
  }

  async initialize() {
    await mkdir(path.dirname(this.databasePath), { recursive: true });
    try {
      this.db = new DatabaseSync(this.databasePath);
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.assertHealthy();
    } catch (error) {
      try {
        this.db?.close();
      } catch {
        // The handle may already be unusable.
      }
      this.db = null;
      this.recovery = await this.quarantineCorruptDatabase(error);
      this.db = new DatabaseSync(this.databasePath);
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA journal_mode = WAL");
    }

    const appliedMigrations = await this.applyMigrations();
    const indexed = this.db.prepare("SELECT COUNT(*) AS count FROM content_index").get().count;
    if (this.recovery?.recovered || appliedMigrations.length || indexed === 0) {
      await this.rebuildAll();
    } else {
      const content = await this.syncContentIndex();
      const trash = await this.rebuildTrashIndex();
      if (content.changed || content.removed) {
        this.recordOperation("index_sync", { ...content, trash });
      }
    }
    return this.getStatus();
  }

  assertHealthy() {
    const result = this.db.prepare("PRAGMA quick_check").get();
    if (result?.quick_check !== "ok") {
      throw new Error(`SQLite quick_check failed: ${result?.quick_check || "unknown"}`);
    }
  }

  async quarantineCorruptDatabase(cause) {
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    const quarantinePath = `${this.databasePath}.corrupt-${suffix}`;
    const moved = await moveIfExists(this.databasePath, quarantinePath);
    await moveIfExists(`${this.databasePath}-wal`, `${quarantinePath}-wal`);
    await moveIfExists(`${this.databasePath}-shm`, `${quarantinePath}-shm`);
    return {
      recovered: true,
      cause: String(cause?.message || cause),
      quarantinePath: moved ? quarantinePath : "",
      recoveredAt: nowIso(),
    };
  }

  async applyMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const migrationFiles = (await readdir(this.migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const applied = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
    const markApplied = this.db.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    );

    const newlyApplied = [];
    for (const file of migrationFiles) {
      if (applied.get(file)) continue;
      const sql = await readFile(path.join(this.migrationsDir, file), "utf8");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(sql);
        markApplied.run(file, nowIso());
        this.db.exec("COMMIT");
        newlyApplied.push(file);
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    return newlyApplied;
  }

  async scanContentIndex() {
    const sources = [
      { type: "article", directory: this.articlesDir },
      { type: "image", directory: this.imagesDir },
    ];
    const records = [];

    for (const source of sources) {
      const files = await listFilesRecursively(
        source.directory,
        (file) => /\.mdx?$/i.test(file),
      );
      for (const file of files) {
        const [content, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
        const { data, body } = parseContentDocument(content);
        records.push({
          file: portablePath(path.relative(this.repoRoot, file)),
          contentType: source.type,
          title: String(data.title || "未命名内容"),
          summary: String(data.summary || data.description || ""),
          source: String(data.source || ""),
          tags: Array.isArray(data.tags) ? data.tags : [],
          pubDate: String(data.pubDate || ""),
          draft: Boolean(data.draft),
          public: data.public !== false,
          contentId: String(data.contentId || ""),
          bodyExcerpt: body.replace(/\s+/g, " ").trim().slice(0, 140),
          sha256: createHash("sha256").update(content).digest("hex"),
          size: fileStat.size,
          mtimeMs: Math.trunc(fileStat.mtimeMs),
        });
      }
    }
    return records;
  }

  async rebuildContentIndex() {
    const records = await this.scanContentIndex();
    const insert = this.db.prepare(`
      INSERT INTO content_index (
        file, content_type, title, summary, source, tags_json, pub_date,
        is_draft, is_public, content_id, body_excerpt, content_sha256,
        file_size, file_mtime_ms, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const indexedAt = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM content_index");
      for (const record of records) {
        insert.run(
          record.file,
          record.contentType,
          record.title,
          record.summary,
          record.source,
          JSON.stringify(record.tags),
          record.pubDate,
          record.draft ? 1 : 0,
          record.public ? 1 : 0,
          record.contentId,
          record.bodyExcerpt,
          record.sha256,
          record.size,
          record.mtimeMs,
          indexedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return records.length;
  }

  async syncContentIndex() {
    const sources = [
      { type: "article", directory: this.articlesDir },
      { type: "image", directory: this.imagesDir },
    ];
    const existingRows = this.db.prepare(
      "SELECT file, file_size AS fileSize, file_mtime_ms AS fileMtimeMs FROM content_index",
    ).all();
    const existing = new Map(existingRows.map((row) => [row.file, row]));
    const seen = new Set();
    const changed = [];

    for (const source of sources) {
      const files = await listFilesRecursively(source.directory, (file) => /\.mdx?$/i.test(file));
      for (const file of files) {
        const relativeFile = portablePath(path.relative(this.repoRoot, file));
        const fileStat = await stat(file);
        const size = fileStat.size;
        const mtimeMs = Math.trunc(fileStat.mtimeMs);
        seen.add(relativeFile);
        const previous = existing.get(relativeFile);
        if (previous && previous.fileSize === size && previous.fileMtimeMs === mtimeMs) continue;
        const content = await readFile(file, "utf8");
        const { data, body } = parseContentDocument(content);
        changed.push({
          file: relativeFile,
          contentType: source.type,
          title: String(data.title || "未命名内容"),
          summary: String(data.summary || data.description || ""),
          source: String(data.source || ""),
          tags: Array.isArray(data.tags) ? data.tags : [],
          pubDate: String(data.pubDate || ""),
          draft: Boolean(data.draft),
          public: data.public !== false,
          contentId: String(data.contentId || ""),
          bodyExcerpt: body.replace(/\s+/g, " ").trim().slice(0, 140),
          sha256: createHash("sha256").update(content).digest("hex"),
          size,
          mtimeMs,
        });
      }
    }

    const removed = existingRows.map((row) => row.file).filter((file) => !seen.has(file));
    if (!changed.length && !removed.length) return { changed: 0, removed: 0 };

    const upsert = this.db.prepare(`
      INSERT INTO content_index (
        file, content_type, title, summary, source, tags_json, pub_date,
        is_draft, is_public, content_id, body_excerpt, content_sha256,
        file_size, file_mtime_ms, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET
        content_type = excluded.content_type,
        title = excluded.title,
        summary = excluded.summary,
        source = excluded.source,
        tags_json = excluded.tags_json,
        pub_date = excluded.pub_date,
        is_draft = excluded.is_draft,
        is_public = excluded.is_public,
        content_id = excluded.content_id,
        body_excerpt = excluded.body_excerpt,
        content_sha256 = excluded.content_sha256,
        file_size = excluded.file_size,
        file_mtime_ms = excluded.file_mtime_ms,
        indexed_at = excluded.indexed_at
    `);
    const remove = this.db.prepare("DELETE FROM content_index WHERE file = ?");
    const indexedAt = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of changed) {
        upsert.run(
          record.file,
          record.contentType,
          record.title,
          record.summary,
          record.source,
          JSON.stringify(record.tags),
          record.pubDate,
          record.draft ? 1 : 0,
          record.public ? 1 : 0,
          record.contentId,
          record.bodyExcerpt,
          record.sha256,
          record.size,
          record.mtimeMs,
          indexedAt,
        );
      }
      for (const file of removed) remove.run(file);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { changed: changed.length, removed: removed.length };
  }

  listContentIndex({ type = "all", query = "", sort = "newest" } = {}) {
    const filters = [];
    const parameters = [];
    if (type === "article" || type === "image") {
      filters.push("content_type = ?");
      parameters.push(type);
    }
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (normalizedQuery) {
      filters.push("LOWER(title || ' ' || summary || ' ' || source || ' ' || tags_json) LIKE ?");
      parameters.push(`%${normalizedQuery}%`);
    }
    const orderBy = sort === "oldest"
      ? "pub_date ASC, file ASC"
      : sort === "title"
        ? "title COLLATE NOCASE ASC, file ASC"
        : "pub_date DESC, file ASC";
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT
        file,
        content_type AS type,
        title,
        summary,
        source,
        tags_json AS tagsJson,
        content_id AS contentId,
        pub_date AS pubDate,
        is_draft AS draft,
        is_public AS public,
        body_excerpt AS bodyExcerpt,
        content_sha256 AS contentSha256
      FROM content_index
      ${where}
      ORDER BY ${orderBy}
    `).all(...parameters).map((row) => ({
      file: row.file,
      type: row.type,
      title: row.title,
      summary: row.summary,
      source: row.source,
      tags: parseOperationDetails(row.tagsJson),
      contentId: row.contentId,
      pubDate: row.pubDate,
      draft: Boolean(row.draft),
      public: Boolean(row.public),
      bodyExcerpt: row.bodyExcerpt,
      contentSha256: row.contentSha256,
    }));
  }

  async scanTrashSidecars() {
    const metadataFiles = await listFilesRecursively(
      this.trashDir,
      (file) => file.endsWith(".meta.json"),
    );
    const records = [];
    for (const metadataFile of metadataFiles) {
      try {
        const record = JSON.parse(await readFile(metadataFile, "utf8"));
        const trashPath = path.resolve(this.repoRoot, String(record.trashFile || ""));
        const trashExists = await stat(trashPath).then(() => true).catch(() => false);
        records.push({
          ...record,
          metadataFile: portablePath(path.relative(this.repoRoot, metadataFile)),
          status: record.status === "restored" ? "restored" : trashExists ? "trashed" : "missing",
        });
      } catch {
        // Invalid sidecars are left on disk for manual inspection and ignored by the index.
      }
    }
    return records;
  }

  async rebuildTrashIndex() {
    const records = await this.scanTrashSidecars();
    const normalizedRecords = records.map((record) => ({
      id: String(record.id || ""),
      type: String(record.type || ""),
      file: String(record.file || ""),
      trashFile: String(record.trashFile || ""),
      metadataFile: String(record.metadataFile || ""),
      title: String(record.title || "未命名内容"),
      deletedAt: String(record.deletedAt || ""),
      restoredAt: record.restoredAt || null,
      status: String(record.status || ""),
      sha256: String(record.sha256 || ""),
      size: Number(record.size || 0),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const existingRecords = this.db.prepare(`
      SELECT
        id,
        content_type AS type,
        original_file AS file,
        trash_file AS trashFile,
        metadata_file AS metadataFile,
        title,
        deleted_at AS deletedAt,
        restored_at AS restoredAt,
        status,
        content_sha256 AS sha256,
        file_size AS size
      FROM trash_items
      ORDER BY id ASC
    `).all();
    if (JSON.stringify(existingRecords) === JSON.stringify(normalizedRecords)) {
      return records.length;
    }
    const insert = this.db.prepare(`
      INSERT INTO trash_items (
        id, content_type, original_file, trash_file, metadata_file, title,
        deleted_at, restored_at, status, content_sha256, file_size, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM trash_items");
      for (const record of normalizedRecords) {
        insert.run(
          record.id,
          record.type,
          record.file,
          record.trashFile,
          record.metadataFile,
          record.title,
          record.deletedAt,
          record.restoredAt || null,
          record.status,
          record.sha256,
          record.size,
          nowIso(),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return records.length;
  }

  async rebuildAll() {
    const [content, trash] = await Promise.all([
      this.rebuildContentIndex(),
      this.rebuildTrashIndex(),
    ]);
    this.recordOperation("rebuild", { content, trash });
    return { content, trash };
  }

  upsertTrashEntry(record) {
    this.db.prepare(`
      INSERT INTO trash_items (
        id, content_type, original_file, trash_file, metadata_file, title,
        deleted_at, restored_at, status, content_sha256, file_size, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        original_file = excluded.original_file,
        trash_file = excluded.trash_file,
        metadata_file = excluded.metadata_file,
        title = excluded.title,
        restored_at = excluded.restored_at,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.type,
      record.file,
      record.trashFile,
      record.metadataFile,
      record.title,
      record.deletedAt,
      record.restoredAt || null,
      record.status || "trashed",
      record.sha256,
      Number(record.size || 0),
      nowIso(),
    );
    this.recordOperation("trash", { id: record.id, file: record.file });
  }

  markTrashRestored(id, restoredAt) {
    this.db.prepare(`
      UPDATE trash_items
      SET status = 'restored', restored_at = ?, updated_at = ?
      WHERE id = ?
    `).run(restoredAt, nowIso(), id);
    this.recordOperation("restore", { id });
  }

  listTrashItems() {
    return this.db.prepare(`
      SELECT
        id,
        content_type AS type,
        original_file AS file,
        trash_file AS trashFile,
        metadata_file AS metadataFile,
        title,
        deleted_at AS deletedAt,
        content_sha256 AS sha256,
        file_size AS size
      FROM trash_items
      WHERE status = 'trashed'
      ORDER BY deleted_at DESC
    `).all();
  }

  listRecommendationEmbeddings({ model } = {}) {
    const normalizedModel = String(model || "").trim();
    if (!normalizedModel) return [];

    return this.db.prepare(`
      SELECT
        content_id AS contentId,
        content_type AS contentType,
        content_sha256 AS contentSha256,
        model,
        dimensions,
        vector_json AS vectorJson,
        updated_at AS updatedAt
      FROM recommendation_embeddings
      WHERE model = ?
      ORDER BY content_id ASC
    `).all(normalizedModel).flatMap((row) => {
      try {
        const vector = JSON.parse(row.vectorJson);
        if (
          !Array.isArray(vector)
          || vector.length !== row.dimensions
          || !vector.length
          || vector.some((value) => !Number.isFinite(value))
        ) {
          return [];
        }
        return [{ ...row, vector }];
      } catch {
        return [];
      }
    });
  }

  upsertRecommendationEmbedding({
    contentId,
    contentType,
    contentSha256,
    model,
    vector,
  }) {
    const record = {
      contentId: String(contentId || "").trim(),
      contentType: String(contentType || "").trim(),
      contentSha256: String(contentSha256 || "").trim(),
      model: String(model || "").trim(),
      vector,
    };
    if (!record.contentId || !record.contentSha256 || !record.model) {
      throw new TypeError("Embedding cache requires contentId, contentSha256, and model.");
    }
    if (!["article", "image"].includes(record.contentType)) {
      throw new TypeError("Embedding cache contentType must be article or image.");
    }
    if (
      !Array.isArray(record.vector)
      || !record.vector.length
      || record.vector.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError("Embedding cache vector must contain finite numbers.");
    }

    this.db.prepare(`
      INSERT INTO recommendation_embeddings (
        content_id, model, content_type, content_sha256,
        dimensions, vector_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(content_id, model) DO UPDATE SET
        content_type = excluded.content_type,
        content_sha256 = excluded.content_sha256,
        dimensions = excluded.dimensions,
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
    `).run(
      record.contentId,
      record.model,
      record.contentType,
      record.contentSha256,
      record.vector.length,
      JSON.stringify(record.vector),
      nowIso(),
    );
  }

  pruneRecommendationEmbeddings({ model, validContentIds = [] } = {}) {
    const normalizedModel = String(model || "").trim();
    if (!normalizedModel) return 0;
    const validIds = new Set(validContentIds.map((value) => String(value || "").trim()).filter(Boolean));
    const rows = this.db.prepare(`
      SELECT content_id AS contentId
      FROM recommendation_embeddings
      WHERE model = ?
    `).all(normalizedModel);
    const remove = this.db.prepare(`
      DELETE FROM recommendation_embeddings
      WHERE content_id = ? AND model = ?
    `);
    let removed = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (validIds.has(row.contentId)) continue;
        removed += Number(remove.run(row.contentId, normalizedModel).changes || 0);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return removed;
  }

  recordOperation(action, details = {}) {
    this.db.prepare(`
      INSERT INTO operation_history (action, details_json, created_at)
      VALUES (?, ?, ?)
    `).run(action, JSON.stringify(details), nowIso());
  }

  listOperations({ action = "", limit = 20, scope = "user" } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = action
      ? this.db.prepare(`
          SELECT id, action, details_json AS detailsJson, created_at AS createdAt
          FROM operation_history
          WHERE action = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(action, safeLimit)
      : scope === "all"
        ? this.db.prepare(`
          SELECT id, action, details_json AS detailsJson, created_at AS createdAt
          FROM operation_history
          ORDER BY id DESC
          LIMIT ?
        `).all(safeLimit)
        : this.db.prepare(`
          SELECT id, action, details_json AS detailsJson, created_at AS createdAt
          FROM operation_history
          WHERE action NOT IN ('index_sync', 'rebuild')
          ORDER BY id DESC
          LIMIT ?
        `).all(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      scope: maintenanceActions.has(row.action) ? "maintenance" : "user",
      createdAt: row.createdAt,
      details: parseOperationDetails(row.detailsJson),
    }));
  }

  getRecoveryFingerprint() {
    this.assertHealthy();
    const content = this.db.prepare(`
      SELECT file, content_sha256 AS sha256
      FROM content_index
      ORDER BY file ASC
    `).all();
    const trash = this.db.prepare(`
      SELECT id, content_sha256 AS sha256
      FROM trash_items
      WHERE status = 'trashed'
      ORDER BY id ASC
    `).all();
    return createHash("sha256")
      .update(JSON.stringify({ content, trash }))
      .digest("hex");
  }

  getLastMutationAt() {
    this.assertHealthy();
    return this.db.prepare(`
      SELECT MAX(value) AS updatedAt
      FROM (
        SELECT MAX(created_at) AS value FROM operation_history
        UNION ALL
        SELECT MAX(indexed_at) AS value FROM content_index
        UNION ALL
        SELECT MAX(updated_at) AS value FROM trash_items
        UNION ALL
        SELECT MAX(updated_at) AS value FROM recommendation_embeddings
      )
    `).get()?.updatedAt || "";
  }

  getStatus() {
    this.assertHealthy();
    const content = this.db.prepare("SELECT COUNT(*) AS count FROM content_index").get().count;
    const trash = this.db.prepare(
      "SELECT COUNT(*) AS count FROM trash_items WHERE status = 'trashed'",
    ).get().count;
    const embeddings = this.db.prepare(
      "SELECT COUNT(*) AS count FROM recommendation_embeddings",
    ).get().count;
    const lastRebuild = this.db.prepare(`
      SELECT created_at AS createdAt
      FROM operation_history
      WHERE action = 'rebuild'
      ORDER BY id DESC
      LIMIT 1
    `).get()?.createdAt || "";
    return {
      ok: true,
      database: portablePath(path.relative(this.repoRoot, this.databasePath)),
      content,
      trash,
      embeddings,
      lastRebuild,
      lastMutationAt: this.getLastMutationAt(),
      recovery: this.recovery,
    };
  }

  async createBackup({ retain = 14 } = {}) {
    await mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(this.backupsDir, `xgif-${stamp}.sqlite3`);
    this.recordOperation("backup", {
      destination: portablePath(path.relative(this.repoRoot, destination)),
    });
    await backup(this.db, destination);
    const backups = (await readdir(this.backupsDir))
      .filter((file) => /^xgif-.*\.sqlite3$/.test(file))
      .sort()
      .reverse();
    for (const stale of backups.slice(retain)) {
      await unlink(path.join(this.backupsDir, stale));
    }
    return destination;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}
