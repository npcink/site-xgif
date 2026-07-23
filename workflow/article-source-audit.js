import {
  extractArticleSource,
  inferArticleSourceName,
  normalizeArticleSourceUrl,
  removeStructuredSourceLines,
} from "./article-source.js";
import { splitTerminalImportTags } from "./import-tags.js";

function parseDocument(markdown) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

function frontmatterValue(frontmatter, name) {
  const raw = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "mu"))?.[1]?.trim() || "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function setFrontmatterValue(frontmatter, name, value, { after = "source" } = {}) {
  const line = `${name}: ${JSON.stringify(String(value))}`;
  const pattern = new RegExp(`^${name}:.*$`, "mu");
  if (pattern.test(frontmatter)) return frontmatter.replace(pattern, line);
  const afterPattern = new RegExp(`^${after}:.*$`, "mu");
  if (afterPattern.test(frontmatter)) return frontmatter.replace(afterPattern, (match) => `${match}\n${line}`);
  return `${frontmatter}\n${line}`;
}

function frontmatterList(frontmatter, name) {
  const raw = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "mu"))?.[1]?.trim() || "[]";
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [...raw.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
  }
}

function setFrontmatterList(frontmatter, name, values) {
  const line = `${name}: ${JSON.stringify([...new Set(values)])}`;
  const pattern = new RegExp(`^${name}:.*$`, "mu");
  if (pattern.test(frontmatter)) return frontmatter.replace(pattern, line);
  return `${frontmatter}\n${line}`;
}

export function auditArticleMarkdown(markdown) {
  const parsed = parseDocument(markdown);
  if (!parsed) return { draft: false, changed: false, actions: [], issues: ["无法解析 Markdown frontmatter。"] };

  let { frontmatter, body } = parsed;
  const draft = frontmatterValue(frontmatter, "draft") === "true";

  const actions = [];
  const issues = [];
  const existingUrl = normalizeArticleSourceUrl(frontmatterValue(frontmatter, "sourceUrl"));
  const existingSource = frontmatterValue(frontmatter, "source");
  const existingKind = frontmatterValue(frontmatter, "sourceKind") || "original";
  const note = frontmatterValue(frontmatter, "note");

  if (existingUrl) {
    const inferredSource = inferArticleSourceName(existingUrl);
    if (inferredSource !== "第三方" && existingSource !== inferredSource) {
      frontmatter = setFrontmatterValue(frontmatter, "source", inferredSource);
      actions.push(`来源名称：${existingSource || "空"} → ${inferredSource}`);
    }
    if (frontmatterValue(frontmatter, "sourceUrl") !== existingUrl) {
      frontmatter = setFrontmatterValue(frontmatter, "sourceUrl", existingUrl);
      actions.push("规范化来源链接");
    }
    if (existingKind !== "publication" && existingKind !== "editorial") {
      frontmatter = setFrontmatterValue(frontmatter, "sourceKind", "publication");
      actions.push(`来源类型：${existingKind} → publication`);
    }
    const cleanedSource = removeStructuredSourceLines(body.split(/\r?\n/u), existingUrl);
    if (cleanedSource.removed) {
      body = cleanedSource.bodyLines.join("\n");
      actions.push(`移除 ${cleanedSource.removed} 行已结构化的重复来源链接`);
    }
  } else if (draft) {
    const extracted = extractArticleSource(body.split(/\r?\n/u));
    if (extracted.sourceUrl) {
      frontmatter = setFrontmatterValue(frontmatter, "source", extracted.source);
      frontmatter = setFrontmatterValue(frontmatter, "sourceUrl", extracted.sourceUrl);
      frontmatter = setFrontmatterValue(frontmatter, "sourceKind", "publication");
      body = extracted.bodyLines.join("\n").trim();
      actions.push(`从正文识别来源：${extracted.source}`);
    } else {
      if (/flomo/iu.test(note) && existingKind === "original" && /^原创(?:内容)?$/u.test(existingSource)) {
        frontmatter = setFrontmatterValue(frontmatter, "source", "来源待确认");
        frontmatter = setFrontmatterValue(frontmatter, "sourceKind", "unknown");
        actions.push("未发现来源证据：原创 → 来源待确认");
      }
      if (existingKind === "unknown" || actions.length) issues.push(extracted.sourceReviewReason);
    }
  }

  const separatedTags = splitTerminalImportTags(body.split(/\r?\n/u));
  if (separatedTags.tags.length || separatedTags.importTags.length) {
    body = separatedTags.bodyLines.join("\n");
    if (separatedTags.tags.length) {
      frontmatter = setFrontmatterList(frontmatter, "tags", [
        ...frontmatterList(frontmatter, "tags"),
        ...separatedTags.tags,
      ]);
      actions.push(`正文标签转入公开标签：${separatedTags.tags.join("、")}`);
    }
    if (separatedTags.importTags.length) {
      actions.push(`移除内部导入分组标签：${separatedTags.importTags.join("、")}`);
    }
  }

  const changed = actions.length > 0;
  return {
    draft,
    changed,
    actions,
    issues,
    importTags: separatedTags.importTags,
    markdown: changed ? `---\n${frontmatter}\n---\n\n${body.trim()}\n` : markdown,
  };
}
