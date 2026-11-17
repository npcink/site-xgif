import { expect, test } from "@playwright/test";

const visibleHrefs = locator => locator.evaluateAll(items => items.map(item => item.getAttribute("href")));

test("image pages are bounded and preserve their URL, cards and position through history and dialogs", async ({ page }) => {
  await page.goto("/images?page=2");
  const all = page.locator("main .image-card");
  const expected = (await visibleHrefs(all)).slice(24, 48);
  const visible = page.locator("main .image-card:visible");
  expect(await visibleHrefs(visible)).toEqual(expected);
  await expect(page.locator("[data-page-summary]")).toHaveText("显示 25–48，共 ");
  const nav = page.getByRole("navigation", { name: "图片分页" });
  await nav.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  await nav.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=3$/);
  await page.evaluate(() => window.scrollBy(0, 200));
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
  expect(await visibleHrefs(visible)).toEqual(expected);
});

test("image filters search every page, reset pagination and clamp malformed or out-of-range pages", async ({ page }) => {
  await page.goto("/images?page=2");
  const target = page.locator("main .image-card").last();
  const href = await target.getAttribute("href");
  const input = page.getByRole("textbox", { name: "筛选图片" });
  await input.fill(await target.getAttribute("aria-label"));
  await expect.poll(() => new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(page.locator(`main .image-card[href="${href}"]`)).toBeVisible();
  await input.fill("不存在的分页测试词");
  await expect(page.locator("[data-empty]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "图片分页" })).not.toBeVisible();
  await expect(page.locator("[data-visible-count]")).toHaveText("0");
  for (const value of ["-4", "NaN", "Infinity", "999999"]) {
    await page.goto(`/images?page=${value}`);
    const total = await page.locator("main .image-card").count();
    const last = value === "999999";
    const expected = last ? total % 24 || 24 : Math.min(24, total);
    await expect(page.locator("main .image-card:visible")).toHaveCount(expected);
    await expect(page.locator('[data-pagination] [aria-current="page"]')).toHaveText(last ? String(Math.ceil(total / 24)) : "1");
  }
});

test("search and tag sections paginate independently and keep image results reachable", async ({ page }) => {
  await page.goto("/search?articlesPage=2&imagesPage=2");
  const articles = page.locator("main .article-card:visible");
  const images = page.locator("main .image-card:visible");
  await expect(articles).toHaveCount(24);
  await expect(images).toHaveCount(24);
  const articleIds = await articles.evaluateAll(items => items.map(item => item.dataset.search));
  await page.getByRole("navigation", { name: "搜索图片分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/articlesPage=2&imagesPage=3$/);
  expect(await articles.evaluateAll(items => items.map(item => item.dataset.search))).toEqual(articleIds);
  await page.getByRole("textbox", { name: "搜索内容" }).fill("CUP 5080");
  await expect.poll(() => new URL(page.url()).searchParams.has("articlesPage")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("imagesPage")).toBe(false);
  await expect(images).toHaveCount(1);
  await expect(articles).toHaveCount(0);
  await page.goto("/tags/幽默?articlesPage=2");
  const total = await page.locator("main .article-card").count();
  expect(total).toBeGreaterThan(24);
  await expect(page.locator("main .article-card:visible")).toHaveCount(Math.min(24, total - 24));
  await expect(page.getByRole("navigation", { name: "标签文章分页" }).locator('[aria-current="page"]')).toHaveText("2");
  await expect(page.locator("main .image-card:visible").first()).toBeVisible();
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
  const before = await page.locator("main .article-card:visible").evaluateAll(items => items.map(item => item.dataset.search));
  await page.getByRole("navigation", { name: "文章分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=3$/);
  await page.goBack();
  await expect(page).toHaveURL(/page=2$/);
  expect(await page.locator("main .article-card:visible").evaluateAll(items => items.map(item => item.dataset.search))).toEqual(before);
});

test("page number buttons keep keyboard focus after navigation", async ({ page }) => {
  await page.goto("/images");
  const button = page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "第 2 页", exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/page=2$/);
  await expect(button).toBeFocused();
});

test("static image index remains complete without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/images?page=2`);
  const total = await page.locator("main .image-card").count();
  expect(total).toBeGreaterThan(24);
  await expect(page.locator("main .image-card:visible")).toHaveCount(total);
  await expect(page.locator("[data-pagination]")).not.toBeVisible();
  await context.close();
});
