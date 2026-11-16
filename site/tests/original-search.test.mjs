import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = file => readFile(new URL(file, import.meta.url), "utf8");

test("search and article archive index a real body-only term without exposing private frontmatter", async () => {
  for (const page of ["../dist/search/index.html", "../dist/articles/index.html"]) {
    const html = await read(page);
    const card = html.match(/<article\b[^>]*data-search="[^"]*京东旗舰店金盘[^"]*"[^>]*>[\s\S]*?<\/article>/u)?.[0];
    assert.ok(card, `Original keyword missing from ${page}`);
    assert.match(card, /href="\/20251030-433b"/u);
    assert.match(card, /data-source="煎蛋"/u);
    assert.doesNotMatch(card, /<h3[^>]*>[\s\S]*?京东旗舰店金盘/u);
    assert.doesNotMatch(html, /internalNote:|从 flomo 私人收藏导入，请在公开前复核来源和内容/u);
  }
});
