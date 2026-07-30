import assert from "node:assert/strict";
import test from "node:test";

import {
  organizeMarkdownParagraphs,
  safeParagraphSuggestion,
} from "../article-paragraph-formatting.js";

test("keeps an already reasonable paragraph layout unchanged", () => {
  const body = "第一段已经完整。\n\n第二段也很清楚。";
  assert.deepEqual(safeParagraphSuggestion(body, body), {
    body,
    paragraphFormatting: "unchanged",
  });
});

test("accepts paragraph breaks when every original character is preserved", () => {
  const original = "第一段很长🙂。第二个意思开始了。最后一句。";
  const formatted = "第一段很长🙂。\n\n第二个意思开始了。\n\n最后一句。";
  assert.deepEqual(safeParagraphSuggestion(original, formatted), {
    body: formatted,
    paragraphFormatting: "applied",
  });
});

test("rejects single line wrapping that does not create a Markdown paragraph", () => {
  const original = "第一层意思结束。第二层意思开始。";
  for (const candidate of [
    "第一层意思结束。\n第二层意思开始。",
    "第一层意思\n结束。第二层\n意思开始。",
  ]) {
    assert.deepEqual(safeParagraphSuggestion(original, candidate), {
      body: original,
      paragraphFormatting: "rejected",
    });
  }
});

test("accepts an inserted line break when it completes an existing Markdown blank line", () => {
  const original = "第一段。\n第二段。";
  const formatted = "第一段。\n\n第二段。";
  assert.deepEqual(safeParagraphSuggestion(original, formatted), {
    body: formatted,
    paragraphFormatting: "applied",
  });
});

test("rejects deletion, rewriting, punctuation changes, and collapsed paragraphs", () => {
  const original = "第一段原文。\n\n第二段不能删除。";
  for (const candidate of [
    "第一段原文。\n\n第二段。",
    "第一段润色后。\n\n第二段不能删除。",
    "第一段原文！\n\n第二段不能删除。",
    "第一段原文。第二段不能删除。",
  ]) {
    assert.deepEqual(safeParagraphSuggestion(original, candidate), {
      body: original,
      paragraphFormatting: "rejected",
    });
  }
});

test("preserves the original when the model omits the optional additive field", () => {
  assert.deepEqual(safeParagraphSuggestion("原始正文。", undefined), {
    body: "原始正文。",
    paragraphFormatting: "unchanged",
  });
});

test("rejects a truncated model response instead of deleting the rest of a long article", () => {
  const original = `${"长文章正文。".repeat(2_500)}结尾必须保留。`;
  const truncated = original.slice(0, 12_000);
  assert.deepEqual(safeParagraphSuggestion(original, truncated), {
    body: original,
    paragraphFormatting: "rejected",
  });
});

test("reports that paragraph formatting was skipped when the full article exceeds the AI limit", () => {
  const original = "长正文。".repeat(4_000);
  assert.deepEqual(safeParagraphSuggestion(original, original, { maxCharacters: 12_000 }), {
    body: original,
    paragraphFormatting: "too_long",
  });
});

test("organizes long prose locally while preserving every original character", () => {
  const original = "第一层意思讲清楚了。".repeat(20);
  const result = organizeMarkdownParagraphs(original, { maxCharacters: 40 });

  assert.equal(result.paragraphFormatting, "applied");
  assert.equal(result.longBefore, 1);
  assert.equal(result.longAfter, 0);
  assert.equal(result.unsplittableParagraphs, 0);
  assert.equal(result.body.replace(/\n/gu, ""), original);
  assert.ok(
    result.body
      .split(/\n\s*\n/gu)
      .every((paragraph) => [...paragraph.replace(/\s/gu, "")].length <= 40),
  );
});

test("fails closed when a long paragraph has no safe punctuation boundary", () => {
  const original = "连续字符".repeat(80);
  assert.deepEqual(organizeMarkdownParagraphs(original, { maxCharacters: 40 }), {
    body: original,
    paragraphFormatting: "unchanged",
    changedParagraphs: 0,
    unsplittableParagraphs: 1,
    longBefore: 1,
    longAfter: 1,
  });
});

test("does not split Markdown code, blockquotes, or tables", () => {
  const samples = [
    `\`\`\`text\n${"代码。".repeat(80)}\n\`\`\``,
    `> ${"引用。".repeat(80)}`,
    `| ${"表格。".repeat(80)} |`,
  ];
  for (const original of samples) {
    assert.equal(organizeMarkdownParagraphs(original).body, original);
  }
});

test("uses existing whitespace as a final safe boundary", () => {
  const original = Array.from({ length: 60 }, (_, index) => `词语${index}`).join(" ");
  const result = organizeMarkdownParagraphs(original, { maxCharacters: 40 });
  assert.equal(result.paragraphFormatting, "applied");
  assert.equal(result.longAfter, 0);
  assert.equal(result.body.replace(/\n/gu, ""), original);
});
