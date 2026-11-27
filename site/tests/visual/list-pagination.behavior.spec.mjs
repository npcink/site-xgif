import { expect, test } from "@playwright/test";
import { catalogItems, waitForCatalog } from "./archive-helpers.mjs";

const visibleHrefs = locator => locator.evaluateAll(items => items.map(item => item.getAttribute("href")));

test("narrow article pagination matches the gallery page position and the static fallback uses links", async ({ page, browser }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/articles?page=2");
  await waitForCatalog(page);
  const pages = Math.ceil((await catalogItems(page, "articles")).length / 12);
  const nav = page.getByRole("navigation", { name: "文章分页" });
  await expect(nav.locator("[data-page-numbers]")).toBeHidden();
  await expect(nav.locator("[data-page-position]")).toHaveText(`2 / ${pages}`);
  await nav.getByRole("button", { name: "上一页" }).click();
  await expect(nav.locator("[data-page-position]")).toHaveText(`1 / ${pages}`);
  await expect(nav.getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.goto("/articles?page=999999");
  await waitForCatalog(page);
  await expect(nav.locator("[data-page-position]")).toHaveText(`${pages} / ${pages}`);
  await expect(nav.getByRole("button", { name: "下一页" })).toBeDisabled();

  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  try {
    const fallback = await context.newPage();
    await fallback.goto(new URL("/browse/articles/1", page.url()).href);
    const links = fallback.getByRole("navigation", { name: "文章逐页浏览" });
    await expect(links.locator(".page-position")).toHaveText(/^1 \/ \d+$/u);
    await expect(links.getByRole("link", { name: "上一页" })).toHaveCount(0);
    await links.getByRole("link", { name: "下一页" }).click();
    await expect(fallback).toHaveURL(/\/browse\/articles\/2\/?$/u);
    await expect(links.getByRole("link", { name: "上一页" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("image pagination keeps the page end compact and preserves desktop page shortcuts", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  if (mobile) await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/images?page=3");
  await waitForCatalog(page);
  const nav = page.getByRole("navigation", { name: "图片分页" });
  const position = nav.locator("[data-page-position]");
  const numbers = nav.locator("[data-page-numbers]");
  if (mobile) {
    const total = (await catalogItems(page, "images")).length;
    await expect(position).toBeVisible();
    await expect(position).toHaveText(`3 / ${Math.ceil(total / 24)}`);
    await expect(numbers).toBeHidden();
    const [previous, next] = await nav.getByRole("button").all();
    const before = await previous.boundingBox();
    const middle = await position.boundingBox();
    const after = await next.boundingBox();
    expect(before.y).toBe(after.y);
    expect(before.x + before.width).toBeLessThan(middle.x);
    expect(middle.x + middle.width).toBeLessThan(after.x);
    expect(after.x + after.width).toBeLessThanOrEqual(320);
    expect(Math.min(before.height, after.height)).toBeGreaterThanOrEqual(44);
  } else {
    await expect(position).toBeHidden();
    await expect(numbers.getByRole("button", { name: "第 3 页", exact: true })).toBeVisible();
  }
  await expect.poll(() => nav.evaluate(element =>
    element.getBoundingClientRect().top - element.previousElementSibling.getBoundingClientRect().bottom,
  )).toBeCloseTo(12, 0);
  await nav.screenshot({ path: testInfo.outputPath("image-pagination.png") });
});

test("image pages are bounded and preserve their URL, cards and position through history and dialogs", async ({ page }) => {
  await page.goto("/images?page=2");
  await waitForCatalog(page);
  const expected = (await catalogItems(page, "images")).slice(24, 48).map(item => `/${item.id}`);
  const visible = page.locator("main .image-card:visible");
  expect(await visibleHrefs(visible)).toEqual(expected);
  await expect(page.locator("[data-page-summary]")).toHaveText("显示 25–48，共 ");
  const nav = page.getByRole("navigation", { name: "图片分页" });
  await nav.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  await nav.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=3$/);
  // Capture a settled visitor position, not an intermediate frame of CSS smooth scrolling.
  await page.evaluate(() => window.scrollBy({ top: 200, behavior: "instant" }));
  // Masonry repacking can adjust the browser's scroll anchor on the next frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const nextScrollY = await page.evaluate(() => window.scrollY);
  await page.goBack();
  await expect(page).toHaveURL(/page=2$/);
  expect(await visibleHrefs(visible)).toEqual(expected);
  await expect.poll(() => page.evaluate(before => Math.abs(scrollY - before), scrollY)).toBeLessThanOrEqual(2);
  await page.goForward();
  await expect(page).toHaveURL(/page=3$/);
  await expect.poll(() => page.evaluate(before => Math.abs(scrollY - before), nextScrollY)).toBeLessThanOrEqual(2);
  await page.goBack();
  await expect(page).toHaveURL(/page=2$/);
  const link = visible.first();
  await link.scrollIntoViewIfNeeded();
  const beforeDialog = await page.evaluate(() => window.scrollY);
  await link.click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/page=2$/);
  expect(await visibleHrefs(visible)).toEqual(expected);
  await expect.poll(() => page.evaluate(before => Math.abs(scrollY - before), beforeDialog)).toBeLessThanOrEqual(2);
  await page.reload();
  await waitForCatalog(page);
  expect(await visibleHrefs(visible)).toEqual(expected);
});

test("image filters search every page, reset pagination and clamp malformed or out-of-range pages", async ({ page }) => {
  await page.goto("/images?page=2");
  await waitForCatalog(page);
  const target = (await catalogItems(page, "images")).at(-1);
  const href = `/${target.id}`;
  const input = page.getByRole("textbox", { name: "筛选图片" });
  await input.fill(target.title);
  await expect.poll(() => new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(page.locator(`main .image-card[href="${href}"]`)).toBeVisible();
  await input.fill("不存在的分页测试词");
  await expect(page.locator("[data-empty]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "图片分页" })).not.toBeVisible();
  await expect(page.locator("[data-visible-count]")).toHaveText("0");
  for (const value of ["-4", "NaN", "Infinity", "999999"]) {
    await page.goto(`/images?page=${value}`);
    await waitForCatalog(page);
    const total = Number(await page.locator("[data-catalog-total]").getAttribute("data-catalog-total"));
    const last = value === "999999";
    const expected = last ? total % 24 || 24 : Math.min(24, total);
    await expect(page.locator("main .image-card:visible")).toHaveCount(expected);
    await expect(page.locator('[data-pagination] [aria-current="page"]')).toHaveText(last ? String(Math.ceil(total / 24)) : "1");
  }
});

test("a failed direct page load keeps the static cards and reports a load error", async ({ page }) => {
  let failed = true;
  await page.route("**/catalog/**/cards/images/**", route => failed ? route.abort() : route.continue());
  await page.goto("/images?page=2");
  await waitForCatalog(page);
  const cards = page.locator("main .image-card:visible");
  const current = page.locator('[data-pagination] [aria-current="page"]');
  const records = await catalogItems(page, "images");
  await expect(page.locator("[data-catalog-message]")).toHaveText(/加载未完成，当前内容已保留/);
  await expect(page.getByRole("navigation", { name: "图片分页" })).toBeVisible();
  await expect(current).toHaveText("1");
  await expect(page).toHaveURL(/\?page=2$/);
  expect(await visibleHrefs(cards)).toEqual(records.slice(0, 24).map(item => `/${item.id}`));
  failed = false;
  await page.getByRole("button", { name: "重试加载" }).click();
  await waitForCatalog(page);
  await expect(current).toHaveText("2");
  expect(await visibleHrefs(cards)).toEqual(records.slice(24, 48).map(item => `/${item.id}`));
});

test("old pagination cannot change the page while a new filter is loading", async ({ page }) => {
  await page.goto("/images?page=2");
  await waitForCatalog(page);
  const input = page.getByRole("textbox", { name: "筛选图片" });
  const next = page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页", exact: true });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route("**/catalog/**/search-images.json", async route => {
    await pending;
    await route.continue();
  });
  try {
    await input.fill("的");
    await expect(next).toBeDisabled();
    await next.dispatchEvent("click");
    await expect(page).toHaveURL(url => url.searchParams.get("q") === "的" && !url.searchParams.has("page"));
  } finally { release(); }
  await waitForCatalog(page);
  await expect(page.locator('[data-pagination] [aria-current="page"]')).toHaveText("1");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "的" && url.searchParams.get("page") === "2");
});

test("keyboard retry returns focus to the refreshed cards", async ({ page }) => {
  let failed = true;
  await page.route("**/catalog/**/cards/images/**", route => failed ? route.abort() : route.continue());
  await page.goto("/images");
  const next = page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页", exact: true });
  await next.press("Enter");
  const retry = page.getByRole("button", { name: "重试加载" });
  await expect(retry).toBeVisible();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route("**/catalog/**/cards/images/**", async route => {
    await pending;
    await route.fallback();
  });
  failed = false;
  try {
    await retry.press("Enter");
    await expect(retry).toBeDisabled();
    await expect(retry).toBeFocused();
  } finally { release(); }
  await expect(page).toHaveURL(/\?page=2$/);
  const cards = page.locator("main .image-card");
  await expect(cards.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cards.nth(1)).toBeFocused();
});

test("search and tag sections paginate independently and keep image results reachable", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("生活")}&articlesPage=2`);
  await waitForCatalog(page);
  const articles = page.locator("main .article-card:visible");
  const images = page.locator("main .image-card:visible");
  await expect(articles).toHaveCount(24);
  await expect(images).toHaveCount(24);
  const imageJump = page.getByRole("link", { name: "看图片" });
  await imageJump.press("Enter");
  await expect(page.locator("#search-images")).toBeFocused();
  await expect(images.first()).toBeInViewport();
  const articleIds = await articles.evaluateAll(items => items.map(item => item.dataset.catalogId));
  await page.getByRole("navigation", { name: "搜索图片分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/articlesPage=2&imagesPage=2$/);
  expect(await articles.evaluateAll(items => items.map(item => item.dataset.catalogId))).toEqual(articleIds);
  await page.getByRole("textbox", { name: "搜索内容" }).fill("CUP 5080");
  await expect.poll(() => new URL(page.url()).searchParams.has("articlesPage")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("imagesPage")).toBe(false);
  await expect(images).toHaveCount(1);
  await expect(articles).toHaveCount(0);
  await page.goto("/tags/幽默?articlesPage=2");
  await waitForCatalog(page);
  const total = Number(await page.locator('[data-catalog-kind="articles"]').getAttribute("data-catalog-total"));
  expect(total).toBeGreaterThan(24);
  await expect(page.locator("main .article-card:visible")).toHaveCount(Math.min(24, total - 24));
  await expect(page.getByRole("navigation", { name: "标签文章分页" }).locator('[aria-current="page"]')).toHaveText("2");
  await expect(page.locator("main .image-card:visible").first()).toBeVisible();
});

test("result summaries give each count once and reserve ranges for paginated groups", async ({ page }) => {
  await page.setViewportSize({ width: 553, height: 672 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tags/生活");
  await waitForCatalog(page);
  const scope = kind => page.locator(`[data-list-scope][data-catalog-kind="${kind}"]`);
  const total = async kind => Number(await scope(kind).getAttribute("data-catalog-total"));
  const jumps = page.getByRole("navigation", { name: "标签内容" });
  const imageJump = jumps.getByRole("link", { name: `${await total("images")} 项图片` });
  await expect(jumps.getByRole("link", { name: `${await total("articles")} 篇文章` })).toHaveAttribute("href", "#tag-articles");
  await expect(page.locator(".tag-results .filter-count, .tag-results .content-title")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const first = await scope("articles").locator(".article-card").first().boundingBox();
  expect(first.y).toBeLessThan(672 * 0.42);
  await imageJump.press("Enter");
  await expect(page).toHaveURL(/#tag-images$/);
  await expect(scope("images")).toBeFocused();
  await expect(scope("images").locator(".image-card").first()).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/\/tags\/[^#]+$/);
  await page.getByRole("navigation", { name: "标签文章分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(scope("articles").locator("[data-page-summary]")).toHaveText("显示 25–48");
  await expect(scope("images").locator("[data-page-summary]")).toHaveText("显示 1–24");

  await page.goto("/tags/反应图");
  await expect(page.getByRole("navigation", { name: "标签内容" })).toHaveCount(0);
  const singleTypeTotal = await page.locator('[data-catalog-kind="images"]').getAttribute("data-catalog-total");
  await expect(page.locator(".tag-result-count")).toHaveText(`${singleTypeTotal} 项图片`);
  await expect(scope("images").locator(".image-card").first()).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent("海边")}`);
  await waitForCatalog(page);
  await expect(scope("articles").locator("[data-group-total]")).toBeVisible();
  await expect(scope("images").locator("[data-group-total]")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索内容" }).fill("CUP 5080");
  await expect(page.locator(".search-page > .filter-count")).toHaveText("找到 1 条内容");
  await expect(scope("images").locator("[data-group-count]")).toHaveText("1");
  await expect(scope("articles")).toBeHidden();
  await expect(scope("images").locator("[data-page-summary]")).toBeEmpty();

  await page.goto("/images?q=CUP%205080");
  await waitForCatalog(page);
  await expect(page.locator(".archive-content .filter-count")).toHaveText("1 项内容");
  await page.goto("/favorites");
  await expect(page.locator("[data-favorites-empty]")).toBeVisible();
  await expect(page.locator("[data-favorites-summary]")).toBeHidden();
});

test("favorites pagination preserves the full export and clamps the last page after removal", async ({ page }, testInfo) => {
  await page.goto("/favorites");
  await page.evaluate(() => {
    const catalog = JSON.parse(document.querySelector("[data-favorites-catalog]").textContent);
    const date = new Date().toISOString();
    localStorage.setItem("xgif:favorites:v1", JSON.stringify({ format: "xgif-favorites", version: 1, updatedAt: date,
      items: catalog.slice(0, 49).map((item, index) => ({ ...item, savedAt: new Date(Date.now() - index * 1000).toISOString() })) }));
  });
  await page.goto("/favorites?page=3");
  await expect(page.locator(".favorite-row")).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).items).toHaveLength(49);
  await page.locator("[data-favorite-remove]").click();
  await expect(page).toHaveURL(/page=2$/);
  await expect(page.locator(".favorite-row")).toHaveCount(24);
  await expect(page.locator("[data-favorites-summary]")).toHaveText("显示 25–48，共 48 项收藏");
  await page.getByRole("navigation", { name: "收藏分页" }).screenshot({ path: testInfo.outputPath("favorites-pagination.png") });
  const link = page.locator(".favorite-row a").first();
  await link.click();
  await page.goBack();
  await expect(page).toHaveURL(/page=2$/);
  await expect(page.locator(".favorite-row")).toHaveCount(24);
  await page.reload();
  await expect(page.locator(".favorite-row")).toHaveCount(24);
});

