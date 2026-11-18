import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

test("image archive keeps its gutters and wraps the title only when necessary", async ({ page }) => {
  for (const width of [1920, 1440, 1200, 900, 600, 530, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/images?q=躺在‘色泽黄亮，外酥内糯’招牌下的橘猫");
    await waitForCatalog(page);

    const layout = await page.evaluate(async () => {
      await document.fonts.ready;
      const box = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      };
      return {
        heroKicker: box(".archive-hero .section-kicker"),
        contentInnerLeft: document.querySelector(".archive-content").getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector(".archive-content")).paddingLeft),
        toolbar: box(".archive-toolbar"),
        search: box(".inline-search"),
        heading: box(".image-archive-hero h1"),
        titleParts: [box(".image-archive-hero h1 > span"), box(".image-archive-hero h1 > em")],
        headerTools: box(".header-tools"),
        mobileNav: box(".mobile-nav"),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.heroKicker.left - layout.contentInnerLeft)).toBeLessThanOrEqual(1);
    expect(layout.headerTools.right).toBeLessThanOrEqual(width + 1);
    expect(layout.mobileNav.right).toBeLessThanOrEqual(width + 1);
    expect(layout.toolbar.width - layout.search.width).toBeLessThanOrEqual(2);
    expect(layout.titleParts.every((part) => part.right <= layout.heading.right + 1)).toBe(true);
    const needsWrap = layout.titleParts.reduce((width, part) => width + part.width, 0) > layout.heading.width;
    expect(layout.titleParts[0].top !== layout.titleParts[1].top).toBe(needsWrap);
  }
});

test("mobile back-to-top appears after scrolling and returns focus to the header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/images");
  const button = page.getByRole("button", { name: "返回顶部" });
  await expect(button).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, innerHeight + 40));
  await expect(button).toBeVisible();
  const { x, y, width, height } = await button.boundingBox();
  expect(width).toBe(44);
  expect(height).toBe(44);
  expect(x + width).toBeLessThan(390);
  expect(y + height).toBeLessThan(844);
  await button.press("Enter");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator(".site-header .brand")).toBeFocused();
  await expect(button).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, innerHeight + 40));
  await expect(button).toBeHidden();
});
