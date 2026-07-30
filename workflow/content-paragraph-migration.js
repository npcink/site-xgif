import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { organizeMarkdownParagraphs } from "./article-paragraph-formatting.js";
import { auditContentLibrary } from "./content-audit.js";

function splitMarkdown(markdown) {
  const match = String(markdown || "").match(
    /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*?)((?:\r?\n)*)$/u,
  );
  if (!match) throw new Error("无法解析文章 Markdown。");
  return {
    prefix: match[1],
    body: match[2],
    trailing: match[3] || "",
  };
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function migratePublishedArticleParagraphs({
  repoRoot,
  apply = false,
  maxCharacters = 180,
  files,
}) {
  const candidates = files || (await auditContentLibrary({ repoRoot })).items
    .filter((item) => (
      item.type === "article"
      && !item.draft
      && item.warnings.some((warning) => warning.includes(`超过 ${maxCharacters} 字的长段落`))
    ))
    .map((item) => item.file);
  const migrations = [];
  const blocked = [];

  for (const file of candidates) {
    const filePath = path.join(repoRoot, file);
    const markdown = await readFile(filePath, "utf8");
    const parsed = splitMarkdown(markdown);
    const result = organizeMarkdownParagraphs(parsed.body, { maxCharacters });
    const summary = {
      file,
      paragraphFormatting: result.paragraphFormatting,
      changedParagraphs: result.changedParagraphs,
      longBefore: result.longBefore,
      longAfter: result.longAfter,
      unsplittableParagraphs: result.unsplittableParagraphs,
    };
    if (result.longAfter > 0 || result.paragraphFormatting !== "applied") {
      blocked.push(summary);
      continue;
    }
    migrations.push({
      ...summary,
      content: `${parsed.prefix}${result.body}${parsed.trailing}`,
    });
  }

  if (apply && blocked.length) {
    const error = new Error(
      `仍有 ${blocked.length} 篇文章无法仅靠安全断句完成分段；未写入任何文件。`,
    );
    error.blocked = blocked;
    throw error;
  }
  if (apply) {
    for (const migration of migrations) {
      await writeAtomic(path.join(repoRoot, migration.file), migration.content);
    }
  }

  return {
    ok: blocked.length === 0,
    applied: apply,
    maxCharacters,
    candidates: candidates.length,
    migrated: migrations.map(({ content, ...migration }) => migration),
    blocked,
  };
}
