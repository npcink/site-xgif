import assert from "node:assert/strict";
import test from "node:test";
import { auditArticleMarkdown } from "../article-source-audit.js";
import {
  extractArticleSource,
  inferArticleSourceName,
} from "../article-source.js";
import { splitTerminalImportTags } from "../import-tags.js";

test("source extraction accepts a standalone URL at the beginning or end", () => {
  const top = extractArticleSource(["https://jandan.net/t/6179471", "", "正文"]);
  const bottom = extractArticleSource(["正文", "", "https://jandan.net/t/6179471"]);

  assert.equal(top.sourceUrl, "https://jandan.net/t/6179471");
  assert.equal(top.source, "煎蛋");
  assert.deepEqual(top.bodyLines, ["", "正文"]);
  assert.deepEqual(bottom.bodyLines, ["正文", ""]);
});

test("source extraction recognizes labeled and inline URLs without discarding prose", () => {
  const labeled = extractArticleSource([
    "作者：示例作者",
    "链接：https://www.zhihu.com/question/1/answer/2",
    "来源：知乎",
    "正文",
  ]);
  const inline = extractArticleSource(["看到这个链接有感：https://jandan.net/t/6052045", "正文"]);

  assert.equal(labeled.source, "知乎");
  assert.doesNotMatch(labeled.bodyLines.join("\n"), /question\/1/);
  assert.equal(inline.source, "煎蛋");
  assert.match(inline.bodyLines.join("\n"), /看到这个链接有感/);
});

test("multiple unlabeled URLs stay unresolved while one explicit source wins", () => {
  const unresolved = extractArticleSource([
    "参考：https://example.com/context",
    "另一个：https://example.net/source",
  ]);
  const explicit = extractArticleSource([
    "参考：https://example.com/context",
    "原文：https://jandan.net/t/123",
  ]);

  assert.equal(unresolved.sourceKind, "unknown");
  assert.equal(unresolved.candidates.length, 2);
  assert.equal(explicit.sourceUrl, "https://jandan.net/t/123");
});

test("known article hosts use reader-facing source names", () => {
  assert.equal(inferArticleSourceName("https://bbs.hupu.com/123.html"), "虎扑");
  assert.equal(inferArticleSourceName("https://ngabbs.com/read.php?tid=1"), "NGA 玩家社区");
  assert.equal(inferArticleSourceName("https://unknown.example/post"), "第三方");
});

test("terminal list tags are removed and internal import groups stay private", () => {
  const result = splitTerminalImportTags([
    "正文",
    "#惊悚",
    "- #故事汇",
  ]);

  assert.deepEqual(result.bodyLines, ["正文"]);
  assert.deepEqual(result.tags, ["惊悚"]);
  assert.deepEqual(result.importTags, ["故事汇"]);
});

test("draft audit normalizes known names and marks unproven flomo originals unknown", () => {
  const hupu = auditArticleMarkdown(`---
title: "示例"
summary: "摘要"
source: "bbs.hupu.com"
sourceUrl: "https://bbs.hupu.com/123.html"
sourceKind: "publication"
tags: ["测试"]
pubDate: 2026-07-23
readTime: "1 分钟"
draft: false
---

正文
`);
  const unknown = auditArticleMarkdown(`---
title: "示例"
summary: "摘要"
source: "原创"
sourceKind: "original"
tags: ["测试"]
pubDate: 2026-07-23
readTime: "1 分钟"
note: "从 flomo 私人笔记导入，请在公开前复核。"
draft: true
---

正文
`);

  assert.match(hupu.markdown, /source: "虎扑"/);
  assert.match(unknown.markdown, /source: "来源待确认"/);
  assert.match(unknown.markdown, /sourceKind: "unknown"/);
  assert.equal(unknown.issues.length, 1);
});

test("draft audit removes source metadata and private grouping tags from the body", () => {
  const result = auditArticleMarkdown(`---
title: "鬼压床"
summary: "摘要"
source: "煎蛋"
sourceUrl: "https://jandan.net/t/6086683"
sourceKind: "publication"
tags: ["鬼压床"]
pubDate: 2026-07-23
readTime: "1 分钟"
draft: true
---

正文

https://jandan.net/t/6086683

- #故事汇
`);

  assert.doesNotMatch(result.markdown, /6086683\n\n- #故事汇/);
  assert.match(result.markdown, /tags: \["鬼压床"\]/);
  assert.deepEqual(result.importTags, ["故事汇"]);
  assert.ok(result.actions.some((action) => action.includes("重复来源链接")));
  assert.ok(result.actions.some((action) => action.includes("内部导入分组标签")));
});
