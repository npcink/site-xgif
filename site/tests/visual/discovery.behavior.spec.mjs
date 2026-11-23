import { readFile } from "node:fs/promises";
import { imageArchiveFor, catalogItems, waitForCatalog } from "./archive-helpers.mjs";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Interaction tests do not depend on the availability of the image CDN.
  await page.route("https://img.xgif.cn/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#b8c7ae"/></svg>',
  }));
});

test("image dialogs retain both recommendation types and avoid already viewed content", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const archiveUrl = await imageArchiveFor(page, "20260725-gxez");
  await page.locator('a[data-detail-link][href="/20260725-gxez"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.getByRole("heading", { name: "接着看图片" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "换个口味，读一篇" })).toBeVisible();
  const viewed = new Set(["/20260725-gxez"]);
  for (let index = 0; index < 4; index += 1) {
    const next = dialog.locator('[data-detail-kind="image"][data-recommendation-id]:visible').first();
    if (!(await next.count())) {
      await expect(dialog.locator(".related-section [data-recommendations-empty]")).toBeVisible();
      break;
    }
    const href = await next.getAttribute("href");
    expect(viewed.has(href)).toBe(false);
    viewed.add(href);
    await next.click();
    await expect(page).toHaveURL(href);
    await expect(dialog).toHaveAttribute("aria-busy", "false");
  }
  expect(viewed.size).toBeGreaterThan(1);
  await page.goBack();
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await page.goForward();
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(page).toHaveURL(archiveUrl);
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

async function openArticleFromArchive(page, id) {
  await page.goto("/articles");
  await waitForCatalog(page);
  const item = (await catalogItems(page, "articles")).find(item => item.id === id);
  if (!item) throw new Error(`Missing public fixture ${id}`);
  const link = page.locator(`a[data-detail-link][href="/${id}"]`).first();
  await page.getByRole("textbox", { name: "筛选文章" }).fill(item.title);
  await expect(link).toBeVisible();
  await link.click();
}

test("article dialogs retain images and direct navigation preserves seen history", async ({ page }) => {
  await openArticleFromArchive(page, "20260722-9c7n");
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.getByRole("heading", { name: "接着看图片" })).toBeVisible();
  const next = dialog.locator('.article-recommendation:visible').first();
  const href = await next.getAttribute("href");
  await page.goto(href);
  await expect(page.locator('.article-recommendation:visible[href="/20260722-9c7n"]')).toHaveCount(0);
});

test("articles show the full summary above the body and tags after it", async ({ page }) => {
  async function checkReadingOrder(article) {
    const summary = article.locator(".detail-summary");
    const prose = article.locator(".article-reading .prose");
    const tags = article.getByRole("navigation", { name: "文章标签" });
    await expect(summary).toBeVisible();
    expect(await summary.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await expect(tags.getByRole("link")).toHaveCount(3);
    await expect(article.locator(".detail-header .card-tags")).toHaveCount(0);
    const summaryBottom = await summary.evaluate((element) => element.getBoundingClientRect().bottom);
    const proseBox = await prose.boundingBox();
    const tagsBox = await tags.boundingBox();
    expect(proseBox.y).toBeGreaterThanOrEqual(summaryBottom);
    expect(tagsBox.y).toBeGreaterThanOrEqual(proseBox.y + proseBox.height);
  }

  await page.goto("/20260722-1x4w");
  await checkReadingOrder(page.locator("main .article-detail"));
  await openArticleFromArchive(page, "20260722-1x4w");
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await checkReadingOrder(dialog.locator(".article-detail"));
});

test("home filters recent updates and offers the matching full archive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-feed .image-card").first()).toBeInViewport();
  await expect(page.locator(".home-feed-item").first()).toHaveAttribute("data-home-section", "images");
  const kinds = await page.locator(".home-feed-item").evaluateAll((items) => items.slice(0, 4).map((item) => item.dataset.homeSection));
  expect(kinds).toEqual(["images", "articles", "articles", "images"]);
  const images = page.getByRole("button", { name: "图片 / GIF", exact: true });
  const articles = page.getByRole("button", { name: "文章", exact: true });
  const more = page.getByRole("navigation", { name: "浏览完整列表" });
  await images.focus();
  await images.press("Enter");
  await expect(images).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-home-section="articles"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-home-section="images"]:visible')).toHaveCount(6);
  await expect(more.getByRole("link")).toHaveText(["全部图片"]);
  await articles.click();
  await expect(page.locator('[data-home-section="images"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-home-section="articles"]:visible')).toHaveCount(8);
  await expect(more.getByRole("link")).toHaveText(["全部文章"]);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.locator(".home-feed-item:visible")).toHaveCount(14);
  await expect(more.getByRole("link")).toHaveText(["全部文章", "全部图片"]);
});

test("short general content appears inline while adult content keeps its summary", async ({ page }) => {
  await page.goto("/search?q=核导弹");
  await expect(page.locator('[data-inline-content-id="20260625-1l9f"] .article-inline-text')).toBeVisible();
  await page.goto("/search?q=情侣相处细节");
  await expect(page.locator('.article-card--short:visible')).toHaveCount(0);
  await expect(page.getByText("一段围绕情侣相处细节", { exact: false })).toBeVisible();
});

