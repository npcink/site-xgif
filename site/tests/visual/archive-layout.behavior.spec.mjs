import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

test("image archive keeps its gutters and exposes every mood filter on narrow screens", async ({ page }) => {
  for (const width of [1200, 900, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/images?q=躺在‘色泽黄亮，外酥内糯’招牌下的橘猫");
    await waitForCatalog(page);

    const layout = await page.evaluate(() => {
      const box = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      };
      const chips = [...document.querySelectorAll(".filter-chips button")].map(button => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height };
      });
      return {
        hero: box(".archive-hero"),
        heroKicker: box(".archive-hero .section-kicker"),
        content: box(".archive-content"),
        contentInnerLeft: document.querySelector(".archive-content").getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector(".archive-content")).paddingLeft),
        toolbar: box(".archive-toolbar"),
        chips,
        chipViewport: box(".filter-chips"),
        chipScrollWidth: document.querySelector(".filter-chips").scrollWidth,
        chipClientWidth: document.querySelector(".filter-chips").clientWidth,
        headerTools: box(".header-tools"),
        mobileNav: box(".mobile-nav"),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.heroKicker.left - layout.contentInnerLeft)).toBeLessThanOrEqual(1);
    expect(layout.headerTools.right).toBeLessThanOrEqual(width + 1);
    expect(layout.mobileNav.right).toBeLessThanOrEqual(width + 1);
    for (const chip of layout.chips.filter(chip => chip.left >= layout.chipViewport.left - 1 && chip.right <= layout.chipViewport.right + 1)) {
      expect(chip.width).toBeGreaterThan(0);
      expect(chip.right).toBeLessThanOrEqual(layout.chipViewport.right + 1);
    }
    if (width <= 600) {
      expect(new Set(layout.chips.map(chip => chip.top)).size).toBe(2);
      expect(layout.chipScrollWidth).toBeGreaterThan(layout.chipClientWidth);
      expect(layout.chips.filter(chip => chip.left < layout.chipViewport.right && chip.right > layout.chipViewport.left).length).toBeGreaterThanOrEqual(6);
    }
  }
});
