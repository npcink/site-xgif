import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentIdDatePrefix, isContentId } from "./content-id.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const siteRoot = path.join(repoRoot, "site");
const contentSources = [
  { type: "article", directory: path.join(siteRoot, "src", "content", "articles") },
  { type: "image", directory: path.join(siteRoot, "src", "content", "images") },
];
const ledgerFiles = [
  path.join(workflowRoot, "records", "flomo-imports.jsonl"),
  path.join(workflowRoot, "records", "r2-assets.jsonl"),
  path.join(workflowRoot, "records", "user-provided-assets.jsonl"),
];

function frontmatterField(markdown, name) {
  return String(markdown || "").match(new RegExp(`^${name}:\\s*["']?([^\\n"']+)`, "mu"))?.[1]?.trim() || "";
}

function withContentId(markdown, contentId) {
  if (/^contentId:/mu.test(markdown)) {
    return markdown.replace(/^contentId:.*$/mu, `contentId: "${contentId}"`);
  }
  return markdown.replace(/^(title:.*)$/mu, `$1\ncontentId: "${contentId}"`);
}

function deterministicSuffix(seed, attempt) {
  const value = createHash("sha256").update(`${seed}\0${attempt}`).digest().readUInt32BE(0);
  return (value % (36 ** 4)).toString(36).padStart(4, "0");
}

function assignContentId({ type, legacyId, pubDate, currentId }, occupied) {
  if (isContentId(currentId) && !occupied.has(currentId)) {
    occupied.add(currentId);
    return currentId;
  }

  const prefix = contentIdDatePrefix(pubDate);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const contentId = `${prefix}-${deterministicSuffix(`${type}:${legacyId}`, attempt)}`;
    if (!occupied.has(contentId)) {
      occupied.add(contentId);
      return contentId;
    }
  }
  throw new Error(`无法为 ${type}:${legacyId} 分配唯一内容 ID。`);
}

async function exists(file) {
  return stat(file).then(() => true).catch(() => false);
}

async function readEntries() {
  const entries = [];
  for (const source of contentSources) {
    const files = (await readdir(source.directory)).filter((file) => /\.mdx?$/iu.test(file)).sort();
    for (const file of files) {
      const filePath = path.join(source.directory, file);
      const markdown = await readFile(filePath, "utf8");
      entries.push({
        ...source,
        filePath,
        extension: path.extname(file),
        legacyId: path.basename(file, path.extname(file)),
        markdown,
        currentId: frontmatterField(markdown, "contentId"),
        pubDate: frontmatterField(markdown, "pubDate"),
      });
    }
  }
  return entries;
}

async function updateLedgers(pathMap) {
  for (const file of ledgerFiles) {
    if (!(await exists(file))) continue;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
    const next = lines.map((line) => {
      if (!line.trim()) return "";
      const record = JSON.parse(line);
      if (record.contentFile && pathMap.has(record.contentFile)) {
        record.contentFile = pathMap.get(record.contentFile);
      }
      return JSON.stringify(record);
    });
    await writeFile(file, `${next.filter(Boolean).join("\n")}\n`, "utf8");
  }
}

export async function migrateContentIds() {
  const occupied = new Set();
  const entries = await readEntries();
  const migrations = entries.map((entry) => ({
    ...entry,
    contentId: assignContentId(entry, occupied),
  }));
  const destinationSet = new Set();

  for (const item of migrations) {
    const destination = path.join(item.directory, `${item.contentId}${item.extension}`);
    if (destinationSet.has(destination)) throw new Error(`迁移目标重复：${destination}`);
    destinationSet.add(destination);
    if (destination !== item.filePath && await exists(destination)) {
      throw new Error(`迁移目标已经存在：${destination}`);
    }
  }

  const pathMap = new Map();
  for (const item of migrations) {
    const destination = path.join(item.directory, `${item.contentId}${item.extension}`);
    await writeFile(item.filePath, withContentId(item.markdown, item.contentId), "utf8");
    if (destination !== item.filePath) await rename(item.filePath, destination);
    pathMap.set(path.relative(repoRoot, item.filePath), path.relative(repoRoot, destination));
  }

  await updateLedgers(pathMap);
  return {
    migrated: migrations.length,
    pathMap,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await migrateContentIds();
  console.log(`已迁移 ${result.migrated} 条内容到稳定 ID。`);
}
