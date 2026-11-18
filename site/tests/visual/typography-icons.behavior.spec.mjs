import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://img.xgif.cn/**", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"/>',
  }));
  await page.route("**/api/favorites/events", route => route.fulfill({ status: 202, body: "{}" }));
});

test("Chinese page headings retain readable spacing across shared surfaces", async ({ page }) => {
  for (const width of [320, 390, 570, 600, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/images", "/articles", "/tags", "/tags/反转", "/favorites", "/search", "/rights", "/20260710-vfks"]) {
      await page.goto(route);
      const spacing = await page.locator("main h1").first().evaluate(element => {
        const style = getComputedStyle(element);
        const size = parseFloat(style.fontSize);
        return {
          leading: parseFloat(style.lineHeight) / size,
          tracking: parseFloat(style.letterSpacing) / size,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(spacing.leading, `${route} at ${width}px`).toBeGreaterThanOrEqual(1.15);
      expect(spacing.tracking, `${route} at ${width}px`).toBeGreaterThanOrEqual(-0.041);
      expect(spacing.overflow, `${route} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("header icons align, keep usable targets and survive favorite and menu state changes", async ({ page }) => {
  await page.goto("/20261112-cbac");
  await page.locator("main [data-favorite-toggle]").click();
  await expect(page.locator("main [data-favorite-toggle]")).toHaveAttribute("aria-pressed", "true");
  const favoriteIcon = page.locator("main .favorite-toggle-mark");
  await expect(favoriteIcon).toHaveCSS("fill", "rgb(243, 239, 230)");
  await page.reload();
  await expect(page.locator("main [data-favorite-toggle]")).toHaveAttribute("aria-pressed", "true");
  await expect(favoriteIcon.locator("path")).toHaveCount(1);

  for (const width of [320, 390, 570, 600, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = page.locator(width <= 900 ? ".header-favorites, .header-search, .mobile-nav summary" : ".header-favorites, .header-search");
    const boxes = await controls.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      const icon = [...element.querySelectorAll("svg")].find(svg => getComputedStyle(svg).display !== "none");
      const iconRect = icon.getBoundingClientRect();
      return {
        width: rect.width, height: rect.height,
        center: iconRect.top + iconRect.height / 2,
        iconWidth: iconRect.width, iconHeight: iconRect.height,
        stroke: icon.getAttribute("stroke-width"),
      };
    }));
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.iconWidth).toBe(24);
      expect(box.iconHeight).toBe(24);
      expect(box.stroke).toBe("1.75");
      expect(Math.abs(box.center - boxes[0].center)).toBeLessThanOrEqual(0.5);
    }
    await expect(page.locator(".header-favorites [data-favorites-count]")).toHaveText("1");
    await expect(page.getByRole("link", { name: "搜一搜", exact: true })).toBeVisible();
    if (width <= 900) {
      const menu = page.locator(".mobile-nav summary");
      await menu.click();
      await expect(page.locator('.mobile-nav [data-icon="close"]')).toBeVisible();
      await expect(page.getByRole("navigation", { name: "移动端主导航" })).toBeVisible();
      await menu.click();
      await expect(page.locator('.mobile-nav [data-icon="menu"]')).toBeVisible();
    }
  }
  await page.locator("main [data-favorite-toggle]").click();
  await expect(favoriteIcon).toHaveCSS("fill", "none");
  await expect(page.locator(".header-favorites [data-favorites-count]")).toBeHidden();
});


test("shared search fields keep their height and a single visible focus boundary", async ({ page }) => {
  for (const width of [320, 390, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, selector] of [["/", ".search-box"], ["/images", ".inline-search"], ["/articles", ".inline-search"], ["/search", ".search-page-input"]]) {
      await page.goto(route);
      const field = page.locator(selector);
      const input = field.locator("input");
      await input.focus();
      expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(60);
      await expect(field).toHaveCSS("outline-style", "solid");
      await expect(input).toHaveCSS("outline-style", "none");
      await input.fill("测试");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});
