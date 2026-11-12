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
  await page.goto("/images");
  await page.locator('a[data-detail-link][href="/20260725-0e6n"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.getByRole("heading", { name: "接着看图片" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "换个口味，读一篇" })).toBeVisible();
  const viewed = new Set(["/20260725-0e6n"]);
  for (let index = 0; index < 4; index += 1) {
    const next = dialog.locator('[data-detail-kind="image"][data-recommendation-id]:visible').first();
    const href = await next.getAttribute("href");
    expect(viewed.has(href)).toBe(false);
    viewed.add(href);
    await next.click();
    await expect(page).toHaveURL(href);
    await expect(dialog).toHaveAttribute("aria-busy", "false");
  }
  await page.goBack();
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await page.goForward();
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(page).toHaveURL("/images");
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("article dialogs retain images and direct navigation preserves seen history", async ({ page }) => {
  await page.goto("/articles");
  await page.locator('a[data-detail-link][href="/20260722-1x4w"]').first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.getByRole("heading", { name: "接着看图片" })).toBeVisible();
  const next = dialog.locator('.article-recommendation:visible').first();
  const href = await next.getAttribute("href");
  await page.goto(href);
  await expect(page.locator('.article-recommendation:visible[href="/20260722-1x4w"]')).toHaveCount(0);
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
  await page.goto("/articles");
  await page.locator('a[data-detail-link][href="/20260722-1x4w"]').first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await checkReadingOrder(dialog.locator(".article-detail"));
});

test("home places a real image near the first screen and alternates text with images", async ({ page }) => {
  await page.goto("/");
  const distance = await page.locator(".home-feed .image-card").first().evaluate((card) => card.getBoundingClientRect().top);
  expect(distance).toBeLessThan(1000);
  await expect(page.locator(".home-feed-item").first()).toHaveAttribute("data-home-section", "images");
  const kinds = await page.locator(".home-feed-item").evaluateAll((items) => items.slice(0, 4).map((item) => item.dataset.homeSection));
  expect(kinds).toEqual(["images", "articles", "articles", "images"]);
  await page.getByRole("button", { name: /图片 \/ GIF/ }).click();
  await expect(page.locator('[data-home-section="articles"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-home-section="images"]:visible')).toHaveCount(6);
});

test("short general content appears inline while adult content keeps its summary", async ({ page }) => {
  await page.goto("/search?q=核导弹");
  await expect(page.locator('[data-inline-content-id="20260625-1l9f"] .article-inline-text')).toBeVisible();
  await page.goto("/search?q=运动后的照应");
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
  await next.click();
  await expect(page.locator("[data-detail-dialog]")).toHaveAttribute("aria-busy", "false");
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
  await page.locator("main .article-recommendation:visible").first().click();
  await expect(page.locator("[data-detail-dialog]")).toHaveAttribute("aria-busy", "false");
  await page.goto("/activity");
  await expect(page.locator("[data-activity-status]")).toContainText("未允许保存记录");
});


test("static navigation and initial recommendations work without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route("https://img.xgif.cn/**", (route) => route.abort());
  try {
    await page.goto(`${baseURL}/20260725-0e6n`);
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
