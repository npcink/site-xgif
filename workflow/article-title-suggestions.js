import { CONTENT_PATTERNS } from "./content-patterns.js";

function normalizeComparableTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•—–_\-，。！？!?、：:；;“”"'《》〈〉【】()[\]{}]/gu, "");
}

export function isPlaceholderArticleTitle(value) {
  return CONTENT_PATTERNS.placeholderArticleTitle.test(String(value || "").trim());
}

function unusableTitle(value) {
  return isPlaceholderArticleTitle(value)
    || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*[·\-—]\s*\d+)?$/u.test(value);
}

function invalidTitleSuggestions() {
  const error = new Error("AI 没有返回 3 个可用标题，请重试。");
  error.statusCode = 502;
  return error;
}

export function sanitizeArticleTitleSuggestions(value, currentTitle = "") {
  if (!value || typeof value !== "object" || !Array.isArray(value.titles)) {
    throw invalidTitleSuggestions();
  }

  const currentComparable = normalizeComparableTitle(currentTitle);
  const seen = new Set();
  const titles = [];

  for (const rawTitle of value.titles) {
    const title = String(rawTitle || "").trim().replace(/\s+/gu, " ").slice(0, 120);
    const comparable = normalizeComparableTitle(title);
    if (!title || unusableTitle(title) || !comparable || comparable === currentComparable || seen.has(comparable)) continue;
    seen.add(comparable);
    titles.push(title);
    if (titles.length === 3) break;
  }

  if (titles.length !== 3) throw invalidTitleSuggestions();
  return titles;
}
