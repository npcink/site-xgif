import { expect, test } from "@playwright/test";
import { catalogItems, waitForCatalog } from "./archive-helpers.mjs";

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

test("search treats whitespace-separated terms as an AND query", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("学习 监控")}`);
  await waitForCatalog(page);
  const matches = (await catalogItems(page, "articles", true)).filter(item => ["学习", "监控"].every(term => item.text.includes(term)));
  await expect(page.locator("#search-articles [data-group-count]")).toHaveText(String(matches.length));
  await expect(page.locator('main a[data-detail-link][href="/20260917-j3xu"]')).toBeVisible();
});

test("filter failures do not present old cards as the newly selected result", async ({ page }) => {
  let fail = true;
  await page.route("**/catalog/**/images.json", route => fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  await page.goto("/images");
  await waitForCatalog(page);
  await page.getByRole("button", { name: "动图", exact: true }).click();
  await expect(page).toHaveURL(/\?media=animated$/);
  await expect(page.getByRole("button", { name: "重试加载" })).toBeVisible();
  await expect(page.locator("main .image-card:visible")).toHaveCount(0);
  await expect(page.locator(".filter-count")).toBeHidden();
  await expect(page.locator("[data-catalog-message]")).toHaveText("筛选结果加载失败，当前筛选尚未生效。请重试。");
  fail = false;
  await page.getByRole("button", { name: "重试加载" }).click();
  await waitForCatalog(page);
  const animated = (await catalogItems(page, "images")).filter(item => item.mediaTypes.split(" ").includes("animated"));
  await expect(page.locator("[data-visible-count]")).toHaveText(String(animated.length));
  await expect(page.locator("main .image-card:visible")).toHaveCount(Math.min(24, animated.length));
});

test("failed search keeps the requested query across refresh", async ({ page }) => {
  await page.route("**/catalog/**/search-images.json", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/search");
  await page.getByRole("textbox", { name: "搜索内容" }).fill("学习");
  await expect(page).toHaveURL(/q=%E5%AD%A6%E4%B9%A0/);
  await expect(page.getByRole("button", { name: "重试加载" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "搜索内容" })).toHaveValue("学习");
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

test("cold search starts its full-text request before the metadata response completes", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let searchStarted = false;
  page.on("request", request => { if (/\/search-images\.json$/.test(request.url())) searchStarted = true; });
  await page.route("**/catalog/**/images.json", async route => { await gate; await route.continue(); });
  await page.goto("/images");
  await waitForCatalog(page);
  expect(searchStarted).toBe(false);
  try {
    await page.getByRole("textbox", { name: "筛选图片" }).fill("CUP 5080");
    await expect.poll(() => searchStarted, { timeout: 2000 }).toBe(true);
    release();
    await expect(page.locator("[data-visible-count]")).toHaveText("1");
    await expect(page.locator("main .image-card")).toHaveAttribute("aria-label", /CUP 5080/);
  } finally { release(); }
});

test("metadata retry reuses a full-text request that is already in flight", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fail = true, metadataRequests = 0, searchRequests = 0;
  await page.route("**/catalog/**/images.json", route => {
    metadataRequests += 1;
    return fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue();
  });
  await page.route("**/catalog/**/search-images.json", async route => {
    searchRequests += 1;
    await gate;
    await route.continue();
  });
  await page.goto("/images");
  await waitForCatalog(page);
  try {
    await page.getByRole("textbox", { name: "筛选图片" }).fill("CUP 5080");
    await expect(page.getByRole("button", { name: "重试加载" })).toBeVisible();
    await expect.poll(() => searchRequests).toBe(1);
    fail = false;
    await page.getByRole("button", { name: "重试加载" }).click();
    await expect.poll(() => metadataRequests).toBe(2);
    release();
    await expect(page.locator("[data-visible-count]")).toHaveText("1");
    await expect(page.locator("main .image-card")).toHaveAttribute("aria-label", /CUP 5080/);
    expect(searchRequests).toBe(1);
  } finally { release(); }
});

test("a late search response neither overwrites the newest query nor downloads obsolete cards", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cardRequests = [];
  page.on("request", request => { if (/\/cards\/images\/\d+$/.test(request.url())) cardRequests.push(request.url()); });
  await page.route("**/catalog/**/search-images.json", async route => { await gate; await route.continue(); });
  await page.goto("/images");
  await waitForCatalog(page);
  const input = page.getByRole("textbox", { name: "筛选图片" });
  try {
    await input.fill("无语");
    await expect(page.locator("[data-catalog-message]")).toHaveText("正在加载结果，暂显示上次结果…");
    await input.fill("CUP 5080");
    release();
    await expect(page.locator("[data-visible-count]")).toHaveText("1");
    await expect(page.locator("main .image-card")).toHaveCount(1);
    await expect(page).toHaveURL(/q=CUP\+5080$/);
    await expect(page.locator("main .image-card")).toHaveAttribute("aria-label", /CUP 5080/);
    await page.waitForLoadState("networkidle");
    expect(cardRequests).toEqual([]);
  } finally { release(); }
});

test("search fills an available card request slot without waiting for slower fragments", async ({ page }) => {
  let releaseOne, releaseAll;
  const one = new Promise(resolve => { releaseOne = resolve; });
  const all = new Promise(resolve => { releaseAll = resolve; });
  const requests = [];
  await page.route("**/catalog/**/cards/articles/*", async route => {
    requests.push(route.request().url());
    await (requests.length === 2 ? one : all);
    await route.continue();
  });
  try {
    await page.goto("/articles");
    await waitForCatalog(page);
    const cards = page.locator("main .article-card");
    const initial = await cards.evaluateAll(items => items.map(item => item.dataset.catalogId));
    await page.getByRole("textbox", { name: "筛选文章" }).fill("学习");
    await expect.poll(() => requests.length).toBe(4);
    releaseOne();
    // The three other requests and the replacement are still held.
    await expect.poll(() => requests.length, { timeout: 3000 }).toBe(5);
    expect(await cards.evaluateAll(items => items.map(item => item.dataset.catalogId))).toEqual(initial);
    releaseAll();
    await expect(page).toHaveURL(/q=/);
    await waitForCatalog(page);
    const matches = (await catalogItems(page, "articles", true)).filter(item => item.text.includes("学习"));
    await expect(page.locator("[data-visible-count]")).toHaveText(String(matches.length));
    expect(await cards.evaluateAll(items => items.map(item => item.dataset.catalogId))).toEqual(matches.slice(0, 12).map(item => item.id));
    expect(new Set(requests).size).toBe(requests.length);
  } finally { releaseOne(); releaseAll(); }
});

test("a failed card request stops refills and retry reuses successful fragments", async ({ page }) => {
  let failOne, releaseRest;
  const failure = new Promise(resolve => { failOne = resolve; });
  const rest = new Promise(resolve => { releaseRest = resolve; });
  const requests = [];
  await page.route("**/catalog/**/cards/articles/*", async route => {
    requests.push(route.request().url());
    if (requests.length === 1) {
      await failure;
      return route.fulfill({ status: 503, body: "unavailable" });
    }
    await rest;
    await route.continue();
  });
  try {
    await page.goto("/articles");
    await waitForCatalog(page);
    await page.getByRole("textbox", { name: "筛选文章" }).fill("学习");
    await expect.poll(() => requests.length).toBe(4);
    failOne();
    const retry = page.getByRole("button", { name: "重试加载" });
    await expect(retry).toBeVisible();
    releaseRest();
    await page.waitForLoadState("networkidle");
    expect(requests).toHaveLength(4);
    await expect(page).toHaveURL(url => url.searchParams.get("q") === "学习");
    const firstBatch = [...requests];
    await retry.click();
    await expect(page).toHaveURL(/q=/);
    await waitForCatalog(page);
    expect(requests.filter(url => url === firstBatch[0])).toHaveLength(2);
    for (const url of firstBatch.slice(1)) expect(requests.filter(request => request === url)).toHaveLength(1);
  } finally { failOne(); releaseRest(); }
});

test("superseded search stops scheduling further card requests", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cardRequests = [];
  await page.route("**/catalog/**/cards/articles/*", async route => {
    cardRequests.push(route.request().url());
    await gate;
    await route.continue();
  });
  await page.goto("/articles");
  await waitForCatalog(page);
  const input = page.getByRole("textbox", { name: "筛选文章" });
  try {
    await input.fill("学习");
    await expect.poll(() => cardRequests.length).toBe(4);
    await input.fill("不存在的过期搜索回归用例");
    await expect(page.locator("[data-visible-count]")).toHaveText("0");
    release();
    await page.waitForLoadState("networkidle");
    expect(cardRequests).toHaveLength(4);
    await expect(page.locator("[data-empty]")).toBeVisible();
    // Completed requests remain useful to a later query, without a refetch.
    const firstBatch = [...cardRequests];
    await input.fill("学习");
    await expect(page.locator("[data-visible-count]")).not.toHaveText("0");
    for (const url of firstBatch) expect(cardRequests.filter(request => request === url)).toHaveLength(1);
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
