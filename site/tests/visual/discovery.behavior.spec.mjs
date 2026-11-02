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
