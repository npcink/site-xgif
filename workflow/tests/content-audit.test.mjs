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
  internalNote = "",
  internalReviewStatus = "",
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
${internalNote ? `internalNote: ${JSON.stringify(internalNote)}\n` : ""}${internalReviewStatus ? `internalReviewStatus: ${JSON.stringify(internalReviewStatus)}\n` : ""}draft: ${draft}
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
        body: "这篇测试文章缺少可以核验的来源信息，但正文已经整理完整，因此允许公开发布，并在公开页面如实显示来源仍待确认。读者可以通过版权反馈入口补充来源线索，发布者也不会用网站首页或猜测的地址冒充具体原文链接。",
      }),
      "utf8",
    ),
  ]);

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  assert.deepEqual(report.counts, {
    total: 3,
    ready: 2,
    review: 1,
    blocked: 0,
    legacyReviewDebt: 0,
  });
  assert.equal(report.items.find((item) => item.title === "可发布文章").status, "ready");
  assert.match(
    report.items.find((item) => item.title === "需要确认来源").warnings.join(" "),
    /网站首页/,
  );
  assert.match(
    report.items.find((item) => item.title === "来源待确认").notices.join(" "),
    /公开页会明确显示/,
  );
});

test("content audit names real duplicate sources but does not treat a site homepage as a series", async () => {
  const dirs = await fixture();
  await Promise.all([
    writeFile(
      path.join(dirs.articlesDir, "20260723-0020.md"),
      article({
        contentId: "20260723-0020",
        title: "系列第一篇",
        sourceUrl: "https://example.com/thread/123",
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0021.md"),
      article({
        contentId: "20260723-0021",
        title: "系列第二篇",
        sourceUrl: "https://example.com/thread/123",
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0022.md"),
      article({
        contentId: "20260723-0022",
        title: "只有网站首页",
        sourceUrl: "https://example.com/",
      }),
      "utf8",
    ),
  ]);

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const first = report.items.find((item) => item.title === "系列第一篇");
  const homepage = report.items.find((item) => item.title === "只有网站首页");
  assert.match(first.warnings.join(" "), /《系列第二篇》/);
  assert.match(first.warnings.join(" "), /同一原文拆分内容可以保留/);
  assert.match(homepage.warnings.join(" "), /网站首页/);
  assert.doesNotMatch(homepage.warnings.join(" "), /同一原文拆分/);
});

test("content audit blocks unresolved drafts and marks published legacy review debt", async () => {
  const dirs = await fixture();
  await Promise.all([
    writeFile(
      path.join(dirs.articlesDir, "20260723-0010.md"),
      article({
        contentId: "20260723-0010",
        title: "待内部复核",
        internalNote: "从 flomo 私人收藏导入，请在公开前复核来源和内容。",
        draft: true,
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0012.md"),
      article({
        contentId: "20260723-0012",
        title: "历史已发布待复核",
        internalNote: "旧流程发布，仍需补充人工复核。",
      }),
      "utf8",
    ),
    writeFile(
      path.join(dirs.articlesDir, "20260723-0011.md"),
      article({
        contentId: "20260723-0011",
        title: "已完成内部复核",
        sourceUrl: "https://jandan.net/t/7654321",
        internalNote: "从 flomo 私人收藏导入，请在公开前复核来源和内容。",
        internalReviewStatus: "resolved",
      }),
      "utf8",
    ),
  ]);

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const unresolved = report.items.find((item) => item.title === "待内部复核");
  const legacyDebt = report.items.find((item) => item.title === "历史已发布待复核");
  const resolved = report.items.find((item) => item.title === "已完成内部复核");
  assert.equal(unresolved.status, "blocked");
  assert.match(unresolved.blockers.join(" "), /内部复核备注尚未确认/);
  assert.equal(legacyDebt.status, "review");
  assert.equal(legacyDebt.legacyReviewDebt, true);
  assert.match(legacyDebt.warnings.join(" "), /保持现有线上状态/);
  assert.equal(resolved.status, "ready");
  assert.equal(report.counts.legacyReviewDebt, 1);
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
  assert.equal(report.counts.blocked, 2);
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
  assert.equal(item.status, "blocked");
  assert.match(item.blockers.join(" "), /恢复完整正文/);
});

test("content audit blocks all raw HTML imported from an external article", async () => {
  const dirs = await fixture();
  await writeFile(
    path.join(dirs.articlesDir, "20260723-0007.md"),
    article({
      contentId: "20260723-0007",
      title: "危险外部正文",
      body: "这是一段导入正文。<strong>看似无害的 HTML</strong> 也必须先转成 Markdown。",
    }),
    "utf8",
  );

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const item = report.items.find((entry) => entry.title === "危险外部正文");
  assert.equal(item.status, "blocked");
  assert.match(item.blockers.join(" "), /原始 HTML/);
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

test("content audit warns about long Markdown paragraphs without blocking publication", async () => {
  const dirs = await fixture();
  const longParagraph = `这是一段连续叙事，${"内容需要适当分段以便阅读。".repeat(18)}`;
  await writeFile(
    path.join(dirs.articlesDir, "20260723-0008.md"),
    article({
      contentId: "20260723-0008",
      title: "长段落提醒",
      body: `${longParagraph}\n\n第二段长度合理，用来确认审计按 Markdown 空行识别段落。`,
    }),
    "utf8",
  );

  const report = await auditContentLibrary({ repoRoot: dirs.repoRoot });
  const item = report.items.find((entry) => entry.title === "长段落提醒");
  assert.equal(item.status, "review");
  assert.match(item.warnings.join(" "), /1 个超过 180 字的长段落/);
});
