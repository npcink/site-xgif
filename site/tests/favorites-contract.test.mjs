import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("detail pages and navigation expose the local favorite controls", async () => {
  const [layout, header, article, image, button] = await Promise.all([
    read("src/layouts/BaseLayout.astro"),
    read("src/components/Header.astro"),
    read("src/components/ArticleDetailPage.astro"),
    read("src/components/ImageDetailPage.astro"),
    read("src/components/FavoriteButton.astro"),
  ]);

  assert.match(layout, /src="\/scripts\/favorites\.js"/);
  assert.match(header, /href="\/favorites"/);
  assert.match(header, /data-favorites-count/);
  assert.match(article, /<FavoriteButton/);
  assert.match(image, /<FavoriteButton/);
  assert.match(button, /aria-pressed="false"/);
  assert.match(button, /data-content-id=/);
  assert.match(button, /data-content-kind=/);
});

test("favorites page keeps versioned export, validated import, stale-item cleanup, and privacy disclosure together", async () => {
  const [page, controller, store, privacy] = await Promise.all([
    read("src/pages/favorites/index.astro"),
    read("public/scripts/favorites-page.js"),
    read("public/scripts/favorites-store.js"),
    read("src/pages/privacy.astro"),
  ]);

  assert.match(page, /description="保存在当前浏览器中的 XGIF 文章与图片收藏。" noindex/);
  assert.match(page, /data-favorites-export/);
  assert.match(page, /data-favorites-import="merge"/);
  assert.match(page, /data-favorites-import="replace"/);
  assert.match(page, /data-favorites-clear-unavailable/);
  assert.match(controller, /window\.confirm/);
  assert.match(controller, /xgif-favorites-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.json/);
  assert.match(controller, /原内容不可用/);
  assert.match(store, /xgif:favorites:v1/);
  assert.match(store, /FAVORITES_VERSION = 1/);
  assert.match(store, /1024 \* 1024/);
  assert.match(privacy, /不会上传到本站服务器/);
  assert.match(privacy, /清除浏览器站点数据会同时删除未导出的收藏/);
});
