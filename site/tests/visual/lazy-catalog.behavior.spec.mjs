import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

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

test("search distinguishes a pending or failed query from no results and can return to browse links", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/catalog/**/search-images.json", async route => {
    await gate;
    await route.fulfill({ status: 503, body: "unavailable" });
  }, { times: 1 });
  await page.goto("/search");
  const input = page.getByRole("textbox", { name: "搜索内容" });
  const empty = page.getByRole("heading", { name: "没有找到相关内容" });
  try {
    await input.fill("AI");
    await expect(page.locator("[data-catalog-message]")).toHaveText("正在加载结果…");
    await expect(empty).toBeHidden();
    release();
    await expect(page.locator("[data-catalog-message]")).toHaveText("搜索结果加载失败，请重试。");
    await expect(empty).toBeHidden();
    await page.getByRole("button", { name: "重试加载" }).click();
    await expect(page.locator("[data-search-item]:visible").first()).toBeVisible();
    await page.getByRole("button", { name: "清空搜索" }).click();
    await expect(input).toBeFocused();
    await expect(page.getByRole("link", { name: "浏览文章" })).toBeVisible();
    await expect(page.locator("[data-search-item]:visible")).toHaveCount(0);
  } finally { release(); }
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
