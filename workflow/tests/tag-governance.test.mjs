import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyTagMerge,
  inspectTagGovernance,
  planTagMerge,
} from "../tag-governance.js";

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-tag-governance-"));
  const articles = path.join(repoRoot, "site", "src", "content", "articles");
  const images = path.join(repoRoot, "site", "src", "content", "images");
  await Promise.all([mkdir(articles, { recursive: true }), mkdir(images, { recursive: true })]);
  await writeFile(path.join(articles, "one.md"), `---
title: "文章"
tags: ["人工智能", "科技"]
draft: true
---

正文
`, "utf8");
  await writeFile(path.join(images, "two.md"), `---
title: "图片"
tags: ["人工智能", "反应图"]
public: true
draft: false
---
`, "utf8");
  return { repoRoot, article: path.join(articles, "one.md") };
}

test("tag governance reports canonical and non-canonical usage", async () => {
  const dirs = await fixture();
  const report = await inspectTagGovernance({ repoRoot: dirs.repoRoot });
  assert.equal(report.counts.content, 2);
  assert.equal(report.tags.find((tag) => tag.name === "人工智能").total, 2);
  assert.equal(report.tags.find((tag) => tag.name === "人工智能").canonical, false);
  assert.equal(report.tags.find((tag) => tag.name === "科技").canonical, true);
});

test("tag merge requires an impact preview and exact confirmation", async () => {
  const dirs = await fixture();
  const plan = await planTagMerge({
    repoRoot: dirs.repoRoot,
    fromTag: "人工智能",
    toTag: "AI",
  });
  assert.equal(plan.count, 2);
  await assert.rejects(
    applyTagMerge({
      repoRoot: dirs.repoRoot,
      fromTag: "人工智能",
      toTag: "AI",
      confirmation: "yes",
    }),
    /确认文字不匹配/u,
  );
  const result = await applyTagMerge({
    repoRoot: dirs.repoRoot,
    fromTag: "人工智能",
    toTag: "AI",
    confirmation: plan.confirmation,
  });
  assert.equal(result.changedFiles.length, 2);
  assert.match(await readFile(dirs.article, "utf8"), /tags: \["AI","科技"\]/u);
});