test("article page navigation also restores its previous page through Back", async ({ page }) => {
  await page.goto("/articles?page=2");
  await waitForCatalog(page);
  const before = await page.locator("main .article-card:visible").evaluateAll(items => items.map(item => item.dataset.catalogId));
  await page.getByRole("navigation", { name: "文章分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=3$/);
  await page.goBack();
  await expect(page).toHaveURL(/page=2$/);
  expect(await page.locator("main .article-card:visible").evaluateAll(items => items.map(item => item.dataset.catalogId))).toEqual(before);
});

for (const name of ["第 2 页", "下一页"]) {
  test(`keyboard pagination sends focus to the new cards (${name})`, async ({ page }, testInfo) => {
    test.skip(name === "第 2 页" && testInfo.project.name === "mobile", "Numbered shortcuts are desktop-only.");
    await page.goto("/images");
    const cards = page.locator("main a.image-card");
    const previous = await cards.first().getAttribute("href");
    const button = page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name, exact: true });
    await button.press("Enter");
    await expect(page).toHaveURL(/page=2$/);
    await expect(cards.first()).not.toHaveAttribute("href", previous);
    await expect(cards.first()).toBeFocused();
    await expect(cards.first()).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(cards.nth(1)).toBeFocused();
  });
}

test("static image pages remain traversable without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/images?page=2`);
  await expect(page.locator("main .image-card:visible")).toHaveCount(24);
  await expect(page.getByRole("group", { name: "图片类型" })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "筛选图片" })).toBeHidden();
  await expect(page.locator("[data-pagination]")).not.toBeVisible();
  await page.getByRole("link", { name: "逐页浏览全部图片" }).click();
  await expect(page).toHaveURL(/\/browse\/images\/1$/);
  const before = await visibleHrefs(page.locator("main .image-card"));
  await page.getByRole("link", { name: "下一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/browse\/images\/2$/);
  await expect(page.locator("main .image-card:visible")).toHaveCount(24);
  expect(await visibleHrefs(page.locator("main .image-card"))).not.toEqual(before);
  await page.goto(`${baseURL}/articles`);
  await expect(page.getByRole("textbox", { name: "筛选文章" })).toBeHidden();
  await page.getByRole("link", { name: "逐页浏览全部文章" }).click();
  await expect(page).toHaveURL(/\/browse\/articles\/1$/);
  await expect(page.locator("main .article-card").first()).toBeVisible();
  await context.close();
});
