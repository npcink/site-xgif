import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertFileContentVersion,
  assertExpectedContentVersion,
  contentSha256,
  PublicationReceiptStore,
  publicationReceiptState,
} from "../publication-receipts.js";

test("publication receipts select only the latest matching content version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-receipts-"));
  const store = new PublicationReceiptStore({
    filePath: path.join(root, "publication-events.jsonl"),
  });
  const file = "site/src/content/articles/example.md";
  const firstHash = contentSha256("first");
  const secondHash = contentSha256("second");
  try {
    await store.appendBatch({
      action: "sync",
      branch: "content-sync/first",
      commitSha: "a".repeat(40),
      push: { ok: true },
      items: [{ file, contentId: "20260729-test", contentSha256: firstHash }],
    });
    const failedBatch = await store.appendBatch({
      action: "sync",
      branch: "content-sync/second",
      commitSha: "b".repeat(40),
      push: { ok: false, error: "remote rejected" },
      items: [
        { file, contentId: "20260729-test", contentSha256: secondHash },
        {
          file: "site/src/content/images/example.md",
          contentId: "20260729-img1",
          contentSha256: contentSha256("image"),
        },
      ],
    });

    const first = await store.latestByFileAndHash([{ file, contentSha256: firstHash }]);
    const second = await store.latestByFileAndHash([{ file, contentSha256: secondHash }]);
    assert.equal(first.get(file).branch, "content-sync/first");
    assert.equal(first.get(file).pushOk, true);
    assert.equal(publicationReceiptState(first.get(file)), "push_succeeded");
    assert.equal(second.get(file).branch, "content-sync/second");
    assert.equal(second.get(file).pushOk, false);
    assert.equal(second.get(file).pushError, "remote rejected");
    assert.ok(failedBatch[0].batchId);
    assert.equal(failedBatch[0].batchId, failedBatch[1].batchId);
    assert.equal((await store.batchForReceipt(failedBatch[0])).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication receipts match legacy content hashes after asset-aware versions are added", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-legacy-"));
  const filePath = path.join(root, "publication-events.jsonl");
  const store = new PublicationReceiptStore({ filePath });
  const file = "site/src/content/articles/legacy.md";
  const contentHash = contentSha256("legacy body");
  try {
    await writeFile(filePath, `${JSON.stringify({
      schemaVersion: 1,
      action: "sync",
      file,
      contentSha256: contentHash,
      branch: "content-sync/legacy",
      pushOk: false,
    })}\n`, "utf8");
    const receipts = await store.latestByFileAndHash([{
      file,
      contentSha256: contentHash,
      publicationSha256: contentSha256("legacy body with assets"),
    }]);
    assert.equal(receipts.get(file).branch, "content-sync/legacy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared and terminal receipts keep one batch and expose the latest phase", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-phases-"));
  const store = new PublicationReceiptStore({
    filePath: path.join(root, "publication-events.jsonl"),
  });
  const item = {
    file: "site/src/content/articles/example.md",
    contentId: "20260729-test",
    contentSha256: contentSha256("body"),
  };
  try {
    const prepared = await store.appendBatch({
      action: "sync",
      state: "prepared",
      branch: "content-sync/phased",
      commitSha: "c".repeat(40),
      push: { attempted: false, ok: false },
      items: [item],
    });
    const terminal = await store.appendBatch({
      action: "sync",
      state: "push_succeeded",
      branch: "content-sync/phased",
      commitSha: "c".repeat(40),
      push: { attempted: true, ok: true },
      items: [item],
      batchId: prepared[0].batchId,
    });
    const latest = await store.latestByFileAndHash([item]);
    assert.equal(publicationReceiptState(latest.get(item.file)), "push_succeeded");
    assert.equal(terminal[0].batchId, prepared[0].batchId);
    assert.equal((await store.batchForReceipt(terminal[0])).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore and cancellation events invalidate earlier publication facts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-invalidations-"));
  const store = new PublicationReceiptStore({
    filePath: path.join(root, "publication-events.jsonl"),
  });
  const item = {
    file: "site/src/content/articles/restored.md",
    contentId: "20260729-back",
    contentSha256: contentSha256("body"),
  };
  try {
    await store.appendBatch({
      action: "sync",
      branch: "content-sync/original",
      commitSha: "e".repeat(40),
      push: { ok: true },
      items: [item],
    });
    await store.appendBatch({
      action: "delete",
      branch: "content-sync/delete-before-restore",
      commitSha: "d".repeat(40),
      push: { ok: true },
      items: [item],
    });
    await store.appendBatch({
      action: "restore",
      state: "restored",
      branch: "",
      commitSha: "",
      push: { ok: true },
      items: [item],
    });
    assert.equal((await store.latestByFileAndHash([item])).has(item.file), false);
    assert.equal(
      (await store.latestByFileAndHash([item], { action: "delete" })).has(item.file),
      false,
    );

    await store.appendBatch({
      action: "delete",
      branch: "content-sync/delete",
      commitSha: "f".repeat(40),
      push: { ok: false, error: "offline" },
      items: [item],
    });
    await store.appendBatch({
      action: "cancel",
      state: "canceled",
      branch: "",
      commitSha: "",
      push: { ok: true },
      items: [item],
    });
    assert.equal(
      (await store.latestByFileAndHash([item], { action: "delete" })).has(item.file),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content version checks reject stale editor writes", () => {
  const current = contentSha256("current");
  assert.doesNotThrow(() => assertExpectedContentVersion(current, current));
  assert.doesNotThrow(() => assertExpectedContentVersion("", current));
  assert.throws(
    () => assertExpectedContentVersion(contentSha256("stale"), current),
    (error) => error.statusCode === 409 && /重新打开/u.test(error.message),
  );
});

test("file version checks detect an external edit before replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-version-check-"));
  const filePath = path.join(root, "article.md");
  try {
    await writeFile(filePath, "opened version", "utf8");
    const opened = contentSha256("opened version");
    assert.equal(await assertFileContentVersion(filePath, opened), opened);
    await writeFile(filePath, "external edit", "utf8");
    await assert.rejects(
      assertFileContentVersion(filePath, opened),
      (error) => error.statusCode === 409,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication receipts never persist credentials from push errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-redaction-"));
  const store = new PublicationReceiptStore({
    filePath: path.join(root, "publication-events.jsonl"),
  });
  try {
    const [receipt] = await store.appendBatch({
      action: "sync",
      branch: "content-sync/redacted",
      commitSha: "d".repeat(40),
      push: {
        ok: false,
        error: "https://user:secret@example.test/repo github_pat_exampleToken",
      },
      items: [{
        file: "site/src/content/articles/example.md",
        contentId: "20260729-test",
        contentSha256: contentSha256("body"),
      }],
    });
    assert.equal(receipt.pushError, "https://example.test/repo [redacted]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication receipts fail closed when the append-only log is corrupted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-corrupt-"));
  const filePath = path.join(root, "publication-events.jsonl");
  const store = new PublicationReceiptStore({ filePath });
  try {
    await writeFile(filePath, "{\"valid\":true}\n{broken\n", "utf8");
    await assert.rejects(
      store.list(),
      (error) => error.statusCode === 500 && /第 2 行损坏/u.test(error.message),
    );
    await assert.rejects(
      store.appendBatch({
        action: "sync",
        branch: "content-sync/must-not-append",
        commitSha: "deadbeef",
        push: { ok: true },
        items: [{ file: "site/src/content/articles/a.md", contentSha256: "hash-a" }],
      }),
      /第 2 行损坏/u,
    );
    assert.equal(await readFile(filePath, "utf8"), "{\"valid\":true}\n{broken\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
