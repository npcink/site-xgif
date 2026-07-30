import { CONTENT_PATTERNS } from "./content-patterns.js";

const internalImportTags = new Set(["故事汇", "sq", "煎蛋"]);
const terminalTagLine = CONTENT_PATTERNS.terminalTagLine;

export function isInternalImportTag(tag) {
  return internalImportTags.has(String(tag || "").trim().toLowerCase());
}

export function splitTerminalImportTags(lines) {
  const bodyLines = [...lines];
  const collected = [];
  let index = bodyLines.length - 1;
  while (index >= 0 && !String(bodyLines[index] || "").trim()) index -= 1;

  while (index >= 0) {
    const match = String(bodyLines[index] || "").trim().match(terminalTagLine);
    if (!match) break;
    collected.unshift(...[...match[1].matchAll(/#([^\s#]+)/gu)].map((item) => item[1]));
    index -= 1;
    while (index >= 0 && !String(bodyLines[index] || "").trim()) index -= 1;
  }

  const unique = [...new Set(collected)];
  return {
    bodyLines: unique.length ? bodyLines.slice(0, index + 1) : bodyLines,
    tags: unique.filter((tag) => !isInternalImportTag(tag)),
    importTags: unique.filter(isInternalImportTag),
  };
}
