import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrashPurgeAllowed,
  planTrashRestore,
} from "../publication-trash-policy.js";

const failedDeletion = {
  action: "delete",
  state: "push_failed",
  branch: "content-sync/failed-delete",
};
const pushedDeletion = {
  action: "delete",
  state: "push_succeeded",
  branch: "content-sync/pushed-delete",
};

test("local-only trash restores without remote work", () => {
  assert.deepEqual(planTrashRestore({ deletionReceipt: null }), {
    mode: "local",
    requiresSync: false,
    shouldCancelBatch: false,
    shouldRecordRestore: false,
  });
});

test("a failed withdrawal is canceled before restoring its local content", () => {
  assert.deepEqual(planTrashRestore({ deletionReceipt: failedDeletion }), {
    mode: "cancel",
    requiresSync: false,
    shouldCancelBatch: true,
    shouldRecordRestore: false,
  });
});

test("a pushed withdrawal restores only after the live page is gone", () => {
  assert.throws(
    () => planTrashRestore({
      deletionReceipt: pushedDeletion,
      liveStatusCode: 200,
    }),
    (error) => error.statusCode === 409 && /404\/410/u.test(error.message),
  );
  assert.deepEqual(planTrashRestore({
    deletionReceipt: pushedDeletion,
    liveStatusCode: 404,
  }), {
    mode: "republish",
    requiresSync: true,
    shouldCancelBatch: false,
    shouldRecordRestore: true,
  });
});

test("remote trash cannot be purged before push and live withdrawal complete", () => {
  assert.deepEqual(assertTrashPurgeAllowed({
    requiresRemoteDeletion: false,
    deletionReceipt: null,
  }), { mode: "local" });
  assert.throws(
    () => assertTrashPurgeAllowed({
      requiresRemoteDeletion: true,
      deletionReceipt: failedDeletion,
    }),
    (error) => error.statusCode === 409 && /尚未完成远程下架同步/u.test(error.message),
  );
  assert.throws(
    () => assertTrashPurgeAllowed({
      requiresRemoteDeletion: true,
      deletionReceipt: pushedDeletion,
      liveStatusCode: 200,
    }),
    (error) => error.statusCode === 409 && /线上尚未返回 404\/410/u.test(error.message),
  );
  assert.deepEqual(assertTrashPurgeAllowed({
    requiresRemoteDeletion: true,
    deletionReceipt: pushedDeletion,
    liveStatusCode: 410,
  }), { mode: "withdrawn" });
});
