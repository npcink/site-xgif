import { expect, test } from "@playwright/test";

test.skip(process.env.XGIF_GALLERY_FIXTURE !== "true", "Run npm run test:gallery to create and clean up the gallery fixture.");

test("gallery works in direct routes and fetched dialogs, including keyboard and touch", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/20990101-gall");
  const gallery = page.locator("[data-image-gallery]");
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("1 / 3");
  await expect(gallery.locator("[data-gallery-slide]:visible")).toHaveCount(1);
  await gallery.getByRole("button", { name: "下一张图片" }).click();
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  await expect(page.locator("[data-gallery-original]")).toHaveAttribute("href", /test-2\.svg$/);
  await gallery.focus();
  await page.keyboard.press("End");
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("3 / 3");
  await expect(gallery.getByRole("button", { name: "下一张图片" })).toBeDisabled();
  await gallery.locator('[data-gallery-index="0"]').click();
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("1 / 3");
  await expect(gallery.locator('[data-gallery-index="0"]')).toHaveAttribute("aria-current", "true");
  if (testInfo.project.name === "mobile") {
    await gallery.locator("[data-gallery-stage]").evaluate((element) => {
      const start = new Touch({ identifier: 1, target: element, clientX: 300, clientY: 200 });
      const end = new Touch({ identifier: 1, target: element, clientX: 100, clientY: 210 });
      element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [start] }));
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }));
    });
    await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  }
  await page.goto("/images");
  await expect(page.locator('a.image-card[href="/20990101-gall"] .image-count')).toHaveText("共 3 张");
  await page.locator('a.image-card[href="/20990101-gall"]').click();
  await expect(page.locator("[data-detail-dialog]")).toBeVisible();
  const dialogGallery = page.locator("[data-detail-dialog] [data-image-gallery]");
  await expect(page.locator("[data-detail-dialog]")).toHaveClass(/is-ready/);
  await page.locator("[data-detail-dialog]").evaluate(async (dialog) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished));
  });
  await dialogGallery.getByRole("button", { name: "下一张图片" }).click();
  await expect(dialogGallery.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  const stage = await dialogGallery.locator("[data-gallery-stage]").boundingBox();
  expect(stage.height).toBeGreaterThan(200);
  await expect(dialogGallery.locator("[data-gallery-slide]:visible")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const dialog = await page.locator("[data-detail-dialog]").boundingBox();
  expect(stage.y).toBeGreaterThanOrEqual(dialog.y - 1);
  await page.screenshot({ path: testInfo.outputPath(`gallery-${testInfo.project.name}.png`) });
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.locator('a.image-card[href="/20990101-gall"]').click();
  await expect(dialogGallery.locator("[data-gallery-counter]")).toHaveText("1 / 3");
  expect(errors).toEqual([]);
});
