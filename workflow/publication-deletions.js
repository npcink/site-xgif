import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { normalizePublicContentFile } from "./publication-bundle.js";
import {
  contentSha256,
  publicationReceiptState,
} from "./publication-receipts.js";

export const publicationTrashSchemaVersion = 2;

async function listSidecars(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSidecars(entryPath));
    else if (entry.name.endsWith(".meta.json")) files.push(entryPath);
  }
  return files;
}

function frontmatterField(markdown, field) {
  const match = String(markdown || "").match(
    new RegExp(`^${field}:\\s*["']?([^\\n"']+)`, "mu"),
  );
  return String(match?.[1] || "").trim();
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function migratePublicationTrashSidecars({
  trashRoot,
  apply = false,
}) {
  const migrations = [];
  const invalid = [];
  const sidecarPaths = await listSidecars(trashRoot);
  for (const sidecarPath of sidecarPaths) {
    let sidecar;
    try {
      sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    } catch (error) {
      invalid.push({ sidecarPath, error: `旁车 JSON 无效：${error.message}` });
      continue;
    }
    if (sidecar.status !== "trashed" || Number(sidecar.schemaVersion || 0) >= publicationTrashSchemaVersion) {
      continue;
    }
    const trashPath = sidecarPath.slice(0, -".meta.json".length);
    try {
      const markdown = await readFile(trashPath, "utf8");
      const sha256 = contentSha256(markdown);
      if (sidecar.sha256 && sidecar.sha256 !== sha256) {
        throw new Error("回收站内容哈希与旁车记录不一致");
      }
      const contentId = frontmatterField(markdown, "contentId");
      if (!contentId) throw new Error("回收站内容缺少 contentId");
      const next = {
        ...sidecar,
        schemaVersion: publicationTrashSchemaVersion,
        contentId,
        contentSha256: sha256,
        publicationSha256: String(
          sidecar.publicationSha256
          || sidecar.contentSha256
          || sidecar.sha256
          || sha256,
        ),
        publicationState: String(sidecar.publicationState || "local"),
        requiresRemoteDeletion: false,
      };
      migrations.push({
        sidecarPath,
        id: String(sidecar.id || ""),
        file: String(sidecar.file || ""),
        fromVersion: Number(sidecar.schemaVersion || 0),
        toVersion: publicationTrashSchemaVersion,
        next,
      });
    } catch (error) {
      invalid.push({ sidecarPath, error: error.message });
    }
  }

  if (apply && invalid.length === 0) {
    for (const migration of migrations) {
      await writeJsonAtomic(migration.sidecarPath, migration.next);
    }
  }
  return {
    ok: invalid.length === 0,
    applied: apply && invalid.length === 0,
    scanned: sidecarPaths.length,
    migrated: migrations.map(({ next, ...migration }) => migration),
    invalid,
  };
}

export async function listPublicationDeletionTombstones({
  trashRoot,
}) {
  const tombstones = [];
  for (const sidecarPath of await listSidecars(trashRoot)) {
    let sidecar;
    try {
      sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    } catch {
      continue;
    }
    if (sidecar.status !== "trashed" || sidecar.requiresRemoteDeletion !== true) continue;
    let file;
    try {
      file = normalizePublicContentFile(sidecar.file);
    } catch {
      continue;
    }
    tombstones.push({
      id: String(sidecar.id || ""),
      type: String(sidecar.type || ""),
      file,
      title: String(sidecar.title || "未命名内容"),
      contentId: String(sidecar.contentId || ""),
      contentSha256: String(sidecar.contentSha256 || sidecar.sha256 || ""),
      publicationSha256: String(
        sidecar.publicationSha256
        || sidecar.contentSha256
        || sidecar.sha256
        || "",
      ),
      deletedAt: String(sidecar.deletedAt || ""),
      sidecarPath,
    });
  }
  return tombstones.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

export async function publicationTrashSchemaStatus({
  trashRoot,
}) {
  let total = 0;
  let current = 0;
  let legacy = 0;
  let invalid = 0;
  for (const sidecarPath of await listSidecars(trashRoot)) {
    try {
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      if (sidecar.status !== "trashed") continue;
      total += 1;
      if (Number(sidecar.schemaVersion || 0) >= publicationTrashSchemaVersion) current += 1;
      else legacy += 1;
    } catch {
      invalid += 1;
    }
  }
  return {
    currentVersion: publicationTrashSchemaVersion,
    total,
    current,
    legacy,
    invalid,
    migrationRequired: legacy > 0 || invalid > 0,
  };
}

export async function publicationDeletionQueue({
  trashRoot,
  receiptStore,
}) {
  const tombstones = await listPublicationDeletionTombstones({ trashRoot });
  const receipts = await receiptStore.latestByFileAndHash(tombstones, { action: "delete" });
  const ready = [];
  const retry = [];
  const pending = [];
  for (const tombstone of tombstones) {
    const receipt = receipts.get(tombstone.file);
    const state = publicationReceiptState(receipt);
    if (!receipt) ready.push(tombstone);
    else if (state === "push_succeeded") pending.push({ ...tombstone, receipt });
    else retry.push({ ...tombstone, receipt });
  }
  return { ready, retry, pending, total: tombstones.length };
}
