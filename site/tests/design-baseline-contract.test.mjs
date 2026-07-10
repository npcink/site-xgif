import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("image dialog keeps the archived Next two-column design contract", async () => {
  const [dialog, page, styles] = await Promise.all([
    read("src/components/DetailDialog.astro"),
    read("src/pages/images/[...id].astro"),
    read("src/styles/global.css"),
  ]);

  assert.match(dialog, /<b aria-hidden="true">×<\/b>/);
  assert.doesNotMatch(dialog, /<span>关闭<\/span>/);
  assert.match(page, /class="image-source"/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, \.85fr\)/);
  assert.match(styles, /\.detail-dialog\[data-detail-kind="image"\] \.image-detail figure\.ratio-wide/);
  assert.match(styles, /figure\.ratio-square \{ aspect-ratio: auto; \}/);
});

test("home and discovery routes preserve the editorial visual hierarchy", async () => {
  const [home, imageCard, search, tagIndex] = await Promise.all([
    read("src/pages/index.astro"),
    read("src/components/ImageCard.astro"),
    read("src/pages/search.astro"),
    read("src/pages/tags/index.astro"),
  ]);

  assert.match(home, /class="hero"/);
  assert.match(home, /class="tag-ticker"/);
  assert.match(home, /class="article-grid"/);
  assert.match(imageCard, /class:list=\{\["image-card", item\.data\.ratio\]\}/);
  assert.match(imageCard, /class="image-shade"/);
  assert.match(search, /class="search-page"/);
  assert.match(tagIndex, /class="tag-index"/);
});

test("article dialogs remain quick previews while direct pages retain full reading content", async () => {
  const [articlePage, styles] = await Promise.all([
    read("src/pages/articles/[...id].astro"),
    read("src/styles/global.css"),
  ]);

  assert.match(articlePage, /class="dialog-article-actions"/);
  assert.match(articlePage, /class="dialog-full-link"/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-grid \{ display: none; \}/);
  assert.match(styles, /\[data-detail-kind="article"\] \.dialog-article-actions \{ display: flex;/);
});
