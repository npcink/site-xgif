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
  assert.match(styles, /\.detail-dialog-body \.image-detail-grid \{[\s\S]*align-items: stretch;/);
  assert.match(styles, /\.detail-dialog-body \.image-detail-grid \{[\s\S]*height: 520px;/);
  assert.match(styles, /\.detail-dialog-body \.image-detail figure img \{[^}]*min-height: 0;/);
  assert.match(styles, /\.detail-dialog\[data-detail-kind="image"\] \.image-detail figure\.ratio-wide/);
  assert.match(styles, /figure\.ratio-square \{ aspect-ratio: auto; \}/);
  assert.match(styles, /\.detail-dialog\[data-detail-kind="image"\] \{[\s\S]*inset-block: auto;/);
  assert.match(styles, /\.detail-dialog\[data-detail-kind="image"\] \.detail-dialog-body \{ min-height: 0; \}/);
});

test("home and discovery routes preserve the editorial visual hierarchy", async () => {
  const [home, imageCard, search, tagIndex, styles, homeDiscovery] = await Promise.all([
    read("src/pages/index.astro"),
    read("src/components/ImageCard.astro"),
    read("src/pages/search.astro"),
    read("src/pages/tags/index.astro"),
    read("src/styles/global.css"),
    read("public/scripts/home-discovery.js"),
  ]);

  assert.match(home, /class="hero"/);
  assert.match(home, /class="tag-ticker"/);
  assert.match(home, /class="article-grid"/);
  assert.match(imageCard, /class:list=\{\["image-card", item\.data\.ratio\]\}/);
  assert.match(imageCard, /class="image-shade"/);
  assert.match(search, /class="search-page"/);
  assert.match(tagIndex, /class="tag-index"/);
  assert.match(styles, /@fontsource-variable\/geist/);
  assert.match(styles, /font-family: var\(--font-geist-sans\)/);
  assert.match(styles, /font-family: var\(--font-geist-mono\)/);
  assert.match(styles, /\.hero \{[\s\S]*min-height: 680px;/);
  assert.match(home, /data-home-discovery/);
  assert.match(home, /data-home-view="articles"/);
  assert.match(home, /data-home-view="images"/);
  assert.match(home, /class="newsletter-placeholder"/);
  assert.match(homeDiscovery, /data-home-section/);
  assert.doesNotMatch(home, /data-newsletter-form/);
  assert.doesNotMatch(homeDiscovery, /newsletterForm/);
});

test("visual baseline keeps the desktop search and honest update layout contracts", async () => {
  const styles = await read("src/styles/global.css");

  assert.match(styles, /\.search-panel \{[^}]*max-width: 1200px;[^}]*display: flex;[^}]*border: 1px solid var\(--ink\)/);
  assert.match(styles, /\.view-tabs \{ display: flex; border-left: 1px solid var\(--ink\); \}/);
  assert.match(styles, /\.newsletter \{[^}]*grid-template-columns: 110px 1fr minmax\(320px, \.7fr\)/);
  assert.match(styles, /\.newsletter-placeholder \{[^}]*display: flex;/);
});

test("production assets define a defensive Cloudflare header policy", async () => {
  const headers = await read("public/_headers");
  assert.match(headers, /Content-Security-Policy:/);
  assert.doesNotMatch(headers, /unsafe-inline/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /Strict-Transport-Security:/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test("mobile hero preserves the archived first-screen rhythm", async () => {
  const styles = await read("src/styles/global.css");

  assert.match(styles, /@media \(max-width: 600px\) \{[\s\S]*\.hero-copy \{ min-height: 560px;/);
  assert.match(styles, /@media \(max-width: 600px\) \{[\s\S]*\.hero-feature \{ min-height: 560px;/);
});

test("image discovery and search retain filterable archive states", async () => {
  const [images, search, filter] = await Promise.all([
    read("src/pages/images/index.astro"),
    read("src/pages/search.astro"),
    read("public/scripts/filter.js"),
  ]);

  assert.match(images, /class="archive-toolbar"/);
  assert.match(images, /data-filter-input/);
  assert.match(images, /data-filter-list/);
  assert.match(images, /data-filter=/);
  assert.match(search, /class="search-page"/);
  assert.match(search, /data-clear/);
  assert.match(search, /data-search-group/);
  assert.match(search, /data-empty/);
  assert.match(filter, /window\.history\.replaceState/);
  assert.match(filter, /group\.hidden = !hasVisible/);
});

test("article archive keeps filtering, URL state, and bounded pagination together", async () => {
  const [articles, filter, styles] = await Promise.all([
    read("src/pages/articles/index.astro"),
    read("public/scripts/filter.js"),
    read("src/styles/global.css"),
  ]);

  assert.match(articles, /data-pagination data-page-size="12"/);
  assert.match(articles, /data-page-summary/);
  assert.match(articles, /aria-live="polite"/);
  assert.match(filter, /url\.searchParams\.set\("source"/);
  assert.match(filter, /url\.searchParams\.set\("page"/);
  assert.match(filter, /chip\.setAttribute\("aria-pressed"/);
  assert.match(styles, /\.archive-pagination/);
});

test("article and tag routes retain their direct-reading and discovery hierarchy", async () => {
  const [article, articleDetail, tagIndex, tagDetail] = await Promise.all([
    read("src/pages/articles/[...id].astro"),
    read("src/components/ArticleDetailPage.astro"),
    read("src/pages/tags/index.astro"),
    read("src/pages/tags/[tag].astro"),
  ]);

  assert.match(article, /ArticleDetailPage/);
  assert.match(articleDetail, /class="detail-page article-detail"/);
  assert.match(articleDetail, /class="detail-grid"/);
  assert.match(articleDetail, /class="related-section"/);
  assert.match(tagIndex, /class="archive-hero tags-archive-hero"/);
  assert.match(tagIndex, /class="tag-index"/);
  assert.match(tagDetail, /class="tag-detail-hero"/);
  assert.match(tagDetail, /class="archive-content tag-results"/);
  assert.match(tagDetail, /class="article-grid"/);
  assert.match(tagDetail, /class="masonry-grid"/);
});

test("article dialogs remain quick previews while direct pages retain source-backed summaries", async () => {
  const [articlePage, previewPage, styles] = await Promise.all([
    read("src/components/ArticleDetailPage.astro"),
    read("src/pages/preview/articles/[...id].astro"),
    read("src/styles/global.css"),
  ]);

  assert.match(articlePage, /class="dialog-article-actions"/);
  assert.match(articlePage, /class="dialog-full-link"/);
  assert.match(previewPage, /import\.meta\.env\.DEV/);
  assert.match(previewPage, /noindex/);
  assert.match(previewPage, /ArticleDetailPage \{article\} preview/);
  assert.match(styles, /\.local-preview-notice/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-grid \{ display: none; \}/);
  assert.match(styles, /\[data-detail-kind="article"\] \.dialog-article-actions \{ display: flex;/);
});
