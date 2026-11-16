import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://img.xgif.cn/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#bac7ae"/></svg>' }));
});

test("image media filters compose with search and mood, persist on reload and reflow without overflow", async ({ page }) => {
  await page.goto("/images?media=animated");
  const moving = page.locator('[data-search-item][data-media-types~="animated"]');
  const total = await moving.count();
  expect(total).toBeGreaterThan(0);
  await expect(page.locator("[data-search-item]:visible")).toHaveCount(total);
  await expect(page.locator('[data-media-filter="animated"]')).toHaveAttribute("aria-pressed", "true");
  await expect(moving.first().locator(".image-count")).toContainText("动图");
  await page.reload();
  await expect(page.locator("[data-visible-count]")).toHaveText(String(total));
  const input = page.getByRole("textbox", { name: "筛选图片" });
  await input.fill("不存在的内容-媒体筛选测试");
  await expect(page.locator("[data-empty]")).toBeVisible();
  await expect(page).toHaveURL(/media=animated/);
  await input.fill("");
  await page.locator('[data-media-filter="static"]').click();
  await expect(page.locator('[data-search-item][data-media-types="animated"]:visible')).toHaveCount(0);
  await page.locator('[data-filter="调侃"]').click();
  const expected = await page.locator('[data-search-item]').evaluateAll(items => items.filter(item => item.dataset.mediaTypes.split(" ").includes("static") && item.dataset.search.includes("调侃")).length);
  await expect(page.locator("[data-search-item]:visible")).toHaveCount(expected);
  await expect(page.locator("[data-visible-count]")).toHaveText(String(expected));
  await expect(page).toHaveURL(/media=static/);
  await expect(page).toHaveURL(/source=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

