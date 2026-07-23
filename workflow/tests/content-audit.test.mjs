import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditContentLibrary, parseContentDocument } from "../content-audit.js";

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-content-audit-"));
  const articlesDir = path.join(repoRoot, "site", "src", "content", "articles");
  const imagesDir = path.join(repoRoot, "site", "src", "content", "images");
  await Promise.all([
    mkdir(articlesDir, { recursive: true }),
    mkdir(imagesDir, { recursive: true }),
  ]);
  return { repoRoot, articlesDir, imagesDir };
}

function article({
  title = "可发布文章",
  source = "煎蛋",
  sourceUrl = "https://jandan.net/t/1234567",
  sourceKind = "publication",
  draft = false,
  body = "这是一段足够完整的测试正文，用来验证上线体检是否可以区分可发布内容、待人工确认内容和必须退回草稿的内容。正文需要超过最小长度，并且不包含未结构化链接。它还应当保留清晰的叙述结构，确保测试通过来自内容质量，而不是仅仅依靠字段齐全。",
} = {}) {
  return `---
title: ${JSON.stringify(title)}
summary: "这是一段长度合适、能够清楚说明文章重点的测试摘要。"
source: ${JSON.stringify(source)}
sourceUrl: ${JSON.stringify(sourceUrl)}
sourceKind: ${JSON.stringify(sourceKind)}
tags: ["测试", "内容"]
pubDate: "2026-07-23"
readTime: "2 分钟"
draft: ${draft}
---

${body}
`;
}

test("content audit classifies ready, review, and blocked articles", async () => {
  const dirs = await fixture();
  await Promise.all([
    writeFile(path.join(dirs.articlesDir, "ready.md"), article(), "utf8"),
    writeFile(
      path.join(dirs.articlesDir, "review.md"),
      article({
        title: "需要确认来源",
        sourceUrl: "https://jandan.net/",
        body: "这是一篇来源链接暂时只填写到网站首页的测试文章。正文内容本身完整，但上线前仍需人工找到具体原文页面，避免读者无法核对采集出处。",
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "blocked.md"),
      article({
        title: "来源待确认",
        source: "第三方",
        sourceUrl: "",
        sourceKind: "unknown",
        body: "这篇测试文章缺少可以核验的来源信息，因此即使正文已经整理完整，也必须先退回草稿，等来源确认后才能进入公开同步流程。",
      }),
      "utf8",
    ),
  ]);

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  assert.deepEqual(report.counts, { total: 3, ready: 1, review: 1, draft: 1 });
  assert.equal(report.items.find((item) => item.title === "可发布文章").status, "ready");
  assert.match(
    report.items.find((item) => item.title === "需要确认来源").warnings.join(" "),
    /网站首页/,
  );
  assert.match(
    report.items.find((item) => item.title === "来源待确认").blockers.join(" "),
    /来源待确认/,
  );
});

test("content audit blocks invalid source links and missing local image files", async () => {
  const dirs = await fixture();
  await writeFile(
    path.join(dirs.articlesDir, "invalid-url.md"),
    article({ title: "错误链接", sourceUrl: "jandan.net/t/123" }),
    "utf8",
  );
  await writeFile(
    path.join(dirs.imagesDir, "missing-image.md"),
    `---
title: "缺失图片"
description: "图片记录存在，但对应的本地文件已经丢失。"
image: "/images/memes/missing.webp"
tags: ["测试"]
pubDate: "2026-07-23"
public: true
sourceKind: "unknown"
---
`,
    "utf8",
  );

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  assert.equal(report.counts.draft, 2);
  assert.match(
    report.items.find((item) => item.title === "错误链接").blockers.join(" "),
    /HTTP\(S\)/,
  );
  assert.match(
    report.items.find((item) => item.title === "缺失图片").blockers.join(" "),
    /图片文件不存在/,
  );
});

test("content document parser keeps public and internal notes separate", () => {
  const parsed = parseContentDocument(`---
title: "备注边界"
editorNote: "公开说明"
internalNote: "仅后台可见"
---

正文
`);
  assert.equal(parsed.data.editorNote, "公开说明");
  assert.equal(parsed.data.internalNote, "仅后台可见");
});
