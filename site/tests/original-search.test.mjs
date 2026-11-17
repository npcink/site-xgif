import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = file => readFile(new URL(file, import.meta.url), "utf8");

test("deferred full-text index retains a real body-only term without private frontmatter", async () => {
  for (const page of ["../dist/search/index.html", "../dist/articles/index.html"]) {
    const html = await read(page);
    const base = html.match(/data-catalog-base="([^"]+)"/u)?.[1];
    assert.ok(base);
    const json = await read(`../dist${base}/search-articles.json`);
    const item = JSON.parse(json).items.find(item => item.id === "20251030-433b");
    assert.ok(item?.text.includes("京东旗舰店金盘"));
    assert.doesNotMatch(html, /京东旗舰店金盘/u);
    assert.doesNotMatch(json, /internalNote:|从 flomo 私人收藏导入，请在公开前复核来源和内容/u);
  }
});
