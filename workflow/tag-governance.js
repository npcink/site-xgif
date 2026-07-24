import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseContentDocument } from "./content-audit.js";
import { CANONICAL_TAGS } from "./content-taxonomy.js";

function portablePath(value) {
  return String(value || "").split(path.sep).join("/");
}

async function listMarkdown(directory) {
  try {
    return (await readdir(directory))
      .filter((file) => /\.mdx?$/iu.test(file))
      .sort()
      .map((file) => path.join(directory, file));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function normalizedKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function replaceTagsLine(markdown, tags) {
  const line = `tags: ${JSON.stringify(tags)}`;
  if (!/^tags:\s*.*$/mu.test(markdown)) {
    throw new Error("内容缺少可更新的 tags 字段。");
  }
  return markdown.replace(/^tags:\s*.*$/mu, line);
}

async function writeTextAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

export async function inspectTagGovernance({ repoRoot }) {
  const sources = [
    { type: "article", directory: path.join(repoRoot, "site", "src", "content", "articles") },
    { type: "image", directory: path.join(repoRoot, "site", "src", "content", "images") },
  ];
  const usage = new Map();
  const documents = [];

  for (const source of sources) {
    for (const filePath of await listMarkdown(source.directory)) {
      const markdown = await readFile(filePath, "utf8");
      const parsed = parseContentDocument(markdown);
      if (!parsed) continue;
      const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
      const document = {
        type: source.type,
        file: portablePath(path.relative(repoRoot, filePath)),
        filePath,
        title: String(parsed.data.title || path.basename(filePath)),
        draft: Boolean(parsed.data.draft) || (source.type === "image" && parsed.data.public === false),
        tags,
      };
      documents.push(document);
      for (const tag of tags) {
        const current = usage.get(tag) || {
          name: tag,
          total: 0,
          articles: 0,
          images: 0,
          drafts: 0,
          published: 0,
          canonical: CANONICAL_TAGS.includes(tag),
          similar: [],
        };
        current.total += 1;
        current[source.type === "article" ? "articles" : "images"] += 1;
        current[document.draft ? "drafts" : "published"] += 1;
        usage.set(tag, current);
      }
    }
  }

  const tags = [...usage.values()]
    .map((tag) => ({
      ...tag,
      similar: [...usage.keys()]
        .filter((candidate) => candidate !== tag.name && normalizedKey(candidate) === normalizedKey(tag.name))
        .sort(),
    }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "zh-CN"));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      tags: tags.length,
      canonicalUsed: tags.filter((tag) => tag.canonical).length,
      nonCanonical: tags.filter((tag) => !tag.canonical).length,
      duplicateForms: tags.filter((tag) => tag.similar.length).length,
      content: documents.length,
    },
    canonicalTags: [...CANONICAL_TAGS],
    tags,
    documents,
  };
}

export async function planTagMerge({ repoRoot, fromTag, toTag }) {
  const source = String(fromTag || "").trim();
  const target = String(toTag || "").trim();
  if (!source || !target || source === target) {
    throw new Error("请选择两个不同的来源标签和目标标签。");
  }
  if (!CANONICAL_TAGS.includes(target)) {
    throw new Error("目标标签必须来自规范词表。");
  }
  const report = await inspectTagGovernance({ repoRoot });
  const affected = report.documents
    .filter((document) => document.tags.includes(source))
    .map((document) => ({
      type: document.type,
      file: document.file,
      title: document.title,
      before: document.tags,
      after: [...new Set(document.tags.map((tag) => tag === source ? target : tag))],
    }));
  return {
    ok: true,
    fromTag: source,
    toTag: target,
    confirmation: `将 ${source} 合并到 ${target}`,
    affected,
    count: affected.length,
  };
}

export async function applyTagMerge({ repoRoot, fromTag, toTag, confirmation }) {
  const plan = await planTagMerge({ repoRoot, fromTag, toTag });
  if (!plan.count) throw new Error("没有内容使用这个来源标签。");
  if (String(confirmation || "") !== plan.confirmation) {
    throw new Error(`确认文字不匹配，请输入“${plan.confirmation}”。`);
  }

  const changedFiles = [];
  for (const item of plan.affected) {
    const filePath = path.resolve(repoRoot, item.file);
    const markdown = await readFile(filePath, "utf8");
    await writeTextAtomic(filePath, replaceTagsLine(markdown, item.after));
    changedFiles.push(item.file);
  }
  return { ...plan, changedFiles };
}
