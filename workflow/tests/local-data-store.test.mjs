import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { LocalDataStore } from "../local-data-store.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-store-"));
  const repoRoot = path.join(root, "repo");
  const workflowRoot = path.join(repoRoot, "workflow");
  const articlesDir = path.join(repoRoot, "site", "src", "content", "articles");
  const imagesDir = path.join(repoRoot, "site", "src", "content", "images");
  const trashDir = path.join(workflowRoot, "trash", "content");
  const migrationsDir = path.join(workflowRoot, "db", "migrations");
  const sourceMigration = new URL("../db/migrations/001-initial.sql", import.meta.url);
  await Promise.all([
    mkdir(articlesDir, { recursive: true }),
    mkdir(imagesDir, { recursive: true }),
    mkdir(trashDir, { recursive: true }),
    mkdir(migrationsDir, { recursive: true }),
  ]);
  await writeFile(
    path.join(migrationsDir, "001-initial.sql"),
    await readFile(sourceMigration, "utf8"),
    "utf8",
  );
  return { repoRoot, workflowRoot, articlesDir, trashDir, migrationsDir };
}

test("SQLite is rebuilt from Markdown and trash sidecars after database corruption", async () => {
  const dirs = await fixture();
  const articlePath = path.join(dirs.articlesDir, "safe.md");
  await writeFile(articlePath, `---
title: "数据库之外的文章"
summary: "正文仍由 Git 管理"
tags: ["安全"]
pubDate: "2026-07-23"
draft: true
---
数据库可以删除，文章不能删除。
`, "utf8");

  const trashBatch = path.join(dirs.trashDir, "batch-1");
  const trashFile = path.join(trashBatch, "article-old.md");
  const metadataFile = `${trashFile}.meta.json`;
  await mkdir(trashBatch, { recursive: true });
  await writeFile(trashFile, "trashed article", "utf8");
  await writeFile(metadataFile, JSON.stringify({
    schemaVersion: 1,
    id: "trash-test",
    type: "article",
    file: "site/src/content/articles/old.md",
    trashFile: path.relative(dirs.repoRoot, trashFile),
    title: "旧草稿",
    deletedAt: "2026-07-23T00:00:00.000Z",
    status: "trashed",
    sha256: "hash",
    size: 15,
  }), "utf8");

  const databasePath = path.join(dirs.workflowRoot, ".runtime", "xgif.sqlite3");
  let store = new LocalDataStore({ ...dirs, databasePath });
  await store.initialize();
  assert.equal(store.getStatus().content, 1);
  assert.equal(store.getStatus().trash, 1);
  store.close();

  await writeFile(databasePath, "not a sqlite database", "utf8");
  store = new LocalDataStore({ ...dirs, databasePath });
  const recovered = await store.initialize();
  assert.equal(recovered.content, 1);
  assert.equal(recovered.trash, 1);
  assert.equal(recovered.recovery?.recovered, true);
  assert.match(recovered.recovery?.quarantinePath || "", /\.corrupt-/);
  assert.equal(store.listTrashItems()[0].file, "site/src/content/articles/old.md");
  store.close();
});

test("SQLite backup uses the online backup API and keeps a readable snapshot", async () => {
  const dirs = await fixture();
  await writeFile(path.join(dirs.articlesDir, "backup.md"), `---
title: "备份文章"
draft: false
---
正文
`, "utf8");
  const store = new LocalDataStore(dirs);
  await store.initialize();
  const backupPath = await store.createBackup({ retain: 2 });
  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(backupDb.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.equal(backupDb.prepare("SELECT COUNT(*) AS count FROM content_index").get().count, 1);
  backupDb.close();
  store.close();
  const backupFiles = (await readdir(path.join(dirs.workflowRoot, "backups")))
    .filter((file) => file.endsWith(".sqlite3"));
  assert.equal(backupFiles.length, 1);
});

test("operation history can filter sync records and tolerates damaged details", async () => {
  const dirs = await fixture();
  const store = new LocalDataStore(dirs);
  await store.initialize();
  store.recordOperation("sync_content", { branch: "codex/safe-content", count: 8 });
  store.recordOperation("backup", { file: "backup.sqlite3" });
  store.db.prepare(`
    INSERT INTO operation_history (action, details_json, created_at)
    VALUES (?, ?, ?)
  `).run("sync_content", "{broken", "2026-07-23T00:00:00.000Z");

  const records = store.listOperations({ action: "sync_content", limit: 10 });
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].details, {});
  assert.equal(records[1].details.branch, "codex/safe-content");
  assert.equal(records[1].details.count, 8);
  store.close();
});
