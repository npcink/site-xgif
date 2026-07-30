import assert from "node:assert/strict";
import test from "node:test";
import { retryPublicationBatch } from "../publication-batch-recovery.js";

function fixture({
  pushOk = true,
  receipts = [
    {
      action: "sync",
      batchId: "batch-1",
      branch: "content-sync/mixed",
      file: "site/src/content/articles/updated.md",
      contentSha256: "a".repeat(64),
    },
    {
      action: "delete",
      batchId: "batch-1",
      branch: "content-sync/mixed",
      file: "site/src/content/articles/withdrawn.md",
      contentSha256: "b".repeat(64),
    },
  ],
} = {}) {
  const calls = {
    validated: [],
    appended: [],
    cleaned: [],
    pushed: [],
  };
  const referenceReceipt = receipts[0];
  return {
    calls,
    referenceReceipt,
    input: {
      referenceReceipt,
      receiptStore: {
        batchForReceipt: async (receipt) => {
          assert.equal(receipt, referenceReceipt);
          return receipts;
        },
      },
      retryPush: async ({ branch }) => {
        calls.pushed.push(branch);
        return {
          branch,
          commitSha: "c".repeat(40),
          push: { attempted: true, ok: pushOk, error: pushOk ? "" : "rejected" },
        };
      },
      appendReceiptBatch: async (entry) => {
        calls.appended.push(entry);
        return entry.items.map((item) => ({ ...item, ...entry }));
      },
      cleanupBranch: async ({ branch }) => {
        calls.cleaned.push(branch);
        return true;
      },
      validateReceipt: async (receipt) => {
        calls.validated.push(`${receipt.action}:${receipt.file}`);
      },
    },
  };
}

test("mixed publication batches retry sync and delete actions without reading deleted content", async () => {
  const { input, calls } = fixture();
  const result = await retryPublicationBatch(input);

  assert.equal(result.ok, true);
  assert.deepEqual(calls.pushed, ["content-sync/mixed"]);
  assert.deepEqual(calls.validated, [
    "sync:site/src/content/articles/updated.md",
    "delete:site/src/content/articles/withdrawn.md",
  ]);
  assert.deepEqual(calls.appended.map((entry) => entry.action), ["sync", "delete"]);
  assert.ok(calls.appended.every((entry) => entry.state === "push_succeeded"));
  assert.ok(calls.appended.every((entry) => entry.batchId === "batch-1"));
  assert.deepEqual(calls.cleaned, ["content-sync/mixed"]);
  assert.equal(result.synced.length, 1);
  assert.equal(result.deleted.length, 1);
});

test("failed batch retries retain the branch and record original actions as failed", async () => {
  const { input, calls } = fixture({ pushOk: false });
  const result = await retryPublicationBatch(input);

  assert.equal(result.ok, false);
  assert.deepEqual(calls.cleaned, []);
  assert.deepEqual(calls.appended.map((entry) => entry.action), ["sync", "delete"]);
  assert.ok(calls.appended.every((entry) => entry.state === "push_failed"));
});

test("batch validation fails before pushing when any receipt changed", async () => {
  const { input, calls } = fixture();
  input.validateReceipt = async (receipt) => {
    if (receipt.action === "delete") throw Object.assign(new Error("changed"), { statusCode: 409 });
  };

  await assert.rejects(
    retryPublicationBatch(input),
    (error) => error.statusCode === 409 && error.message === "changed",
  );
  assert.deepEqual(calls.pushed, []);
  assert.deepEqual(calls.appended, []);
});

test("batch recovery rejects unsupported actions", async () => {
  const { input, calls } = fixture({
    receipts: [{
      action: "restore",
      batchId: "batch-2",
      branch: "content-sync/restore",
      file: "site/src/content/articles/restored.md",
    }],
  });

  await assert.rejects(
    retryPublicationBatch(input),
    (error) => error.statusCode === 409 && /不可重试动作/u.test(error.message),
  );
  assert.deepEqual(calls.pushed, []);
});
