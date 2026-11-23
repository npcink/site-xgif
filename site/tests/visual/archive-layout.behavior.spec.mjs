import { expect, test } from "@playwright/test";
import { catalogItems, waitForCatalog } from "./archive-helpers.mjs";

test("phone archives and tag index bring useful content into the first screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, card] of [["/articles", ".article-card"], ["/images", ".image-card"]]) {
    await page.goto(route);
    await waitForCatalog(page);
    // Allow font reflow while keeping the first card near the middle of the viewport.
    expect((await page.locator(`main ${card}`).first().boundingBox()).y).toBeLessThan(440);
  }
  await page.goto("/tags");
  const first = page.locator(".tag-index a").first();
  expect((await first.boundingBox()).height).toBeLessThan(80);
  await expect(first.locator("span:not(.tag-order)")).toBeVisible();
  await expect(first.locator("span:not(.tag-order)")).toHaveText(/篇文章.*项图片/u);
});

test("the article source selector preserves exact filters and shareable URLs", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/articles");
  await waitForCatalog(page);
  const select = page.getByRole("combobox", { name: "按来源筛选文章" });
  await expect(select).toBeInViewport();
  const source = await select.locator("option").last().getAttribute("value");
  expect(source).toBeTruthy();
  await select.selectOption(source);
  await waitForCatalog(page);
  const articles = await catalogItems(page, "articles");
  const ids = articles.filter(item => item.source === source).map(item => item.id);
  expect(ids.length).toBeGreaterThan(0);
  await expect(page.locator("[data-visible-count]")).toHaveText(String(ids.length));
  const rendered = await page.locator(".article-grid > [data-catalog-id]").evaluateAll(cards => cards.map(card => card.dataset.catalogId));
  expect(rendered).toEqual(ids.slice(0, 12));
  await expect(page).toHaveURL(url => url.searchParams.get("source") === source);
  await page.reload();
  await waitForCatalog(page);
  await expect(select).toHaveValue(source);
  const keyword = source;
  const index = new Map((await catalogItems(page, "articles", true)).map(item => [item.id, item.text]));
  await page.getByRole("textbox", { name: "筛选文章" }).fill(keyword);
  await waitForCatalog(page);
  await expect(page.locator("[data-visible-count]")).toHaveText(String(ids.filter(id => index.get(id).includes(keyword)).length));
  await select.selectOption("");
  await waitForCatalog(page);
  await expect(page).toHaveURL(url => url.searchParams.get("q") === keyword && !url.searchParams.has("source"));
});

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

test("mobile back-to-top is reachable on pages with less than one screen of scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rights");
  const button = page.getByRole("button", { name: "返回顶部" });
  await expect(button).toBeHidden();
  const range = await page.evaluate(async () => {
    await document.fonts.ready;
    const maxScroll = document.scrollingElement.scrollHeight - innerHeight;
    window.scrollTo(0, maxScroll);
    return maxScroll;
  });
  expect(range).toBeGreaterThan(120);
  expect(range).toBeLessThan(844);
  await button.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator(".site-header .brand")).toBeFocused();
});
