import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBatchParagraphSuggestion,
  applyBatchReviewConfirmation,
  inspectArticleBatchPreparation,
  overlongParagraphLengths,
} from "../batch-publication.js";

test("batch preparation identifies repairable paragraph and review work", () => {
  const body = "这是一段需要安全分段的正文。".repeat(20);
  const result = inspectArticleBatchPreparation({
    internalNote: "从私人收藏导入，请在公开前复核。",
    internalReviewStatus: "unresolved",
  }, body);

  assert.equal(result.needsParagraphs, true);
  assert.equal(result.longParagraphCount, 1);
  assert.ok(result.longestParagraph > 180);
  assert.equal(result.needsInternalReview, true);
});

test("batch paragraph preparation accepts only a completed safe split", () => {
  const first = "甲".repeat(120);
  const second = "乙".repeat(120);
  const original = `${first}${second}`;
  const organized = `${first}\n\n${second}`;

  assert.deepEqual(overlongParagraphLengths(organized), []);
  assert.equal(applyBatchParagraphSuggestion(original, {
    paragraphFormatting: "applied",
    body: organized,
  }), organized);
  assert.throws(
    () => applyBatchParagraphSuggestion(original, {
      paragraphFormatting: "rejected",
      body: `${first}\n\n改写`,
    }),
    /保留原草稿/,
  );
  assert.throws(
    () => applyBatchParagraphSuggestion(original, {
      paragraphFormatting: "unchanged",
      body: original,
    }),
    /保留原草稿/,
  );
  assert.throws(
    () => applyBatchParagraphSuggestion(original, {
      paragraphFormatting: "applied",
      body: `${first}\n\n${"改".repeat(120)}`,
    }),
    /保留原草稿/,
  );
});

test("batch review requires explicit confirmation and records its time", () => {
  const data = {
    internalNote: "请在公开前复核来源和内容。",
    internalReviewStatus: "unresolved",
    body: "这是一段经过核对、长度足够的测试正文。".repeat(8),
  };
  assert.throws(
    () => applyBatchReviewConfirmation(data),
    /尚未确认/,
  );

  const resolved = applyBatchReviewConfirmation(data, {
    confirmed: true,
    resolvedAt: "2026-07-29T10:00:00.000Z",
  });
  assert.equal(resolved.internalReviewStatus, "resolved");
  assert.equal(resolved.internalReviewResolvedAt, "2026-07-29T10:00:00.000Z");
  assert.equal(resolved.internalNote, data.internalNote);
});

test("batch review accepts a complete short form without changing its text", () => {
  const body = "短文原文必须逐字保留，只允许在适当位置增加段落空行。";
  const preparation = inspectArticleBatchPreparation({}, body);
  assert.equal(preparation.needsShortFormReview, true);
  assert.equal(preparation.needsInternalReview, true);

  const resolved = applyBatchReviewConfirmation({ body }, { confirmed: true });
  assert.equal(resolved.shortFormReviewed, true);
  assert.equal(resolved.body, body);
});
