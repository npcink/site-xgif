import { expect, test } from "@playwright/test";

test("archive text stays in its gutters and clear of the decoration", async ({ page }) => {
  for (const width of [320, 390, 600, 601, 820, 821, 1440, 1920]) {
    await page.setViewportSize({ width, height: 850 });
    for (const path of ["/articles", "/images", "/tags"]) {
      await page.goto(path);
      const { inset, edge, right, left } = await page.locator(".archive-hero").evaluate(async (hero) => {
        await document.fonts.ready;
        const style = getComputedStyle(hero);
        const decoration = getComputedStyle(hero, "::after");
        const bounds = hero.getBoundingClientRect();
        const rects = [...hero.children].flatMap((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()];
        });
        const decorationEdge = bounds.right - parseFloat(decoration.right) - parseFloat(decoration.width);
        return {
          left: Math.min(...rects.map((rect) => rect.left)),
          right: Math.max(...rects.map((rect) => rect.right)),
          inset: bounds.left + parseFloat(style.paddingLeft),
          edge: decoration.content === "none" ? bounds.right - parseFloat(style.paddingRight) : decorationEdge,
        };
      });
      expect(left, `${path} at ${width}px`).toBeGreaterThanOrEqual(inset - 1);
      expect(right, `${path} at ${width}px`).toBeLessThanOrEqual(edge + 1);
    }
  }
});

test("tag titles and results share the same left edge", async ({ page }) => {
  for (const width of [320, 600, 601, 900, 901, 1440, 1920]) {
    await page.setViewportSize({ width, height: 850 });
    for (const tag of ["社会观察", "AI"]) {
      await page.goto(`/tags/${encodeURIComponent(tag)}`);
      const heading = page.locator(".tag-detail-hero h1");
      const results = page.locator(".tag-results .content-title").first();
      expect(Math.abs((await heading.boundingBox()).x - (await results.boundingBox()).x)).toBeLessThanOrEqual(1);
      const line = await heading.evaluate(async (element) => {
        await document.fonts.ready;
        const range = document.createRange();
        range.selectNodeContents(element);
        return { width: range.getBoundingClientRect().width, height: element.clientHeight, lineHeight: parseFloat(getComputedStyle(element).lineHeight), available: element.clientWidth };
      });
      expect(line.width).toBeLessThanOrEqual(line.available + 1);
      expect(line.height).toBeLessThanOrEqual(line.lineHeight + 1);
    }
  }
});

test("footer links reflow without covering the site description", async ({ page }) => {
  await page.goto("/rights");
  for (const width of [320, 390, 600, 601, 675, 750, 900, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const { overlap, outside } = await page.locator("footer").evaluate(async (footer) => {
      await document.fonts.ready;
      const intro = footer.querySelector("p");
      const range = document.createRange();
      range.selectNodeContents(intro);
      const description = range.getBoundingClientRect();
      const links = [...footer.querySelectorAll(".footer-links a")].map((a) => a.getBoundingClientRect());
      return {
        overlap: links.some((link) => link.left < description.right && link.right > description.left
          && link.top < description.bottom && link.bottom > description.top),
        outside: links.some((link) => link.left < 0 || link.right > innerWidth),
      };
    });
    expect(overlap, `footer at ${width}px`).toBe(false);
    expect(outside, `footer at ${width}px`).toBe(false);
  }
});

test("open mobile menu and a three-digit favorites count leave room for the icons", async ({ page }) => {
  await page.addInitScript(() => {
    const savedAt = "2026-11-18T00:00:00Z";
    localStorage.setItem("xgif:favorites:v1", JSON.stringify({
      format: "xgif-favorites", version: 1, updatedAt: savedAt,
      items: Array.from({ length: 120 }, (_, index) => ({
        contentId: `20261118-${index.toString(36).padStart(4, "0")}`,
        kind: "image", title: "浏览器收藏夹检查", savedAt,
      })),
    }));
  });
  await page.goto("/rights");
  const menu = page.locator(".mobile-nav summary");
  const panel = page.getByRole("navigation", { name: "移动端主导航" });
  const badge = page.locator(".header-favorites [data-favorites-count]");
  await expect(badge).toHaveText("120");
  for (const width of [320, 390, 600, 601, 900, 901]) {
    await page.setViewportSize({ width, height: 850 });
    const heart = await page.locator(".header-favorites svg").boundingBox();
    const search = await page.locator(".header-search svg").boundingBox();
    const count = await badge.boundingBox();
    expect(heart.width).toBe(24);
    expect(search.width).toBe(24);
    expect(count.x + count.width <= heart.x || count.x >= heart.x + heart.width).toBe(true);
    expect(count.x + count.width).toBeLessThan(search.x);
    if (width <= 900) {
      await menu.click();
      await expect(menu.locator('[data-icon="close"]')).toBeVisible();
      const box = await panel.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(width - box.x - box.width).toBeGreaterThanOrEqual(16);
      await menu.click();
    } else {
      await expect(menu).toBeHidden();
    }
  }
});

test("search prompts fit and clearing restores the empty field", async ({ page }) => {
  for (const width of [320, 390, 601]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [path, selector] of [["/", ".search-box"], ["/articles", ".inline-search"], ["/images", ".inline-search"], ["/search", ".search-page-input"]]) {
      await page.goto(path);
      const field = page.locator(selector);
      const input = field.locator("input");
      const clear = field.locator("[data-clear]");
      const available = await input.evaluate(async (element) => {
        await document.fonts.ready;
        const style = getComputedStyle(element);
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          - context.measureText(element.placeholder).width;
      });
      expect(available, `${path} at ${width}px`).toBeGreaterThanOrEqual(0);
      if (path === "/search") {
        const titleHeight = await page.locator(".search-page h1").evaluate((title) =>
          title.clientHeight - parseFloat(getComputedStyle(title).lineHeight));
        expect(titleHeight).toBeLessThanOrEqual(1);
        await expect(clear).toBeHidden();
        await input.fill("社会观察");
        await input.press("Tab");
        await expect(clear).toBeFocused();
        await clear.press("Enter");
        await expect(input).toHaveValue("");
        await expect(input).toBeFocused();
        await expect(clear).toBeHidden();
      }
    }
  }
});

test("middle archive pages keep the full pagination row inside the toolbar width", async ({ page }) => {
  for (const [path, current] of [["/articles?page=7", "7"], ["/images?page=5", "5"]]) {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(path);
    const numbers = page.locator("[data-page-numbers]");
    await expect(numbers.locator('[aria-current="page"]')).toHaveText(current);
    await expect(numbers.locator(".page-gap").first()).toBeVisible();
    const width = await numbers.evaluate(async (row) => {
      await document.fonts.ready;
      const { left, right } = row.getBoundingClientRect();
      return [...row.children].every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= left - 1 && rect.right <= right + 1;
      });
    });
    expect(width).toBe(true);
  }
});
