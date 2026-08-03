import { safeParagraphSuggestion } from "./article-paragraph-formatting.js";

export function overlongParagraphLengths(body, maxCharacters = 180) {
  return String(body || "")
    .split(/\n[ \t]*\n/gu)
    .map((paragraph) => [...paragraph.replace(/\s/gu, "")].length)
    .filter((length) => length > maxCharacters);
}

export function inspectArticleBatchPreparation(data = {}, body = "") {
  const longParagraphs = overlongParagraphLengths(body);
  const internalNote = String(data.internalNote || "").trim();
  const internalReviewStatus = String(data.internalReviewStatus || "unresolved").trim();
  const needsShortFormReview = [...String(body || "").replace(/\s/gu, "")].length < 80
    && data.shortFormReviewed !== true;
  return {
    needsParagraphs: longParagraphs.length > 0,
    longParagraphCount: longParagraphs.length,
    longestParagraph: longParagraphs.length ? Math.max(...longParagraphs) : 0,
    needsShortFormReview,
    needsInternalReview: Boolean(
      (internalNote && internalReviewStatus !== "resolved") || needsShortFormReview
    ),
    internalNote,
  };
}

export function applyBatchParagraphSuggestion(originalBody, suggestion = {}) {
  if (!overlongParagraphLengths(originalBody).length) return String(originalBody || "");
  const verified = safeParagraphSuggestion(originalBody, suggestion.body);
  if (
    suggestion.paragraphFormatting !== "applied"
    || verified.paragraphFormatting !== "applied"
    || overlongParagraphLengths(verified.body).length
  ) {
    throw new Error("自动分段未能在保持正文字符不变的前提下完成，已保留原草稿。");
  }
  return verified.body;
}

export function applyBatchReviewConfirmation(
  data = {},
  {
    confirmed = false,
    resolvedAt = new Date().toISOString(),
  } = {},
) {
  const preparation = inspectArticleBatchPreparation(data, data.body);
  if (!preparation.needsInternalReview) return { ...data };
  if (!confirmed) {
    throw new Error("内容复核尚未确认，已保留原草稿。");
  }
  return {
    ...data,
    ...(preparation.internalNote ? {
      internalReviewStatus: "resolved",
      internalReviewResolvedAt: resolvedAt,
    } : {}),
    ...(preparation.needsShortFormReview ? { shortFormReviewed: true } : {}),
  };
}
