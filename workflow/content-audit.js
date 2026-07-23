import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const internalNotePatterns = [
  /flomo\s*私人(?:笔记|收藏)?导入/iu,
  /请在公开前复核/iu,
  /来源待确认/iu,
  /内部导入/iu,
];

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

function createItem(type, file, parsed, repoRoot) {
  const { data, body } = parsed;
  return {
    type,
    file: portablePath(path.relative(repoRoot, file)),
    title: String(data.title || path.basename(file, path.extname(file))),
    source: String(data.source || ""),
    sourceUrl: String(data.sourceUrl || ""),
    sourceKind: String(data.sourceKind || "original"),
    draft: Boolean(data.draft) || (type === "image" && data.public === false),
    data,
    body,
    contentHash: bodyHash(body),
    blockers: [],
    warnings: [],
    notices: [],
  };
}

function auditArticle(item) {
  const { data, body, file, sourceKind, sourceUrl } = item;
  if (!String(data.title || "").trim()) item.blockers.push("缺少标题。");
  if (!String(data.summary || "").trim()) item.blockers.push("缺少摘要。");
  if (!body.trim()) item.blockers.push("缺少正文。");
  if (!Array.isArray(data.tags) || data.tags.length === 0) item.blockers.push("缺少标签。");
  if (["publication", "editorial"].includes(sourceKind) && !sourceUrl) {
    item.blockers.push("外部来源文章缺少来源链接。");
  }
  if (sourceUrl && !isValidHttpUrl(sourceUrl)) {
    item.blockers.push("来源链接不是有效的 HTTP(S) 地址。");
  }
  if (sourceKind === "unknown" && !item.draft) {
    item.blockers.push("来源待确认的文章不能公开发布。");
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
  if (normalizedBody(body).length < 80) item.warnings.push("正文较短，需要确认是否为完整内容。");
  const urls = bodyUrls(body).filter((url) => url !== sourceUrl);
  if (urls.length) item.warnings.push(`正文仍含 ${urls.length} 个未结构化链接，需要人工判断用途。`);

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
  const sourceGroups = new Map();
  const contentGroups = new Map();
  for (const item of items.filter((entry) => entry.type === "article")) {
    if (item.sourceUrl) {
      const group = sourceGroups.get(item.sourceUrl) || [];
      group.push(item);
      sourceGroups.set(item.sourceUrl, group);
    }
    const group = contentGroups.get(item.contentHash) || [];
    group.push(item);
    contentGroups.set(item.contentHash, group);
  }
  for (const group of sourceGroups.values()) {
    if (group.length <= 1) continue;
    for (const item of group) {
      item.warnings.push(`来源链接与另外 ${group.length - 1} 篇文章相同，需要确认是否为系列内容。`);
    }
  }
  for (const group of contentGroups.values()) {
    if (group.length <= 1) continue;
    for (const item of group) item.blockers.push("正文与另一篇文章完全相同，不能重复发布。");
  }
  for (const item of items) {
    item.status = item.blockers.length ? "draft" : item.warnings.length ? "review" : "ready";
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
          status: "draft",
        });
        continue;
      }
      const item = createItem(source.type, file, parsed, repoRoot);
      if (source.type === "article") auditArticle(item);
      else await auditImage(item, repoRoot);
      items.push(item);
    }
  }

  finalize(items);
  const counts = {
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    review: items.filter((item) => item.status === "review").length,
    draft: items.filter((item) => item.status === "draft").length,
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
    `- 建议退回草稿：${report.counts.draft}`,
    `- 总计：${report.counts.total}`,
    "",
  ];
  for (const [status, title] of [
    ["draft", "建议退回草稿"],
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
