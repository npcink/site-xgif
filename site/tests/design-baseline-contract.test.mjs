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

  assert.match(dialog, /<Icon name="close"\s*\/>/);
  assert.doesNotMatch(dialog, /<span>关闭<\/span>/);
  assert.match(await read("src/components/DisplayImage.astro"), /referrerpolicy="no-referrer"/);
  assert.match(imageCard, /<DisplayImage/);
  assert.match(page, /<DisplayImage/);
  assert.match(articlePage, /referrerpolicy="no-referrer"/);
  assert.match(page, /class="image-source"/);
  assert.match(page, /data-image-ratio=\{isGallery \? undefined : imageRatioKey\}/);
  assert.doesNotMatch(page, /style=/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 280px/);
  assert.match(styles, /\.detail-dialog-body \.image-detail-grid \{[\s\S]*align-items: stretch;/);
  assert.match(styles, /\.single-image-layout \{[^}]*var\(--image-native-width,[^}]*grid-template-columns:/);
  assert.match(styles, /\.single-image-media img \{[^}]*max-width: 100%;[^}]*object-fit: contain;/);
  assert.match(styles, /\.gallery-stage img \{[^}]*object-fit: contain;/);
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

  assert.match(home, /<h1[^>]*>最近更新<\/h1>/);
  assert.match(home, /class="home-feed"/);
  assert.match(imageCard, /class:list=\{\["image-card", item\.data\.ratio\]\}/);
  assert.doesNotMatch(imageCard, /class="image-shade"/);
  assert.match(styles, /\.image-card img \{[^}]*height: auto;[^}]*object-fit: contain;/);
  assert.match(search, /class="search-page"/);
  assert.match(tagIndex, /class="tag-index"/);
  assert.match(styles, /@fontsource-variable\/geist/);
  assert.match(styles, /font-family: var\(--font-geist-sans\)/);
  assert.match(styles, /font-family: var\(--font-geist-mono\)/);
  assert.match(home, /data-home-discovery/);
  assert.match(home, /data-home-view="articles"/);
  assert.match(home, /data-home-view="images"/);
  assert.doesNotMatch(home, /data-home-filter-input|最近收藏/);
  assert.match(homeDiscovery, /data-home-section/);
  assert.doesNotMatch(homeDiscovery, /window\.location\.href/);
  assert.doesNotMatch(home, /newsletter|不用订阅/);
});

test("production assets define a defensive Cloudflare header policy", async () => {
  const headers = await read("public/_headers");
  assert.match(headers, /Content-Security-Policy:/);
  assert.doesNotMatch(headers, /unsafe-inline/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /Strict-Transport-Security:/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
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
  assert.match(images, /data-media-filter=/);
  assert.match(search, /class="search-page"/);
  assert.match(search, /data-clear/);
  assert.match(search, /data-search-group/);
  assert.match(search, /data-empty/);
  assert.match(filter, /writeListUrl/);
  assert.match(filter, /catalog\.root\.hidden/);
});

test("article archive keeps filtering, URL state, and bounded pagination together", async () => {
  const [articles, filter, pager, styles] = await Promise.all([
    read("dist/articles/index.html"),
    read("public/scripts/filter.js"),
    read("public/scripts/list-pagination.js"),
    read("src/styles/global.css"),
  ]);

  assert.match(articles, /data-pagination data-page-size="12"/);
  assert.match(articles, /data-page-summary/);
  assert.match(articles, /aria-live="polite"/);
  assert.match(articles, /<select[^>]+data-source-filter[^>]+aria-label=/);
  assert.match(pager, /url\.searchParams\.set\(parameter/);
  assert.match(filter, /writeListUrl/);
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
  assert.match(articleDetail, /<ImageRecommendations images=\{relatedImages\}/);
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

  assert.match(articlePage, /class="article-detail-actions"/);
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
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-summary \{[^}]*display: block;[^}]*grid-column: 1 \/ -1;/);
  assert.match(styles, /\[data-detail-kind="article"\] \.detail-header h1 \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*max-width: 900px;/);
  assert.match(styles, /\.dialog-title--short \{[\s\S]*font-size: clamp\(48px, 6\.4vw, 68px\);/);
  assert.match(styles, /\.dialog-title--longest \{[\s\S]*font-size: clamp\(38px, 4\.2vw, 44px\);/);
  assert.match(styles, /\.article-detail-actions \{[^}]*display: flex;/);
  assert.match(styles, /\.article-detail \.detail-summary \{[^}]*border-left: 3px solid var\(--coral\);[^}]*max-width: 900px;/);
  assert.match(styles, /\.detail-grid--single \{ grid-template-columns: minmax\(0, 720px\); gap: 0; \}/);
  assert.match(styles, /\.article-recommendations \{[^}]*max-width: 1200px;[^}]*margin: 72px auto 0;/);
  assert.match(styles, /\.article-recommendation h3 \{[^}]*max-width: 820px;/);
});
