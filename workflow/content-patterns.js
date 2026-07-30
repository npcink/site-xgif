export const CONTENT_PATTERNS = Object.freeze({
  contentId: /^\d{8}-[a-z0-9]{4}$/u,
  calendarDate: /^(\d{4})-(\d{2})-(\d{2})$/u,
  placeholderArticleTitle: /^(?:待整理|未命名|无标题)(?:\s*[·\-—:：]?\s*.*)?$/u,
  sourcePrefix: /(?:来源链接|文章链接|原文链接|原链接|来源|原文|出处|链接)\s*[:：]\s*/iu,
  sourceOnlyPrefix: /^(?:来源链接|文章链接|原文链接|原链接|来源|原文|出处|链接)\s*[:：]\s*/iu,
  terminalTagLine: /^(?:[-*+]\s+)?((?:#[^\s#]+\s*)+)$/u,
  trailingWhitespace: /[ \t]+$/u,
  excessiveBlankLines: /\n{3,}/u,
});

export function rawHttpUrlPattern() {
  return /https?:\/\/[^\s<>"'`]+/giu;
}

export const CONTENT_PATTERN_EXAMPLES = Object.freeze([
  { rule: "contentId", input: "20260730-ab12", matches: true },
  { rule: "contentId", input: "article-12", matches: false },
  { rule: "placeholderArticleTitle", input: "待整理 · 2026-07-30 · 1", matches: true },
  { rule: "placeholderArticleTitle", input: "地铁上的周末观察", matches: false },
  { rule: "sourceOnlyPrefix", input: "来源：https://example.com/a", matches: true },
  { rule: "terminalTagLine", input: "- #生活 #回忆", matches: true },
]);

export function inspectContentPatterns(value) {
  const text = String(value || "").replace(/\r\n?/gu, "\n");
  const lines = text.split("\n");
  return {
    urls: [...text.matchAll(rawHttpUrlPattern())].map((match) => match[0]),
    trailingWhitespaceLines: lines
      .map((line, index) => CONTENT_PATTERNS.trailingWhitespace.test(line) ? index + 1 : 0)
      .filter(Boolean),
    excessiveBlankLineRuns: [...text.matchAll(/\n{3,}/gu)].length,
    terminalTagLines: lines
      .map((line, index) => CONTENT_PATTERNS.terminalTagLine.test(line.trim()) ? index + 1 : 0)
      .filter(Boolean),
    sourceLabelLines: lines
      .map((line, index) => CONTENT_PATTERNS.sourceOnlyPrefix.test(line.trim()) ? index + 1 : 0)
      .filter(Boolean),
  };
}
