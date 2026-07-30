import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditContentLibrary } from "./content-audit.js";

export const adultHumorContentIds = new Set([
  "20250722-n20d",
  "20251104-ee5g",
  "20260109-vbn5",
  "20260122-6x9g",
  "20260124-0suv",
  "20260126-nkp6",
  "20260306-1ahz",
  "20260306-xfpa",
  "20260624-5e6f",
  "20260722-1x4w",
  "20260722-dowv",
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

function replaceFrontmatter(markdown, frontmatter) {
  return String(markdown).replace(
    /^---\r?\n[\s\S]*?\r?\n---/u,
    `---\n${frontmatter}\n---`,
  );
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

export async function migratePublishedContentDebt({
  repoRoot,
  apply = false,
  resolvedAt = new Date().toISOString(),
}) {
  const report = await auditContentLibrary({ repoRoot });
  const candidates = report.items.filter((item) => (
    item.type === "article"
    && !item.draft
    && (item.recommendationGroupDebt || item.legacyReviewDebt)
  ));
  const migrations = [];
  for (const item of candidates) {
    const filePath = path.join(repoRoot, item.file);
    const markdown = await readFile(filePath, "utf8");
    let frontmatter = frontmatterOf(markdown);
    const changes = {};
    if (item.recommendationGroupDebt) {
      const recommendationGroup = adultHumorContentIds.has(item.contentId)
        ? "adult-humor"
        : "general";
      frontmatter = setField(
        frontmatter,
        "recommendationGroup",
        JSON.stringify(recommendationGroup),
      );
      changes.recommendationGroup = recommendationGroup;
    }
    if (item.legacyReviewDebt) {
      frontmatter = setField(frontmatter, "internalReviewStatus", '"resolved"');
      frontmatter = setField(
        frontmatter,
        "internalReviewResolvedAt",
        JSON.stringify(resolvedAt),
      );
      changes.internalReviewStatus = "resolved";
    }
    migrations.push({
      file: item.file,
      contentId: item.contentId,
      title: item.title,
      changes,
      content: replaceFrontmatter(markdown, frontmatter),
    });
  }

  if (apply) {
    for (const migration of migrations) {
      await writeAtomic(path.join(repoRoot, migration.file), migration.content);
    }
  }
  return {
    ok: true,
    applied: apply,
    resolvedAt,
    countsBefore: report.counts,
    migrated: migrations.map(({ content, ...migration }) => migration),
  };
}
