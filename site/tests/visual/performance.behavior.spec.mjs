import { expect, test } from "@playwright/test";

test("cold search starts with filtered results and stays stable", async ({ page }) => {
  await page.addInitScript(() => {
    window.searchShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.searchShifts.push(entry.value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/search?q=AI", { waitUntil: "networkidle" });
  await expect(page.locator("html")).not.toHaveAttribute("data-filter-pending");
  const visible = page.locator("[data-search-item]:visible");
  expect(await visible.count()).toBeGreaterThan(0);
  for (const text of await visible.evaluateAll((items) => items.map((item) => item.dataset.search))) expect(text).toContain("ai");
  expect(await page.evaluate(() => window.searchShifts.reduce((sum, value) => sum + value, 0))).toBeLessThan(0.1);
});

test("small screens wrap footer and window pagination; tablet detail keeps reading width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/articles?page=8");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await page.locator("[data-page-numbers] button").count()).toBeLessThanOrEqual(5);
  expect((await page.locator(".archive-pagination").boundingBox()).height).toBeLessThan(150);
  expect((await page.locator(".article-card:visible").first().boundingBox()).y).toBeLessThan(650);
  const input = page.getByRole("textbox", { name: "筛选文章" });
  await input.focus();
  expect(await input.locator("..").evaluate((label) => getComputedStyle(label).outlineStyle)).toBe("solid");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/20260710-vfks");
  expect((await page.locator(".detail-grid .prose").first().boundingBox()).width).toBeGreaterThan(600);
});

test("display images stay local and original image is fetched only on request", async ({ page }) => {
  const originals = [];
  page.on("request", (request) => { if (request.url().startsWith("https://img.xgif.cn/")) originals.push(request.url()); });
  await page.goto("/20261113-ghi5", { waitUntil: "networkidle" });
  const gallery = page.locator("[data-image-gallery]");
  const first = gallery.locator("[data-gallery-slide]").first().locator("img");
  await expect(first).toHaveJSProperty("complete", true);
  expect(await first.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(first).toHaveAttribute("src", /\/_astro\/.*\.webp$/);
  expect(await gallery.locator("[data-gallery-slide] img[src]").count()).toBe(1);
  await gallery.getByRole("button", { name: "下一张图片" }).click();
  await expect(gallery.locator("[data-gallery-slide] img[src]")).toHaveCount(2);
  await expect(page.locator("[data-gallery-original]")).toHaveAttribute("href", /https:\/\/img\.xgif\.cn\/.*\.jpg$/);
  expect(originals).toEqual([]);
});

test("no JavaScript keeps the static content visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/search?q=AI");
  await expect(page.locator("[data-search-item]").first()).toBeVisible();
  await context.close();
});
