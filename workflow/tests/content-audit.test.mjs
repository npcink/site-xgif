import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LEGACY_ARTICLE_DISCLOSURE } from "../article-publication.js";
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
  contentId = "20260723-0001",
  title = "可发布文章",
  source = "煎蛋",
  sourceUrl = "https://jandan.net/t/1234567",
  sourceKind = "publication",
  draft = false,
  body,
} = {}) {
  const resolvedBody = body
    ?? `${contentId}：这是一段足够完整的测试正文，用来验证上线体检是否可以区分可发布内容、待人工确认内容和必须退回草稿的内容。正文需要超过最小长度，并且不包含未结构化链接。它还应当保留清晰的叙述结构，确保测试通过来自内容质量，而不是仅仅依靠字段齐全。`;
  return `---
title: ${JSON.stringify(title)}
contentId: ${JSON.stringify(contentId)}
summary: "这是一段长度合适、能够清楚说明文章重点的测试摘要。"
source: ${JSON.stringify(source)}
sourceUrl: ${JSON.stringify(sourceUrl)}
sourceKind: ${JSON.stringify(sourceKind)}
tags: ["生活"]
pubDate: "2026-07-23"
readTime: "2 分钟"
draft: ${draft}
---

${resolvedBody}
`;
}

test("content audit classifies ready, review, and blocked articles", async () => {
  const dirs = await fixture();
  await Promise.all([
    writeFile(path.join(dirs.articlesDir, "20260723-0001.md"), article(), "utf8"),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0002.md"),
      article({
        contentId: "20260723-0002",
        title: "需要确认来源",
        sourceUrl: "https://jandan.net/",
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0003.md"),
      article({
        contentId: "20260723-0003",
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
    path.join(dirs.articlesDir, "20260723-0004.md"),
    article({ contentId: "20260723-0004", title: "错误链接", sourceUrl: "jandan.net/t/123" }),
    "utf8",
  );
  await writeFile(
    path.join(dirs.imagesDir, "20260723-0005.md"),
    `---
title: "缺失图片"
contentId: "20260723-0005"
description: "图片记录存在，但对应的本地文件已经丢失。"
image: "/images/memes/missing.webp"
tags: ["反应图"]
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

test("content audit blocks a legacy external-article disclosure placeholder", async () => {
  const dirs = await fixture();
  await writeFile(
    path.join(dirs.articlesDir, "20260723-0006.md"),
    article({
      contentId: "20260723-0006",
      title: "尚未恢复正文",
      body: LEGACY_ARTICLE_DISCLOSURE,
    }),
    "utf8",
  );

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const item = report.items.find((entry) => entry.title === "尚未恢复正文");
  assert.equal(item.status, "draft");
  assert.match(item.blockers.join(" "), /恢复完整正文/);
});

test("content audit blocks unsafe markup imported from an external article", async () => {
  const dirs = await fixture();
  await writeFile(
    path.join(dirs.articlesDir, "20260723-0007.md"),
    article({
      contentId: "20260723-0007",
      title: "危险外部正文",
      body: "这是一段导入正文。<script>alert('xss')</script> 后续文字不能让危险标签绕过公开内容体检。",
    }),
    "utf8",
  );

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const item = report.items.find((entry) => entry.title === "危险外部正文");
  assert.equal(item.status, "draft");
  assert.match(item.blockers.join(" "), /危险协议/);
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
