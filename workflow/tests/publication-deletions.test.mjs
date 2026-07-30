import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  publicationDeletionQueue,
  publicationTrashSchemaStatus,
  publicationTrashSchemaVersion,
} from "../publication-deletions.js";
import { PublicationReceiptStore } from "../publication-receipts.js";

test("deletion queue separates unsynced, failed, and pushed tombstones", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-deletion-queue-"));
  const trashRoot = path.join(root, "trash");
  const receiptStore = new PublicationReceiptStore({
    filePath: path.join(root, "publication-events.jsonl"),
  });
  const items = [
    { id: "ready", file: "site/src/content/articles/ready.md", version: "a".repeat(64) },
    { id: "retry", file: "site/src/content/articles/retry.md", version: "b".repeat(64) },
    { id: "pending", file: "site/src/content/articles/pending.md", version: "c".repeat(64) },
  ];
  try {
    await mkdir(trashRoot, { recursive: true });
    for (const item of items) {
      await writeFile(path.join(trashRoot, `${item.id}.md.meta.json`), JSON.stringify({
        id: item.id,
        type: "article",
        file: item.file,
        title: item.id,
        contentId: `20260729-${item.id.slice(0, 4)}`,
        contentSha256: item.version,
        publicationSha256: item.version,
        deletedAt: "2026-07-29T00:00:00.000Z",
        status: "trashed",
        requiresRemoteDeletion: true,
      }));
    }
    await receiptStore.appendBatch({
      action: "delete",
      branch: "content-sync/retry",
      commitSha: "1".repeat(40),
      push: { ok: false, error: "rejected" },
      items: [{
        file: items[1].file,
        contentSha256: items[1].version,
        publicationSha256: items[1].version,
      }],
    });
    await receiptStore.appendBatch({
      action: "delete",
      branch: "content-sync/pending",
      commitSha: "2".repeat(40),
      push: { ok: true },
      items: [{
        file: items[2].file,
        contentSha256: items[2].version,
        publicationSha256: items[2].version,
      }],
    });

    const queue = await publicationDeletionQueue({ trashRoot, receiptStore });
    assert.deepEqual(queue.ready.map((item) => item.id), ["ready"]);
    assert.deepEqual(queue.retry.map((item) => item.id), ["retry"]);
    assert.deepEqual(queue.pending.map((item) => item.id), ["pending"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trash schema diagnostics report legacy sidecars without rewriting them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-trash-schema-"));
  try {
    await writeFile(path.join(root, "legacy.md.meta.json"), JSON.stringify({
      schemaVersion: 1,
      status: "trashed",
    }));
    await writeFile(path.join(root, "current.md.meta.json"), JSON.stringify({
      schemaVersion: publicationTrashSchemaVersion,
      status: "trashed",
    }));
    await writeFile(path.join(root, "invalid.md.meta.json"), "{broken");

    assert.deepEqual(await publicationTrashSchemaStatus({ trashRoot: root }), {
      currentVersion: publicationTrashSchemaVersion,
      total: 2,
      current: 1,
      legacy: 1,
      invalid: 1,
      migrationRequired: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
