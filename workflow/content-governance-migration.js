import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArticlePublication } from "./article-publication.js";
import { parseContentDocument } from "./content-audit.js";
import { normalizeContentTags } from "./content-taxonomy.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const contentRoot = path.join(repoRoot, "site", "src", "content");

const reviewArticleIds = new Set([
  "20250722-n20d",
  "20250722-yphk",
  "20250801-ohi2",
  "20260126-dh4w",
  "20260126-fox0",
  "20260126-nkp6",
  "20260126-poye",
  "20260624-1qfk",
  "20260722-3u91",
]);

function frontmatterOf(markdown) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) throw new Error("无法解析内容 frontmatter。");
  return match[1];
}

function setField(frontmatter, field, value) {
  const line = `${field}: ${value}`;
  const pattern = new RegExp(`^${field}:.*$`, "mu");
  return pattern.test(frontmatter)
    ? frontmatter.replace(pattern, line)
    : `${frontmatter}\n${line}`;
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

async function markdownFiles(type) {
  const directory = path.join(contentRoot, type);
  return (await readdir(directory))
    .filter((file) => /\.mdx?$/iu.test(file))
    .sort()
    .map((file) => path.join(directory, file));
}

async function migrateArticle(filePath) {
  const markdown = await readFile(filePath, "utf8");
  const parsed = parseContentDocument(markdown);
  if (!parsed) throw new Error(`无法解析 ${path.relative(repoRoot, filePath)}`);

  const contentId = String(parsed.data.contentId || "");
  const draft = reviewArticleIds.has(contentId) || Boolean(parsed.data.draft);
  const tags = normalizeContentTags(parsed.data.tags, { type: "article" });
  const prepared = await prepareArticlePublication({
    ...parsed.data,
    contentId,
    draft,
    body: parsed.body,
  }, { workflowRoot });

  let frontmatter = frontmatterOf(markdown);
  frontmatter = setField(frontmatter, "tags", JSON.stringify(tags));
  frontmatter = setField(frontmatter, "draft", String(draft));
  const migrated = `---\n${frontmatter}\n---\n\n${prepared.payload.body.trim()}\n`;
  if (migrated !== markdown) await writeAtomic(filePath, migrated);
  return {
    contentId,
    draft,
    privateSource: Boolean(prepared.privateSourcePath),
    changed: migrated !== markdown,
  };
}

async function migrateImage(filePath) {
  const markdown = await readFile(filePath, "utf8");
  const parsed = parseContentDocument(markdown);
  if (!parsed) throw new Error(`无法解析 ${path.relative(repoRoot, filePath)}`);
  const tags = normalizeContentTags(parsed.data.tags, { type: "image" });
  const frontmatter = setField(frontmatterOf(markdown), "tags", JSON.stringify(tags));
  const migrated = `---\n${frontmatter}\n---\n\n${parsed.body.trim()}${parsed.body.trim() ? "\n" : ""}`;
  if (migrated !== markdown) await writeAtomic(filePath, migrated);
  return { changed: migrated !== markdown };
}

const articleResults = [];
for (const filePath of await markdownFiles("articles")) {
  articleResults.push(await migrateArticle(filePath));
}
const imageResults = [];
for (const filePath of await markdownFiles("images")) {
  imageResults.push(await migrateImage(filePath));
}

console.log(JSON.stringify({
  ok: true,
  articles: articleResults.length,
  articleFilesChanged: articleResults.filter((item) => item.changed).length,
  privateSources: articleResults.filter((item) => item.privateSource).length,
  reviewDrafts: articleResults.filter((item) => item.draft).length,
  images: imageResults.length,
  imageFilesChanged: imageResults.filter((item) => item.changed).length,
}, null, 2));
