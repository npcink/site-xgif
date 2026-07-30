import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migratePublishedArticleParagraphs } from "../content-paragraph-migration.js";

function article(body) {
  return `---\ntitle: "测试文章"\ndraft: false\n---\n${body}\n`;
}

test("paragraph migration previews and applies character-preserving changes", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-paragraphs-"));
  const file = "site/src/content/articles/test.md";
  const filePath = path.join(repoRoot, file);
  const original = article("一个完整意思结束。".repeat(30));
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, original, "utf8");

    const preview = await migratePublishedArticleParagraphs({
      repoRoot,
      files: [file],
      maxCharacters: 40,
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.applied, false);
    assert.equal(await readFile(filePath, "utf8"), original);

    const applied = await migratePublishedArticleParagraphs({
      repoRoot,
      files: [file],
      maxCharacters: 40,
      apply: true,
    });
    const updated = await readFile(filePath, "utf8");
    assert.equal(applied.migrated.length, 1);
    assert.notEqual(updated, original);
    assert.equal(updated.replace(/\n/gu, ""), original.replace(/\n/gu, ""));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("paragraph migration writes nothing when any candidate is unsplittable", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-paragraphs-"));
  const first = "site/src/content/articles/first.md";
  const second = "site/src/content/articles/second.md";
  const firstContent = article("可以安全断句。".repeat(30));
  const secondContent = article("没有标点".repeat(80));
  try {
    await mkdir(path.join(repoRoot, "site/src/content/articles"), { recursive: true });
    await writeFile(path.join(repoRoot, first), firstContent, "utf8");
    await writeFile(path.join(repoRoot, second), secondContent, "utf8");

    await assert.rejects(
      migratePublishedArticleParagraphs({
        repoRoot,
        files: [first, second],
        maxCharacters: 40,
        apply: true,
      }),
      /未写入任何文件/u,
    );
    assert.equal(await readFile(path.join(repoRoot, first), "utf8"), firstContent);
    assert.equal(await readFile(path.join(repoRoot, second), "utf8"), secondContent);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
