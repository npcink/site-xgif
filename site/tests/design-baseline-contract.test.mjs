import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("image detail surfaces keep the two-column layout without cropping source images", async () => {
  const [dialog, page, articlePage, imageCard, styles] = await Promise.all([
    read("src/components/DetailDialog.astro"),
    read("src/components/ImageDetailPage.astro"),
    read("src/components/ArticleDetailPage.astro"),
    read("src/components/ImageCard.astro"),
    read("src/styles/global.css"),
  ]);

  assert.match(dialog, /<b aria-hidden="true">×<\/b>/);
  assert.doesNotMatch(dialog, /<span>关闭<\/span>/);
  assert.match(imageCard, /referrerpolicy="no-referrer"/);
  assert.match(page, /referrerpolicy="no-referrer"/);
  assert.match(articlePage, /referrerpolicy="no-referrer"/);
  assert.match(page, /class="image-source"/);
  assert.match(page, /--image-aspect-ratio: \$\{imageAspectRatio\}/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, \.85fr\)/);
  assert.match(styles, /\.detail-dialog-body \.image-detail-grid \{[\s\S]*align-items: stretch;/);
  assert.match(styles, /\.detail-dialog-body \.image-detail-grid \{[\s\S]*height: 520px;/);
  assert.match(styles, /\.detail-dialog-body \.image-detail figure img \{[^}]*min-height: 0;[^}]*object-fit: contain;/);
  assert.match(styles, /\.detail-dialog\[data-detail-kind="image"\] \.image-detail figure\.ratio-wide/);
  assert.match(styles, /figure\.ratio-square \{ aspect-ratio: auto; \}/);
  assert.match(styles, /\.image-detail figure\.ratio-square \{ aspect-ratio: var\(--image-aspect-ratio, 1\); \}/);
  assert.match(styles, /\.image-detail figure img \{[^}]*height: 100%;[^}]*object-fit: contain;/);
  assert.match(styles, /\.image-detail-copy h1 \{[^}]*font-size: clamp\(46px, 4vw, 64px\);/);
  assert.match(styles, /\.image-detail-copy \.detail-summary \{[^}]*font-size: clamp\(18px, 1\.25vw, 20px\);/);
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
  assert.match(home, /data-home-global-search/);
  assert.match(home, /data-home-section-count/);
  assert.match(home, /class="newsletter-placeholder"/);
  assert.match(homeDiscovery, /data-home-section/);
  assert.match(homeDiscovery, /window\.location\.href/);
  assert.match(homeDiscovery, /data-home-section-count/);
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
    read("src/pages/[id].astro"),
    read("src/components/ArticleDetailPage.astro"),
    read("src/pages/tags/index.astro"),
    read("src/pages/tags/[tag].astro"),
  ]);

  assert.match(article, /ArticleDetailPage/);
  assert.match(articleDetail, /class="detail-page article-detail"/);
  assert.match(articleDetail, /class:list=\{\["detail-grid"/);
  assert.match(articleDetail, /hasArticleSidebar/);
  assert.match(articleDetail, /detail-grid--single/);
  assert.match(articleDetail, /class="related-section"/);
  assert.match(tagIndex, /class="archive-hero tags-archive-hero"/);
  assert.match(tagIndex, /class="tag-index"/);
  assert.match(tagDetail, /class="tag-detail-hero"/);
  assert.match(tagDetail, /class="archive-content tag-results"/);
  assert.match(tagDetail, /class="article-grid"/);
  assert.match(tagDetail, /class="masonry-grid"/);
});

test("article dialogs support complete reading while direct pages retain source-backed summaries", async () => {
  const [articlePage, previewPage, styles] = await Promise.all([
    read("src/components/ArticleDetailPage.astro"),
    read("src/pages/preview/articles/[...id].astro"),
    read("src/styles/global.css"),
  ]);

  assert.match(articlePage, /class="dialog-article-actions"/);
  assert.match(articlePage, /class="dialog-full-link"/);
  assert.match(articlePage, /const dialogTitleSize = titleLength <= 12/);
  assert.match(articlePage, /`dialog-title--\$\{dialogTitleSize\}`/);
  assert.match(previewPage, /import\.meta\.env\.DEV/);
  assert.match(previewPage, /noindex/);
  assert.match(previewPage, /ArticleDetailPage \{article\} preview/);
  assert.match(styles, /\.local-preview-notice/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-grid \{[\s\S]*display: block;/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-grid aside \{ display: none; \}/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-header \{[\s\S]*display: grid;/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-summary \{[\s\S]*display: block;[\s\S]*grid-column: 1 \/ -1;[\s\S]*-webkit-line-clamp: 2;/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-header h1 \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*max-width: 900px;/);
  assert.match(styles, /\.dialog-title--short \{[\s\S]*font-size: clamp\(48px, 6\.4vw, 68px\);/);
  assert.match(styles, /\.dialog-title--longest \{[\s\S]*font-size: clamp\(38px, 4\.2vw, 44px\);/);
  assert.match(styles, /\.article-detail \.detail-header h1\.dialog-title--longest,[\s\S]*\.detail-dialog\[data-detail-kind="article"\] \.detail-header h1\.dialog-title--longest/);
  assert.match(styles, /\[data-detail-kind="article"\] \.card-tags \{[\s\S]*grid-column: 1;/);
  assert.match(styles, /\[data-detail-kind="article"\] \.dialog-article-actions \{[\s\S]*display: flex;/);
  assert.match(styles, /\.article-detail \.detail-header h1 \{[^}]*font-size: clamp\(44px, 4\.4vw, 68px\);[^}]*text-wrap: balance;/);
  assert.match(styles, /\.article-detail \.detail-header \{ max-width: 980px; margin-inline: auto;/);
  assert.match(styles, /\.article-detail \.detail-summary \{[^}]*border-left: 3px solid var\(--coral\);[^}]*max-width: 900px;[^}]*-webkit-line-clamp: 2;/);
  assert.match(styles, /\.detail-grid--single \{ grid-template-columns: minmax\(0, 720px\); gap: 0; \}/);
  assert.match(styles, /\.article-recommendations \{[^}]*max-width: 1200px;[^}]*margin: 72px auto 0;/);
  assert.match(styles, /\.article-recommendation h3 \{[^}]*max-width: 820px;/);
});
