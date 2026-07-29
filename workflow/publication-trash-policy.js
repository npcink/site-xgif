import { publicationReceiptState } from "./publication-receipts.js";

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function isWithdrawnStatus(statusCode) {
  return statusCode === 404 || statusCode === 410;
}

export function planTrashRestore({
  deletionReceipt,
  liveStatusCode = null,
}) {
  if (!deletionReceipt) {
    return {
      mode: "local",
      requiresSync: false,
      shouldCancelBatch: false,
      shouldRecordRestore: false,
    };
  }

  if (publicationReceiptState(deletionReceipt) !== "push_succeeded") {
    return {
      mode: "cancel",
      requiresSync: false,
      shouldCancelBatch: true,
      shouldRecordRestore: false,
    };
  }

  if (!isWithdrawnStatus(liveStatusCode)) {
    throw conflict(
      "该内容的远程下架已经推送；请等待线上返回 404/410 后再恢复，避免恢复内容被后续部署再次删除。",
    );
  }

  return {
    mode: "republish",
    requiresSync: true,
    shouldCancelBatch: false,
    shouldRecordRestore: true,
  };
}

export function assertTrashPurgeAllowed({
  requiresRemoteDeletion,
  deletionReceipt,
  liveStatusCode = null,
}) {
  if (!requiresRemoteDeletion) return { mode: "local" };
  if (publicationReceiptState(deletionReceipt) !== "push_succeeded") {
    throw conflict("该内容尚未完成远程下架同步，不能永久删除回收站记录。");
  }
  if (!isWithdrawnStatus(liveStatusCode)) {
    throw conflict("线上尚未返回 404/410，不能永久删除下架凭据。");
  }
  return { mode: "withdrawn" };
}
