import assert from "node:assert/strict";
import test from "node:test";
import { partitionSyncCandidates } from "../sync-readiness.js";

test("sync readiness keeps passing content and separates review items", () => {
  const candidates = [
    { type: "article", file: "site/src/content/articles/ready.md", title: "正常文章" },
    { type: "article", file: "site/src/content/articles/review.md", title: "待确认文章" },
  ];
  const result = partitionSyncCandidates(candidates, [
    {
      file: candidates[0].file,
      status: "ready",
      blockers: [],
      warnings: [],
    },
    {
      file: candidates[1].file,
      status: "review",
      blockers: [],
      warnings: ["正文含长段落。", "正文含未结构化链接。"],
    },
  ]);

  assert.deepEqual(result.ready, [candidates[0]]);
  assert.equal(result.needsAttention.length, 1);
  assert.equal(result.needsAttention[0].auditStatus, "review");
  assert.equal(result.needsAttention[0].reason, "正文含长段落。；正文含未结构化链接。");
});

test("sync readiness fails closed when an audit result is missing", () => {
  const candidate = {
    type: "image",
    file: "site/src/content/images/missing-audit.md",
    title: "缺少体检结果",
  };
  const result = partitionSyncCandidates([candidate], []);

  assert.deepEqual(result.ready, []);
  assert.equal(result.needsAttention[0].auditStatus, "missing");
  assert.equal(result.needsAttention[0].reason, "无法取得有效的上线体检结果。");
});
