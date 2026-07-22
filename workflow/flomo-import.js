import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const zipLocalHeader = 0x04034b50;
const zipCentralHeader = 0x02014b50;
const zipEndOfCentralDirectory = 0x06054b50;

function importError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);

  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }
    return named.get(entity.toLowerCase()) ?? match;
  });
}

function safeLink(href, label) {
  const decodedHref = decodeHtmlEntities(href).trim();
  try {
    const url = new URL(decodedHref);
    if (!["http:", "https:"].includes(url.protocol)) return label;
    return `[${label || url.hostname}](${url.href})`;
  } catch {
    return label;
  }
}

function htmlFragmentToMarkdown(fragment) {
  let value = String(fragment || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
      const cleanLabel = decodeHtmlEntities(label.replace(/<[^>]+>/g, "")).trim();
      return safeLink(href, cleanLabel);
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|blockquote|h[1-6])\s*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "- ")
    .replace(/<\s*blockquote\b[^>]*>/gi, "> ")
    .replace(/<[^>]+>/g, "");

  value = decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return value;
}

function hasClass(tag, className) {
  const match = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
  return Boolean(match?.[1].split(/\s+/).includes(className));
}

function classBlockStartPattern(className) {
  return new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "gi");
}

function extractMemoSegments(html) {
  const starts = [];
  for (const match of String(html || "").matchAll(classBlockStartPattern("memo"))) {
    if (hasClass(match[0], "memo")) starts.push(match.index);
  }
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function extractMemoField(segment, className, nextClassName = "") {
  const startPattern = classBlockStartPattern(className);
  const start = startPattern.exec(segment);
  if (!start) return "";
  const contentStart = start.index + start[0].length;
  if (nextClassName) {
    const nextPattern = classBlockStartPattern(nextClassName);
    nextPattern.lastIndex = contentStart;
    const next = nextPattern.exec(segment);
    if (next) return segment.slice(contentStart, next.index);
  }
  const close = segment.indexOf("</div>", contentStart);
  return segment.slice(contentStart, close >= 0 ? close : segment.length);
}

function terminalTags(lines) {
  const bodyLines = [...lines];
  const tags = [];
  while (bodyLines.length) {
    const line = bodyLines.at(-1);
    if (!/^(?:#[^\s#]+\s*)+$/.test(line)) break;
    tags.unshift(...[...line.matchAll(/#([^\s#]+)/g)].map((match) => match[1]));
    bodyLines.pop();
  }
  return { bodyLines, tags: [...new Set(tags)] };
}

export function normalizeImportText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

export function contentHash(value) {
  return createHash("sha256").update(normalizeImportText(value)).digest("hex");
}

function ngrams(value, size = 2) {
  const normalized = normalizeImportText(value);
  if (!normalized) return [];
  if (normalized.length <= size) return [normalized];
  return Array.from({ length: normalized.length - size + 1 }, (_item, index) => normalized.slice(index, index + size));
}

export function diceSimilarity(left, right) {
  const leftGrams = ngrams(left);
  const rightGrams = ngrams(right);
  if (!leftGrams.length || !rightGrams.length) return 0;
  const counts = new Map();
  for (const gram of leftGrams) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of rightGrams) {
    const count = counts.get(gram) || 0;
    if (!count) continue;
    overlap += 1;
    counts.set(gram, count - 1);
  }
  return (2 * overlap) / (leftGrams.length + rightGrams.length);
}

function suggestedTitle(body, pubDate, index) {
  const firstLine = body.split(/\n/).map((line) => line.trim()).find(Boolean) || "";
  const clean = firstLine.replace(/^#+\s*/, "").replace(/[。！？!?；;：:]$/, "");
  const needsTitle = !clean || clean.length > 40;
  return {
    title: needsTitle ? `待整理 · ${pubDate || "未注明日期"} · ${index + 1}` : clean,
    needsTitle,
  };
}

function suggestedSummary(body) {
  const plain = body
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
}

export function parseFlomoHtml(html) {
  const segments = extractMemoSegments(String(html || ""));
  if (!segments.length) throw importError("没有在 HTML 中找到 flomo memo。请使用 flomo 官方导出文件。");

  return segments.map((segment, index) => {
    const timeText = htmlFragmentToMarkdown(extractMemoField(segment, "time"));
    const rawBody = htmlFragmentToMarkdown(extractMemoField(segment, "content", "files"));
    const { bodyLines, tags } = terminalTags(rawBody.split(/\n/).map((line) => line.trim()).filter(Boolean));
    const body = bodyLines.join("\n\n").trim();
    if (!body) throw importError(`第 ${index + 1} 条 memo 没有可导入的正文。`);
    const pubDateMatch = timeText.match(/^\d{4}-\d{2}-\d{2}/);
    const pubDate = pubDateMatch?.[0] || new Date().toISOString().slice(0, 10);
    const suggestion = suggestedTitle(body, pubDate, index);
    const hash = contentHash(body);
    const charCount = [...body.replace(/\s/g, "")].length;

    return {
      id: `${hash}-${index + 1}`,
      contentHash: hash,
      pubDate,
      recordedAt: timeText,
      title: suggestion.title,
      summary: suggestedSummary(body),
      tags,
      readTime: `${Math.max(1, Math.ceil(charCount / 500))} 分钟`,
      note: "从 flomo 私人笔记导入，请在公开前复核。",
      body,
      charCount,
      needsTitle: suggestion.needsTitle,
      needsReview: suggestion.needsTitle || charCount < 120,
    };
  });
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === zipEndOfCentralDirectory) return offset;
  }
  throw importError("ZIP 缺少中央目录，文件可能已损坏。", 400);
}

function decodeZipName(buffer, utf8) {
  if (utf8) return buffer.toString("utf8");
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return buffer.toString("latin1");
  }
}

function safeZipPath(name) {
  const normalized = String(name || "").replaceAll("\\", "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized) && !normalized.split("/").includes("..");
}

export function readZipEntries(buffer, { maxEntries = 1_000, maxUncompressedBytes = 50 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== zipLocalHeader) {
    throw importError("上传的文件不是有效 ZIP。", 400);
  }

  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > maxEntries) throw importError(`ZIP 文件条目超过 ${maxEntries} 个限制。`, 413);
  if (centralOffset + centralSize > buffer.length) throw importError("ZIP 中央目录越界，文件可能已损坏。", 400);

  const entries = [];
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== zipCentralHeader) {
      throw importError("ZIP 中央目录格式无效。", 400);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeZipName(nameBytes, Boolean(flags & 0x0800));

    if (!safeZipPath(name)) throw importError("ZIP 包含不安全路径，已拒绝读取。", 400);
    if (flags & 0x0001) throw importError("不支持加密 ZIP。请导出未加密文件。", 400);
    if (![0, 8].includes(method)) throw importError("ZIP 使用了不支持的压缩算法。", 400);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxUncompressedBytes) throw importError("ZIP 解压后内容过大。", 413);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== zipLocalHeader) {
      throw importError("ZIP 本地文件头无效。", 400);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.length) throw importError("ZIP 文件内容越界。", 400);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxUncompressedBytes });
    if (data.length !== uncompressedSize) throw importError("ZIP 文件长度校验失败。", 400);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function parseFlomoZipData(fileData, options = {}) {
  const match = String(fileData || "").match(/^data:application\/(?:zip|x-zip-compressed|octet-stream);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw importError("请选择 flomo 导出的 ZIP 文件。", 400);
  const buffer = Buffer.from(match[1], "base64");
  const maxZipBytes = options.maxZipBytes || 10 * 1024 * 1024;
  if (!buffer.length) throw importError("ZIP 文件为空。", 400);
  if (buffer.length > maxZipBytes) throw importError(`ZIP 文件超过 ${Math.floor(maxZipBytes / 1024 / 1024)} MB 限制。`, 413);
  const htmlEntries = readZipEntries(buffer, options).filter((entry) => entry.name.toLowerCase().endsWith(".html"));
  if (!htmlEntries.length) throw importError("ZIP 中没有找到 flomo 导出的 HTML。", 400);
  const candidates = htmlEntries.map((entry) => ({ entry, items: parseFlomoHtml(entry.data.toString("utf8")) }));
  candidates.sort((left, right) => right.items.length - left.items.length);
  return candidates[0].items;
}