test("image actions expose the original and copy a usable link when clipboard is unavailable", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await page.goto("/20260725-0e6n");
  await expect(page.getByRole("link", { name: "查看 / 保存原图" })).toHaveAttribute("href", /^https:\/\/img\.xgif\.cn\//);
  await page.getByRole("button", { name: "复制链接" }).click();
  await expect(page.locator("[data-copy-fallback]")).toBeVisible();
  await expect(page.locator("[data-copy-fallback]")).toHaveValue(/\/20260725-0e6n$/);
});

test("local metrics count actual views and recommendation clicks without uploading them", async ({ page }) => {
  await page.goto("/20260722-3u91");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("xgif:discovery-metrics:v1")).articleViews)).toBe(1);
  const next = page.locator("main .article-recommendation:visible").first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("xgif:discovery-metrics:v1")).articleViews)).toBe(2);
  await page.goto("/activity");
  await expect(page.locator('[data-metric="articleViews"]')).toHaveText("2");
  await expect(page.locator('[data-metric="recommendationClicks"]')).toHaveText("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本次记录" }).click();
  expect((await download).suggestedFilename()).toBe("xgif-browsing.json");
});

test("storage denial leaves recommendations and navigation usable", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("denied"); } }));
  await page.goto("/20260722-3u91");
  const next = page.locator("main .article-recommendation:visible").first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await page.goto("/activity");
  await expect(page.getByRole("status").filter({ hasText: "未允许保存记录" })).toBeVisible();
  await expect(page.locator(".activity-stats")).toBeHidden();
  await expect(page.getByRole("button", { name: "导出本次记录" })).toBeHidden();
});

test("without JavaScript, personal pages and image details offer usable paths", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/favorites`);
    const note = page.locator("noscript .no-script-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("启用 JavaScript 后即可查看");
    await page.getByRole("main").getByRole("link", { name: "浏览图片" }).click();
    await expect(page).toHaveURL(/\/images$/);

    await page.goto(`${baseURL}/activity`);
    await expect(note).toBeVisible();
    await expect(note).toContainText("启用 JavaScript 后，才能记录");
    await expect(page.locator(".activity-stats")).toBeHidden();
    await expect(page.getByRole("button", { name: "导出本次记录" })).toBeHidden();

    await page.goto(`${baseURL}/20261117-mpyo`);
    const gallery = page.locator("[data-image-gallery]");
    await expect(gallery.locator("[data-gallery-slide]").first()).toBeVisible();
    await expect(gallery.getByRole("button", { name: "下一张图片" })).toBeHidden();
    await expect(page.getByRole("button", { name: "收藏" })).toBeHidden();
    await expect(page.getByRole("button", { name: "复制链接" })).toBeHidden();
    await expect(gallery.getByRole("link", { name: "第 2 张" })).toHaveAttribute("href", /^https:\/\/img\.xgif\.cn\//);
    await expect(page.getByRole("link", { name: /查看.*原图/ })).toBeVisible();
  } finally {
    await context.close();
  }
});


test("static navigation and initial recommendations work without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route("https://img.xgif.cn/**", (route) => route.abort());
  try {
    await page.goto(`${baseURL}/`);
    await expect(page.getByRole("heading", { name: "最近更新", level: 1 })).toBeVisible();
    await expect(page.getByRole("group", { name: "内容类型" })).toBeHidden();
    await expect(page.locator(".home-feed-item:visible")).toHaveCount(14);
    await expect(page.getByRole("navigation", { name: "浏览完整列表" }).getByRole("link")).toHaveCount(2);
    await page.goto(`${baseURL}/20260725-gxez`);
    await expect(page.getByRole("heading", { name: "接着看图片" })).toBeVisible();
    const next = page.locator('main a[data-recommendation-id][data-detail-kind="image"]:visible').first();
    const href = await next.getAttribute("href");
    await next.click();
    await expect(page).toHaveURL(`${baseURL}${href}`);
    await expect(page.locator("main [data-detail-content]")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("weak image matches stay absent in both a standalone page and a loaded dialog", async ({ page }) => {
  // A previously sparse image can gain a qualified neighbor on a content release.
  const { recommendations } = JSON.parse(await readFile(new URL("../../src/data/recommendations.json", import.meta.url), "utf8"));
  const fixture = Object.entries(recommendations).find(([, item]) =>
    item.sourceType === "image" && item.images.length === 0 && item.articles.length === 0);
  expect(fixture, "expected a published image with no qualified recommendations").toBeDefined();
  const [id] = fixture;
  await page.goto(`/${id}`);
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", id);
  await expect(page.locator("main [data-recommendations]")).toHaveCount(0);
  await imageArchiveFor(page, id);
  await page.locator(`a[data-detail-link][href="/${id}"]`).click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.locator(`[data-detail-content][data-content-id="${id}"]`)).toBeVisible();
  await expect(dialog.locator("[data-recommendations]")).toHaveCount(0);
});
