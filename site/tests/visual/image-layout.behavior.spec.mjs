import { expect, test } from "@playwright/test";
import { imageArchiveFor } from "./archive-helpers.mjs";

async function expectGalleryLayout(gallery) {
  const image = gallery.locator("[data-gallery-slide]:visible img");
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  const geometry = await gallery.evaluate(root => {
    const box = el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const stage = root.querySelector("[data-gallery-stage]");
    const image = stage.querySelector("[data-gallery-slide]:not([hidden]) img");
    return {
      gallery: box(root), stage: box(stage), image: box(image),
      fit: getComputedStyle(image).objectFit,
      position: getComputedStyle(image).objectPosition,
      overflow: root.scrollWidth - root.clientWidth,
      thumbnails: [...root.querySelectorAll(".gallery-thumbnails a")].map(link => ({
        link: box(link), image: box(link.querySelector("img")),
      })),
    };
  });
  // A centered image inside a shrunken, left-aligned stage is still off center.
  expect(Math.abs(geometry.stage.width - geometry.gallery.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.stage.x - geometry.gallery.x)).toBeLessThanOrEqual(1);
  for (const dimension of ["x", "y", "width", "height"]) {
    expect(Math.abs(geometry.image[dimension] - geometry.stage[dimension]), dimension).toBeLessThanOrEqual(1);
  }
  expect(geometry.fit).toBe("contain");
  expect(geometry.position).toBe("50% 50%");
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const { link, image } of geometry.thumbnails) {
    expect(image.width).toBeLessThanOrEqual(link.width);
    expect(image.height).toBeLessThanOrEqual(link.height);
  }
}

test("portrait, landscape and square gallery slides fill a centered stage in routes and dialogs", async ({ page }, testInfo) => {
  const widths = testInfo.project.name === "desktop" ? [1440, 1024, 901] : [900, 768, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/20261112-8jzn");
    const direct = page.locator("main [data-image-gallery]");
    for (let index = 0; index < 3; index += 1) {
      await direct.locator(`[data-gallery-index="${index}"]`).click();
      await expectGalleryLayout(direct);
    }
    await imageArchiveFor(page, "20261112-8jzn");
    await page.locator('main a.image-card[href="/20261112-8jzn"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toHaveClass(/is-ready/);
    await dialog.evaluate(async root => {
      await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
    });
    const gallery = dialog.locator("[data-image-gallery]");
    for (let index = 0; index < 3; index += 1) {
      await gallery.locator(`[data-gallery-index="${index}"]`).click();
      await expectGalleryLayout(gallery);
    }
    const shell = dialog.locator("[data-detail-shell]");
    expect(await shell.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test("reported portrait gallery stays centered after selecting its deferred second image", async ({ page }, testInfo) => {
  await imageArchiveFor(page, "20261117-mpyo");
  await page.locator('main a.image-card[href="/20261117-mpyo"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const gallery = dialog.locator("[data-image-gallery]");
  await gallery.getByRole("button", { name: "下一张图片" }).click();
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 2");
  await expectGalleryLayout(gallery);
  await dialog.screenshot({
    path: testInfo.outputPath(`portrait-gallery-${testInfo.project.name}.png`),
    animations: "disabled",
    mask: [dialog.locator(".related-section"), dialog.locator(".article-recommendations")],
  });
});
