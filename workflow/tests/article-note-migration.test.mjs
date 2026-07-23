import assert from "node:assert/strict";
import test from "node:test";
import { classifyLegacyArticleNote, migrateArticleNote } from "../article-note-migration.js";

test("legacy flomo reminders become local-only internal notes", () => {
  assert.equal(
    classifyLegacyArticleNote("从 flomo 私人收藏导入，请在公开前复核来源和内容。").field,
    "internalNote",
  );
});

test("reader-facing notes become public editor notes", () => {
  assert.equal(
    classifyLegacyArticleNote("文字克制细腻，适合读一段关于亲情与失落的回忆。").field,
    "editorNote",
  );
});

test("note migration preserves body and removes the legacy field", () => {
  const result = migrateArticleNote(`---
title: "示例"
note: "从 flomo 私人笔记导入，请在公开前复核。"
draft: false
---

正文内容
`);
  assert.equal(result.field, "internalNote");
  assert.match(result.markdown, /internalNote:/);
  assert.doesNotMatch(result.markdown, /^note:/mu);
  assert.match(result.markdown, /正文内容/);
});
