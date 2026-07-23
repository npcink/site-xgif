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

function parseFrontmatter(content) {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const raw = match?.[1] || "";
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

  return data;
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

    await this.applyMigrations();
    await this.rebuildAll();
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

    for (const file of migrationFiles) {
      if (applied.get(file)) continue;
      const sql = await readFile(path.join(this.migrationsDir, file), "utf8");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(sql);
        markApplied.run(file, nowIso());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
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
        const data = parseFrontmatter(content);
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
        is_draft, is_public, content_sha256, file_size, file_mtime_ms, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const insert = this.db.prepare(`
      INSERT INTO trash_items (
        id, content_type, original_file, trash_file, metadata_file, title,
        deleted_at, restored_at, status, content_sha256, file_size, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM trash_items");
      for (const record of records) {
        insert.run(
          record.id,
          record.type,
          record.file,
          record.trashFile,
          record.metadataFile,
          String(record.title || "未命名内容"),
          record.deletedAt,
          record.restoredAt || null,
          record.status,
          record.sha256,
          Number(record.size || 0),
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

  recordOperation(action, details = {}) {
    this.db.prepare(`
      INSERT INTO operation_history (action, details_json, created_at)
      VALUES (?, ?, ?)
    `).run(action, JSON.stringify(details), nowIso());
  }

  listOperations({ action = "", limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = action
      ? this.db.prepare(`
          SELECT id, action, details_json AS detailsJson, created_at AS createdAt
          FROM operation_history
          WHERE action = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(action, safeLimit)
      : this.db.prepare(`
          SELECT id, action, details_json AS detailsJson, created_at AS createdAt
          FROM operation_history
          ORDER BY id DESC
          LIMIT ?
        `).all(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      details: parseOperationDetails(row.detailsJson),
    }));
  }

  getStatus() {
    this.assertHealthy();
    const content = this.db.prepare("SELECT COUNT(*) AS count FROM content_index").get().count;
    const trash = this.db.prepare(
      "SELECT COUNT(*) AS count FROM trash_items WHERE status = 'trashed'",
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
      lastRebuild,
      recovery: this.recovery,
    };
  }

  async createBackup({ retain = 14 } = {}) {
    await mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(this.backupsDir, `xgif-${stamp}.sqlite3`);
    await backup(this.db, destination);
    const backups = (await readdir(this.backupsDir))
      .filter((file) => /^xgif-.*\.sqlite3$/.test(file))
      .sort()
      .reverse();
    for (const stale of backups.slice(retain)) {
      await unlink(path.join(this.backupsDir, stale));
    }
    this.recordOperation("backup", {
      destination: portablePath(path.relative(this.repoRoot, destination)),
    });
    return destination;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}
