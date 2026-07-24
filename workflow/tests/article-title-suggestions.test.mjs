import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeArticleTitleSuggestions } from "../article-title-suggestions.js";

test("keeps exactly three distinct usable title suggestions", () => {
  assert.deepEqual(
    sanitizeArticleTitleSuggestions({
      titles: [
        " 那年暑假，我们都没有回家 ",
        "一场停在拥抱里的夏夜",
        "她挂掉电话，回头吻了我",
        "多余的第四个标题",
      ],
    }, "待整理 · 2026-03-06 · 3"),
    [
      "那年暑假，我们都没有回家",
      "一场停在拥抱里的夏夜",
      "她挂掉电话，回头吻了我",
    ],
  );
});

test("rejects placeholders, the current title, and duplicate suggestions", () => {
  assert.throws(
    () => sanitizeArticleTitleSuggestions({
      titles: [
        "待整理 · 2026-03-06 · 3",
        "出租屋里的那个夏夜",
        "出租屋里的那个夏夜",
        "未命名文章",
      ],
    }, "待整理 · 2026-03-06 · 3"),
    /没有返回 3 个可用标题/,
  );
});

test("rejects malformed AI title responses", () => {
  assert.throws(
    () => sanitizeArticleTitleSuggestions({ title: "只有一个标题" }, ""),
    /没有返回 3 个可用标题/,
  );
});
