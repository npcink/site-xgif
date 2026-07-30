const supportedActions = new Set(["sync", "delete"]);

function recoveryError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function receiptAction(receipt) {
  return String(receipt?.action || "sync");
}

export async function retryPublicationBatch({
  referenceReceipt,
  receiptStore,
  retryPush,
  appendReceiptBatch,
  cleanupBranch,
  validateReceipt = async () => {},
}) {
  const branch = String(referenceReceipt?.branch || "").trim();
  if (!branch) throw recoveryError("发布回执缺少可重试分支。");

  const batchReceipts = await receiptStore.batchForReceipt(referenceReceipt);
  if (!batchReceipts.length) {
    throw recoveryError(`无法恢复发布批次回执：${branch}`);
  }

  const unsupported = batchReceipts.find((receipt) => !supportedActions.has(receiptAction(receipt)));
  if (unsupported) {
    throw recoveryError(`发布批次包含不可重试动作：${receiptAction(unsupported)}`);
  }

  for (const receipt of batchReceipts) await validateReceipt(receipt);

  const retried = await retryPush({ branch });
  const state = retried.push.ok ? "push_succeeded" : "push_failed";
  const recorded = [];
  for (const action of supportedActions) {
    const items = batchReceipts.filter((receipt) => receiptAction(receipt) === action);
    if (!items.length) continue;
    recorded.push(...await appendReceiptBatch({
      action,
      state,
      branch,
      commitSha: retried.commitSha,
      push: retried.push,
      items,
      batchId: referenceReceipt.batchId,
    }));
  }

  if (retried.push.ok) await cleanupBranch({ branch });

  return {
    ok: retried.push.ok,
    branch,
    commitSha: retried.commitSha,
    push: retried.push,
    receipts: recorded,
    synced: batchReceipts.filter((receipt) => receiptAction(receipt) === "sync"),
    deleted: batchReceipts.filter((receipt) => receiptAction(receipt) === "delete"),
  };
}
