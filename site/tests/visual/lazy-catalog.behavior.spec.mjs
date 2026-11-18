import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

test("caching cards leaves distant images unfetched until scrolling or restoring their page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = new Set();
  page.on("request", request => { if (request.resourceType() === "image") requests.add(request.url()); });
  await page.goto("/images", { waitUntil: "networkidle" });
  await waitForCatalog(page);
  const firstPage = await page.locator("main .image-card").evaluateAll(cards => cards.map(card => card.getAttribute("href")));
  const last = page.locator("main .image-card img").last();
  const sources = await last.evaluate(image => [image.src, ...image.srcset.split(",").map(candidate => new URL(candidate.trim().split(/\s+/)[0], location.href).href)]);
  expect(sources.some(source => requests.has(source))).toBe(false);
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => last.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(requests.has(await last.evaluate(image => image.currentSrc))).toBe(true);
  await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页" }).click();
  await waitForCatalog(page);
  await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "上一页" }).click();
  await waitForCatalog(page);
  expect(await page.locator("main .image-card").evaluateAll(cards => cards.map(card => card.getAttribute("href")))).toEqual(firstPage);
  const first = page.locator("main .image-card img").first();
  await first.scrollIntoViewIfNeeded();
  await expect.poll(() => first.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("ordinary browsing downloads one page and defers both search indexes", async ({ page }) => {
  const requests = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/catalog/")) requests.push(new URL(request.url()).pathname); });
  await page.goto("/images");
  await waitForCatalog(page);
  await expect(page.locator("main .image-card")).toHaveCount(24);
  expect(requests).toEqual([]);
  await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2$/);
  await expect(page.locator("main .image-card")).toHaveCount(24);
  expect(requests.filter(url => /\/images.json$/.test(url))).toHaveLength(1);
  expect(requests.filter(url => /\/cards\/images\/2$/.test(url))).toHaveLength(1);
  expect(requests.some(url => url.includes("search-"))).toBe(false);
  expect(requests.some(url => url.endsWith("/cards/images/3"))).toBe(false);
  await page.goBack();
  await expect(page).not.toHaveURL(/page=/);
  await waitForCatalog(page);
  await page.goForward();
  await expect(page).toHaveURL(/page=2$/);
  await waitForCatalog(page);
  expect(requests.filter(url => /\/cards\/images\/2$/.test(url))).toHaveLength(1);
});

test("full-text search finds an older body-only phrase and reuses its downloaded indexes", async ({ page }) => {
  const indexes = [];
  page.on("request", request => { if (/\/search-(articles|images)\.json$/.test(request.url())) indexes.push(request.url()); });
  await page.goto("/search");
  await waitForCatalog(page);
  expect(indexes).toEqual([]);
  const input = page.getByRole("textbox", { name: "搜索内容" });
  await input.fill("京东旗舰店金盘");
  await expect(page.locator('main a[data-detail-link][href="/20251030-433b"]').first()).toBeVisible();
  await expect(page.locator("[data-visible-count]")).toHaveText("1");
  expect(indexes).toHaveLength(2);
  await input.fill("不存在的正文查询测试");
  await expect(page.locator("[data-empty]")).toBeVisible();
  await input.fill("京东旗舰店金盘");
  await expect(page.locator("[data-visible-count]")).toHaveText("1");
  expect(indexes).toHaveLength(2);
});

test("failed page fetch preserves the current cards and retries without losing Back history", async ({ page }) => {
  let fail = true;
  await page.route("**/catalog/**/cards/images/2", route => fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  await page.goto("/images");
  await waitForCatalog(page);
  const cards = page.locator("main .image-card");
  const before = await cards.evaluateAll(items => items.map(item => item.getAttribute("href")));
  await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("button", { name: "重试加载" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试加载" })).toBeInViewport();
  expect(await cards.evaluateAll(items => items.map(item => item.getAttribute("href")))).toEqual(before);
  await expect(page).not.toHaveURL(/page=/);
  fail = false;
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page).toHaveURL(/page=2$/);
  expect(await cards.evaluateAll(items => items.map(item => item.getAttribute("href")))).not.toEqual(before);
  await page.goBack();
  await expect(page).not.toHaveURL(/page=/);
  await waitForCatalog(page);
  expect(await cards.evaluateAll(items => items.map(item => item.getAttribute("href")))).toEqual(before);
});

test("a late search response cannot overwrite the newest query", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/catalog/**/search-images.json", async route => { await gate; await route.continue(); });
  await page.goto("/images");
  await waitForCatalog(page);
  const input = page.getByRole("textbox", { name: "筛选图片" });
  try {
    await input.fill("无语");
    await expect(page.locator("[data-catalog-message]")).toHaveText("正在加载结果…");
    await input.fill("CUP 5080");
    release();
    await expect(page.locator("[data-visible-count]")).toHaveText("1");
    await expect(page.locator("main .image-card")).toHaveCount(1);
    await expect(page).toHaveURL(/q=CUP\+5080$/);
    await expect(page.locator("main .image-card")).toHaveAttribute("aria-label", /CUP 5080/);
  } finally { release(); }
});

test("a pending list page cannot replace a dialog's URL or its original list context", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/catalog/**/cards/images/2", async route => { await gate; await route.continue(); });
  await page.goto("/images");
  await waitForCatalog(page);
  try {
    const first = page.locator("main .image-card").first();
    const href = await first.getAttribute("href");
    await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页" }).click();
    await first.click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    release();
    await waitForCatalog(page);
    await expect(page).toHaveURL(new URL(href, page.url()).href);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/images$/);
    await expect(page.locator("main .image-card").first()).toHaveAttribute("href", href);
  } finally { release(); }
});
