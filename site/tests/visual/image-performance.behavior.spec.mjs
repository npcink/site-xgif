import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { imageArchiveFor, waitForCatalog } from "./archive-helpers.mjs";

async function selectedImage(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const selected = await locator.evaluate(image => ({
    url: image.currentSrc, slot: image.getBoundingClientRect().width, sizes: image.sizes,
  }));
  const bytes = await readFile(new URL(`../../dist${new URL(selected.url).pathname}`, import.meta.url));
  return { ...selected, metadata: await sharp(bytes, { animated: true }).metadata(), bytes: bytes.length };
}

test("animated cards fetch a static poster and open the complete animation on click", async ({ page }) => {
  await imageArchiveFor(page, "20261112-6ix8");
  const card = page.locator('main .image-card[href="/20261112-6ix8"]');
  const poster = await selectedImage(page, card.locator("img"));
  expect(poster.metadata.pages || 1).toBe(1);
  expect(poster.bytes).toBeLessThan(100000);
  await expect(card.locator(".image-count")).toContainText("点开播放");
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const animation = await selectedImage(page, dialog.locator(".image-detail-grid > figure img"));
  expect(animation.metadata.pages).toBe(88);
  expect(animation.url).not.toBe(poster.url);
  expect(animation.bytes).toBeGreaterThan(poster.bytes);
  await expect(dialog.locator("[data-gallery-original]")).toHaveAttribute("href", /https:\/\/img\.xgif\.cn\/memes\/3cb0df/);
});

test("card sizes follow responsive columns on first load and after pagination", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/images");
    await waitForCatalog(page);
    const image = page.locator("main .image-card img").first();
    await expect(image).toHaveAttribute("sizes", /^auto, /);
    const firstSizes = await image.getAttribute("sizes");
    await page.getByRole("navigation", { name: "图片分页" }).getByRole("button", { name: "下一页" }).click();
    await waitForCatalog(page);
    await expect(page.locator("main .image-card img").first()).toHaveAttribute("sizes", firstSizes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("high density image requests fit measured card slots", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await imageArchiveFor(page, "20261112-cbac");
    const image = await selectedImage(page, page.locator('main .image-card[href="/20261112-cbac"] img'));
    // Three-column cards need 640/960px at 2x, never the full 1920px source.
    expect(image.metadata.width).toBeGreaterThanOrEqual(image.slot);
    expect(image.metadata.width).toBeLessThanOrEqual(960);
    expect(image.sizes).toContain("33.333vw");
  } finally { await context.close(); }
});
