import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("article schema preserves optional cover metadata", async () => {
  const schema = await read("src/content.config.ts");
  assert.match(schema, /coverImage: imagePath\.optional\(\)/u);
  assert.match(schema, /coverAlt: z\.string\(\)\.optional\(\)/u);
});

test("article pages use the cover for presentation and generate a heading-based table of contents", async () => {
  const [detail, route, preview, styles] = await Promise.all([
    read("src/components/ArticleDetailPage.astro"),
    read("src/pages/[id].astro"),
    read("src/pages/preview/articles/[...id].astro"),
    read("src/styles/global.css"),
  ]);
  assert.match(detail, /const \{ Content, headings \} = await render\(article\)/u);
  assert.match(detail, /class="article-cover"/u);
  assert.match(detail, /class="article-toc"/u);
  assert.match(detail, /heading\.depth === 2 \|\| heading\.depth === 3/u);
  assert.match(route, /socialImage = article\.data\.coverImage/u);
  assert.match(route, /image=\{socialImage\}/u);
  assert.match(route, /image: new URL\(article\.data\.coverImage, siteUrl\)\.href/u);
  assert.match(preview, /image=\{article\.data\.coverImage\}/u);
  assert.match(styles, /\.article-cover/u);
  assert.match(styles, /\.article-toc/u);
});
