import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  isExternalArticle,
  isLegacyArticleDisclosure,
} from "./article-publication.js";
import { isContentId } from "./content-id.js";
import { CANONICAL_TAGS } from "./content-taxonomy.js";
import {
  localAssetFileFromUrl,
  referencedLocalAssetFiles,
} from "./publication-bundle.js";

const internalNotePatterns = [
  /flomo\s*私人(?:笔记|收藏)?导入/iu,
  /请在公开前复核/iu,
  /来源待确认/iu,
  /内部导入/iu,
];

const rawArticleHtml = /<(?!https?:\/\/)\s*(?:\/?\s*[A-Za-z][^>]*|!--[\s\S]*?--)>/iu;

function portablePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function parseValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (value === "true" || value === "false") return value === "true";
  if (value.startsWith('"') || value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.replace(/^['"]|['"]$/gu, "");
    }
  }
  return value.replace(/^['"]|['"]$/gu, "");
}

export function parseContentDocument(markdown) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u);
    if (field) data[field[1]] = parseValue(field[2]);
  }
  return { data, body: match[2].trim() };
}

function normalizedBody(body) {
  return String(body || "")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/[#*_>`~\-[\]()]/gu, " ")
    .replace(/\s+/gu, "")
    .toLowerCase();
}

function bodyHash(body) {
  return createHash("sha256").update(normalizedBody(body)).digest("hex");
}

function bodyUrls(body) {
  return [...String(body || "").matchAll(/https?:\/\/[^\s<>()\]]+/giu)]
    .map((match) => match[0].replace(/[.,，。；;!?！？]+$/u, ""));
}

function isGenericSourceUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/u, "");
    return !pathname || pathname === "/";
  } catch {
    return false;
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function numberedSeriesIdentity(title) {
  const match = String(title || "").trim().match(
    /^(.{2,}?)(0\d{1,2})(?=\s*(?:[:：—-]|\s|$))/u,
  );
  if (!match) return null;
  return {
    name: match[1].trim(),
    part: Number(match[2]),
  };
}

function isExplicitNumberedSeries(group) {
  const identities = group.map((item) => numberedSeriesIdentity(item.title));
  if (identities.some((identity) => !identity)) return false;
  return identities.every((identity) => identity.name === identities[0].name)
    && new Set(identities.map((identity) => identity.part)).size === identities.length;
}

function createItem(type, file, parsed, repoRoot) {
  const { data, body } = parsed;
  return {
    type,
    file: portablePath(path.relative(repoRoot, file)),
    title: String(data.title || path.basename(file, path.extname(file))),
    source: String(data.source || ""),
    sourceUrl: String(data.sourceUrl || ""),
    sourceKind: String(data.sourceKind || "original"),
    contentId: String(data.contentId || ""),
    draft: Boolean(data.draft) || (type === "image" && data.public === false),
    data,
    body,
    contentHash: bodyHash(body),
    blockers: [],
    warnings: [],
    notices: [],
  };
}

async function auditArticle(item, repoRoot) {
  const { data, body, file, sourceKind, sourceUrl } = item;
  if (!String(data.title || "").trim()) item.blockers.push("缺少标题。");
  if (!String(data.summary || "").trim()) item.blockers.push("缺少摘要。");
  if (!body.trim()) item.blockers.push("缺少正文。");
  if (rawArticleHtml.test(body)) {
    item.blockers.push("正文包含原始 HTML；导入文章只能使用纯文本和 Markdown。");
  }
  if (!Array.isArray(data.tags) || data.tags.length === 0) item.blockers.push("缺少标签。");
  if (Array.isArray(data.tags) && data.tags.some((tag) => !CANONICAL_TAGS.includes(tag))) {
    item.blockers.push("包含未纳入规范词表的标签。");
  }
  const recommendationGroup = String(data.recommendationGroup || "").trim();
  if (!recommendationGroup) {
    if (item.draft) {
      item.blockers.push("推荐分组尚未人工确认，发布前必须选择“通用内容”或“成人幽默”。");
    } else {
      item.recommendationGroupDebt = true;
      item.warnings.push("历史已发布内容缺少推荐分组；保持现有线上状态，但下次编辑或同步前必须人工确认。");
    }
  } else if (!["general", "adult-humor"].includes(recommendationGroup)) {
    item.blockers.push("推荐分组无效，只允许“通用内容”或“成人幽默”。");
  }
  if (["publication", "editorial"].includes(sourceKind) && !sourceUrl) {
    item.blockers.push("外部来源文章缺少来源链接。");
  }
  if (isExternalArticle(data) && !item.draft && isLegacyArticleDisclosure(body)) {
    item.blockers.push("外部来源公开文章仍是旧摘要占位，必须从私有来源库恢复完整正文。");
  }
  if (sourceUrl && !isValidHttpUrl(sourceUrl)) {
    item.blockers.push("来源链接不是有效的 HTTP(S) 地址。");
  }
  if (sourceKind === "unknown") {
    item.notices.push("来源链接缺失；公开页会明确显示“来源待确认”。");
  }
  const internalNote = String(data.internalNote || "").trim();
  const internalReviewStatus = String(data.internalReviewStatus || "unresolved").trim();
  if (internalNote && internalReviewStatus !== "resolved") {
    if (item.draft) {
      item.blockers.push("内部复核备注尚未确认，不能进入发布流程。");
    } else {
      item.legacyReviewDebt = true;
      item.warnings.push("历史已发布内容仍有内部复核备注未确认；保持现有线上状态，但下次编辑或同步前必须完成复核。");
    }
  }
  if (sourceUrl && isGenericSourceUrl(sourceUrl)) {
    item.warnings.push("来源链接只指向网站首页，需要确认具体原文地址。");
  }
  if (/待整理|未命名|^满纸荒唐言\d+$/u.test(item.title)) {
    item.warnings.push("标题仍像临时候选标题，需要人工确认。");
  }
  if (/待整理/iu.test(path.basename(file))) {
    item.warnings.push("文件名仍含“待整理”，建议在首次云端发布前重命名。");
  }
  const summaryLength = String(data.summary || "").replace(/\s+/gu, "").length;
  if (summaryLength > 0 && summaryLength < 24) item.warnings.push("摘要过短，可能不足以说明内容重点。");
  if (summaryLength > 180) item.warnings.push("摘要过长，建议压缩到 180 字以内。");
  if (normalizedBody(body).length < 80) {
    item.warnings.push("正文较短，需要确认是否为完整内容。");
  }
  const longParagraphs = String(body || "")
    .split(/\n[ \t]*\n/gu)
    .map((paragraph) => [...paragraph.replace(/\s/gu, "")].length)
    .filter((length) => length > 180);
  if (longParagraphs.length) {
    item.warnings.push(`正文含 ${longParagraphs.length} 个超过 180 字的长段落（最长 ${Math.max(...longParagraphs)} 字），建议分段后再发布。`);
  }
  const urls = bodyUrls(body).filter((url) => url !== sourceUrl);
  if (urls.length) item.warnings.push(`正文仍含 ${urls.length} 个未结构化链接，需要人工判断用途。`);
  const localAssetFiles = [
    localAssetFileFromUrl(data.coverImage),
    ...referencedLocalAssetFiles(body),
  ].filter(Boolean);
  for (const assetFile of [...new Set(localAssetFiles)]) {
    try {
      await access(path.join(repoRoot, assetFile));
    } catch {
      item.blockers.push(`文章引用的本地图片不存在：${assetFile}。`);
    }
  }

  const legacyNote = String(data.note || "");
  if (legacyNote && internalNotePatterns.some((pattern) => pattern.test(legacyNote))) {
    item.notices.push("旧 note 字段是内部复核提醒，待迁移到 internalNote。");
  } else if (legacyNote) {
    item.notices.push("旧 note 字段是公开编辑手记，待迁移到 editorNote。");
  }
}

async function auditImage(item, repoRoot) {
  const { data } = item;
  if (!String(data.title || "").trim()) item.blockers.push("缺少标题。");
  if (!String(data.description || "").trim()) item.blockers.push("缺少描述。");
  if (!String(data.image || "").trim()) item.blockers.push("缺少图片地址。");
  if (!Array.isArray(data.tags) || data.tags.length === 0) item.blockers.push("缺少标签。");
  if (Array.isArray(data.tags) && data.tags.some((tag) => !CANONICAL_TAGS.includes(tag))) {
    item.blockers.push("包含未纳入规范词表的标签。");
  }
  if (String(data.image || "").startsWith("/")) {
    const asset = path.join(repoRoot, "site", "public", String(data.image).replace(/^\/+/u, ""));
    try {
      await access(asset);
    } catch {
      item.blockers.push("本地图片文件不存在。");
    }
  }
  if (item.sourceKind === "unknown") {
    item.notices.push("来源待核实；公开页必须继续保留投诉与下架入口。");
  }
}

function finalize(items) {
  const contentIdGroups = new Map();
  const sourceGroups = new Map();
  const contentGroups = new Map();
  for (const item of items.filter((entry) => entry.type === "article")) {
    if (item.sourceUrl && !isGenericSourceUrl(item.sourceUrl)) {
      const group = sourceGroups.get(item.sourceUrl) || [];
      group.push(item);
      sourceGroups.set(item.sourceUrl, group);
    }
    if (!isLegacyArticleDisclosure(item.body)) {
      const group = contentGroups.get(item.contentHash) || [];
      group.push(item);
      contentGroups.set(item.contentHash, group);
    }
  }
  for (const item of items) {
    if (!isContentId(item.contentId)) {
      item.blockers.push("缺少有效的稳定内容 ID。");
      continue;
    }
    if (path.basename(item.file, path.extname(item.file)) !== item.contentId) {
      item.blockers.push("内容文件名必须与稳定内容 ID 一致。");
    }
    const group = contentIdGroups.get(item.contentId) || [];
    group.push(item);
    contentIdGroups.set(item.contentId, group);
  }
  for (const group of contentIdGroups.values()) {
    if (group.length <= 1) continue;
    for (const item of group) item.blockers.push("稳定内容 ID 与另一条内容重复。");
  }
  for (const group of sourceGroups.values()) {
    if (group.length <= 1) continue;
    if (isExplicitNumberedSeries(group)) {
      for (const item of group) {
        item.notices.push("相同来源链接已由明确且不重复的编号标题标记为系列内容。");
      }
      continue;
    }
    for (const item of group) {
      const relatedTitles = group
        .filter((entry) => entry !== item)
        .slice(0, 3)
        .map((entry) => `《${entry.title}》`)
        .join("、");
      item.warnings.push(`相同来源链接还用于 ${relatedTitles}。如果是同一原文拆分内容可以保留；否则请修改链接。`);
    }
  }
  for (const group of contentGroups.values()) {
    if (group.length <= 1) continue;
    for (const item of group) item.blockers.push("正文与另一篇文章完全相同，不能重复发布。");
  }
  for (const item of items) {
    item.status = item.blockers.length ? "blocked" : item.warnings.length ? "review" : "ready";
    delete item.data;
    delete item.body;
    delete item.contentHash;
    delete item.localAsset;
  }
  return items;
}

async function listMarkdown(directory) {
  return (await readdir(directory))
    .filter((file) => /\.mdx?$/iu.test(file))
    .sort()
    .map((file) => path.join(directory, file));
}

export async function auditContentLibrary({ repoRoot }) {
  const sources = [
    { type: "article", directory: path.join(repoRoot, "site", "src", "content", "articles") },
    { type: "image", directory: path.join(repoRoot, "site", "src", "content", "images") },
  ];
  const items = [];
  for (const source of sources) {
    for (const file of await listMarkdown(source.directory)) {
      const parsed = parseContentDocument(await readFile(file, "utf8"));
      if (!parsed) {
        items.push({
          type: source.type,
          file: portablePath(path.relative(repoRoot, file)),
          title: path.basename(file),
          source: "",
          sourceUrl: "",
          sourceKind: "",
          draft: true,
          blockers: ["无法解析 Markdown frontmatter。"],
          warnings: [],
          notices: [],
          status: "blocked",
        });
        continue;
      }
      const item = createItem(source.type, file, parsed, repoRoot);
      if (source.type === "article") await auditArticle(item, repoRoot);
      else await auditImage(item, repoRoot);
      items.push(item);
    }
  }

  finalize(items);
  const counts = {
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    review: items.filter((item) => item.status === "review").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    legacyReviewDebt: items.filter((item) => item.legacyReviewDebt).length,
    recommendationGroupDebt: items.filter((item) => item.recommendationGroupDebt).length,
  };
  return { generatedAt: new Date().toISOString(), counts, items };
}

function escapeCell(value) {
  return String(value || "").replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
}

export function renderContentAuditMarkdown(report) {
  const lines = [
    "# XGIF 内容上线体检",
    "",
    `生成时间：${report.generatedAt}`,
    "",
    `- 可直接上线：${report.counts.ready}`,
    `- 需要人工确认：${report.counts.review}`,
    `- 阻断发布：${report.counts.blocked}`,
    `- 历史复核债务：${report.counts.legacyReviewDebt}`,
    `- 推荐分组债务：${report.counts.recommendationGroupDebt}`,
    `- 总计：${report.counts.total}`,
    "",
  ];
  for (const [status, title] of [
    ["blocked", "阻断发布"],
    ["review", "需要人工确认"],
    ["ready", "可直接上线"],
  ]) {
    const items = report.items.filter((item) => item.status === status);
    lines.push(`## ${title}（${items.length}）`, "");
    if (!items.length) {
      lines.push("无。", "");
      continue;
    }
    lines.push("| 类型 | 标题 | 来源 | 问题或说明 | 文件 |", "| --- | --- | --- | --- | --- |");
    for (const item of items) {
      const details = [...item.blockers, ...item.warnings, ...item.notices].join("；") || "检查通过";
      lines.push(`| ${item.type === "article" ? "文章" : "图片"} | ${escapeCell(item.title)} | ${escapeCell(item.source)} | ${escapeCell(details)} | \`${escapeCell(item.file)}\` |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}
