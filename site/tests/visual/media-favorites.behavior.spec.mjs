import { expect, test } from "@playwright/test";
import { catalogItems, waitForCatalog } from "./archive-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("https://img.xgif.cn/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#bac7ae"/></svg>' }));
});

test("image media filters compose with keyword search and preserve old mood links", async ({ page }) => {
  await page.goto("/images?media=animated");
  await waitForCatalog(page);
  const records = await catalogItems(page, "images");
  const search = new Map((await catalogItems(page, "images", true)).map(item => [item.id, item.text]));
  const moving = page.locator('[data-search-item][data-media-types~="animated"]');
  const total = records.filter(item => item.mediaTypes.split(" ").includes("animated")).length;
  expect(total).toBeGreaterThan(0);
  await expect(page.locator("[data-search-item]:visible")).toHaveCount(Math.min(24, total));
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
  await input.fill("调侃");
  const expected = records.filter(item => item.mediaTypes.split(" ").includes("static") && search.get(item.id).includes("调侃")).length;
  await expect(page.locator("[data-search-item]:visible")).toHaveCount(Math.min(24, expected));
  await expect(page.locator("[data-visible-count]")).toHaveText(String(expected));
  await expect(page).toHaveURL(/media=static/);
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "调侃");
  await expect(page.locator(".filter-chips")).toHaveCount(0);
  await page.goto(`/images?media=static&source=${encodeURIComponent("调侃")}`);
  await waitForCatalog(page);
  await expect(input).toHaveValue("调侃");
  await expect(page.locator("[data-visible-count]")).toHaveText(String(expected));
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "调侃" && !url.searchParams.has("source"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

