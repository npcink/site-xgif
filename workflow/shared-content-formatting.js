// Self-contained so CI can validate this repository without a sibling checkout.
const CJK = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff";
const LATIN = "A-Za-z";

function protect(value, pattern, replacements) { return value.replace(pattern, (match) => { const token = `\u0000XGIF${replacements.length}\u0000`; replacements.push(match); return token; }); }

export function normalizeCjkSpacing(markdown) {
  const source = String(markdown || "").replace(/\r\n?/gu, "\n"); const replacements = []; let fenced = false;
  const result = source.split("\n").map((line) => {
    if (/^\s*(`{3,}|~{3,})/u.test(line)) { fenced = !fenced; return line; } if (fenced) return line;
    let value = protect(line, /`[^`\n]+`/gu, replacements); value = protect(value, /!?\[[^\]\n]*\]\([^\)\n]*\)/gu, replacements); value = protect(value, /https?:\/\/[^\s)]+/giu, replacements);
    return value.replace(new RegExp(`([${CJK}])(?=[${LATIN}\d])`, "gu"), "$1 ").replace(new RegExp(`([${LATIN}\d])(?=[${CJK}])`, "gu"), "$1 ").replace(/ {2,}/gu, " ");
  }).join("\n");
  return result.replace(/\u0000XGIF(\d+)\u0000/gu, (_, index) => replacements[Number(index)]);
}

function nonWhitespaceLength(value) { return [...String(value || "").replace(/\s/gu, "")].length; }
function isProseParagraph(value) { const paragraph = String(value || "").trimStart(); return paragraph && !/^(?:```|~~~|#{1,6}\s|>\s|<[\w!/]|(?:\|.*\|))/u.test(paragraph); }
function countLongProseParagraphs(markdown, maxCharacters) { let fenced = false; let count = 0; String(markdown || "").split(/(\n[ \t]*\n)/gu).forEach((part, index) => { if (index % 2) return; const startsFenced = fenced; const markers = [...part.matchAll(/^\s*(`{3,}|~{3,})/gmu)].length; if (markers % 2) fenced = !fenced; if (!startsFenced && !markers && isProseParagraph(part) && nonWhitespaceLength(part) > maxCharacters) count += 1; }); return count; }

export function organizeMarkdownParagraphs(markdown, { maxCharacters = 180 } = {}) {
  const source = String(markdown || "").replace(/\r\n?/gu, "\n"); const before = countLongProseParagraphs(source, maxCharacters); const parts = source.split(/(\n[ \t]*\n)/gu); let changedParagraphs = 0; let fenced = false;
  const body = parts.map((part, index) => { if (index % 2) return part; const startsFenced = fenced; const markers = [...part.matchAll(/^\s*(`{3,}|~{3,})/gmu)].length; if (markers % 2) fenced = !fenced; if (startsFenced || markers || !isProseParagraph(part) || nonWhitespaceLength(part) <= maxCharacters) return part; const chars = [...part]; const chunks = []; let start = 0;
    while (nonWhitespaceLength(chars.slice(start).join("")) > maxCharacters) { let count = 0; let strong = -1; let soft = -1; let whitespace = -1; for (let i = start; i < chars.length; i += 1) { if (!/\s/u.test(chars[i])) count += 1; if (count > maxCharacters) break; if (/\s/u.test(chars[i])) whitespace = i + 1; if (/[。！？!?…]/u.test(chars[i])) strong = i + 1; else if (/[；，：;]/u.test(chars[i])) soft = i + 1; } const end = strong > start ? strong : soft > start ? soft : whitespace > start ? whitespace : -1; if (end < 0) return part; chunks.push(chars.slice(start, end).join("")); start = end; } chunks.push(chars.slice(start).join("")); changedParagraphs += 1; return chunks.join("\n\n"); }).join("");
  const remaining = countLongProseParagraphs(body, maxCharacters); return { markdown: body, changed: body !== source, changedParagraphs, longParagraphsBefore: before, remainingLongParagraphs: remaining, remainingReasons: remaining ? [{ code: "NO_SAFE_BOUNDARY", count: remaining }] : [] };
}
