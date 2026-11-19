import { expect, test } from "@playwright/test";
import { catalogItems, waitForCatalog } from "./archive-helpers.mjs";

test("the homepage shows real content and usable type controls above the fold", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 390, 519, 520, 553, 901, 1440]) {
    await page.setViewportSize({ width, height: 672 });
    const layout = await page.locator(".home-discovery").evaluate(async (area) => {
      await document.fonts.ready;
      const bar = area.querySelector(".home-feed-heading").getBoundingClientRect();
      const tabs = area.querySelector(".view-tabs").getBoundingClientRect();
      const first = area.querySelector(".home-feed-item").getBoundingClientRect();
      const firstArticle = area.querySelector('[data-home-section="articles"]').getBoundingClientRect();
      return {
        tabsFit: tabs.width > 0 && tabs.left >= bar.left && tabs.right <= bar.right + 1,
        cardsFollowControls: first.top >= tabs.bottom && first.top < innerHeight / 2,
        cardsShareRow: Math.abs(first.top - firstArticle.top) <= 1 && firstArticle.left > first.left,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(layout, `homepage at ${width}px`).toEqual({ tabsFit: true, cardsFollowControls: true, cardsShareRow: width >= 520, pageFits: true });
  }
});

test("search shows each count once and fits real results in the narrow first screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 672 });
  const requests = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/catalog/")) requests.push(request.url()); });
  await page.goto("/search?articlesPage=2&imagesPage=2");
  await waitForCatalog(page);
  const articles = page.locator('[data-search-group][data-catalog-kind="articles"]');
  const images = page.locator('[data-search-group][data-catalog-kind="images"]');
  await expect(page.getByRole("heading", { name: "搜索", exact: true, level: 1 })).toBeVisible();
  const browse = page.getByRole("navigation", { name: "浏览内容" });
  const input = page.getByRole("textbox", { name: "搜索内容" });
  const empty = page.locator("[data-empty]");
  await expect(page).toHaveURL(/\/search$/);
  await expect(browse.getByRole("link", { name: "浏览文章" })).toBeInViewport();
  await expect(browse.getByRole("link", { name: "浏览图片" })).toHaveAttribute("href", "/images");
  await expect(articles).toBeHidden();
  await expect(images).toBeHidden();
  await expect(empty).toBeHidden();
  await input.fill("   ");
  expect(requests).toEqual([]);
  await input.fill("京东旗舰店金盘");
  await expect(articles.locator("[data-group-count]")).toHaveText("1");
  await expect(articles.locator(".article-card").first()).toBeInViewport({ ratio: 0.5 });
  await expect(images).toBeHidden();
  await expect(browse).toBeHidden();
  await input.fill("不存在的版式验收词");
  await expect(empty).toBeVisible();
  await expect(input).toHaveValue("不存在的版式验收词");
  await expect(articles).toBeHidden();
  const beforeClear = requests.length;
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(browse).toBeVisible();
  await expect(empty).toBeHidden();
  await expect(page.locator("main [data-search-item]")).toHaveCount(0);
  await expect(page).toHaveURL(/\/search$/);
  expect(requests).toHaveLength(beforeClear);
});

test("empty and populated collections show useful content before the fold", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 672 });
  await page.goto("/favorites");
  const empty = page.locator("[data-favorites-empty]");
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("link", { name: "去逛文章" })).toBeInViewport({ ratio: 1 });
  const importBackup = page.getByRole("button", { name: "导入备份" });
  await expect(importBackup).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeHidden();
  await expect(page.getByRole("button", { name: "覆盖导入" })).toBeHidden();
  const item = await page.evaluate(() => JSON.parse(document.querySelector("[data-favorites-catalog]").textContent)[0]);
  const now = new Date().toISOString();
  const chooser = page.waitForEvent("filechooser");
  await importBackup.click();
  await (await chooser).setFiles({ name: "favorites.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    format: "xgif-favorites", version: 1, updatedAt: now, items: [{ ...item, savedAt: now }],
  })) });
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "覆盖导入" })).toBeVisible();
  await expect(page.locator(".favorite-row").first()).toBeInViewport({ ratio: 1 });
  await expect(empty).toBeHidden();
});

test("the narrow article dialog aligns the heading and summary with the reading area", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 672 });
  await page.goto("/articles");
  await waitForCatalog(page);
  const id = "20260124-ua7e";
  const article = (await catalogItems(page, "articles")).find(item => item.id === id);
  await page.locator("[data-filter-input]").fill(article.title);
  await page.locator(`main .article-card h2 a[href="/${id}"]`).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const summary = await dialog.locator(".detail-summary").boundingBox();
  const readingArea = await dialog.locator(".detail-grid").boundingBox();
  expect(Math.abs(summary.x - readingArea.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(summary.x + summary.width - readingArea.x - readingArea.width)).toBeLessThanOrEqual(1);
  const close = dialog.getByRole("button", { name: "关闭详情" });
  await expect(close).toBeInViewport({ ratio: 1 });
  await close.click();
  await expect(dialog).toHaveCount(0);
});

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

test("page headings fit on one line when there is room", async ({ page }) => {
  for (const [path, selector] of [
    ["/", ".home-feed-heading h1"], ["/", ".tag-intro h2"], ["/articles", "h1"],
    ["/tags", "h1"], ["/about", "h1"], ["/rights", "h1"], ["/privacy", "h1"],
  ]) {
    await page.goto(path);
    for (const width of [320, 390, 600, 601, 820, 821, 900, 901, 1440, 1920]) {
      await page.setViewportSize({ width, height: 850 });
      const layout = await page.locator(selector).evaluate(async (heading) => {
        await document.fonts.ready;
        const style = getComputedStyle(heading);
        const range = document.createRange();
        range.selectNodeContents(heading);
        const rects = [...range.getClientRects()];
        const wrap = heading.clientHeight > parseFloat(style.lineHeight) + 1;
        const available = heading.getBoundingClientRect();
        const probe = heading.cloneNode(true);
        Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: "max-content", maxWidth: "none", whiteSpace: "nowrap" });
        heading.after(probe);
        const singleLineWidth = probe.getBoundingClientRect().width;
        probe.remove();
        return { wrap, singleLineWidth, available: available.width,
          outside: rects.some(rect => rect.left < available.left - 1 || rect.right > available.right + 1) };
      });
      const label = `${path} ${selector} at ${width}px`;
      expect(layout.outside, label).toBe(false);
      if (layout.singleLineWidth <= layout.available + 1) expect(layout.wrap, label).toBe(false);
    }
  }
});

test("tag titles and results share the same left edge", async ({ page }) => {
  for (const width of [320, 600, 601, 900, 901, 1440, 1920]) {
    await page.setViewportSize({ width, height: 850 });
    for (const tag of ["社会观察", "AI"]) {
      await page.goto(`/tags/${encodeURIComponent(tag)}`);
      const heading = page.locator(".tag-detail-hero h1");
      const results = page.locator(".tag-results [data-list-scope]").first();
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

test("footer navigation fits and the floating control clears it at the end of the page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/images");
  const footer = page.getByRole("contentinfo");
  const button = page.getByRole("button", { name: "返回顶部" });
  await expect(footer.getByRole("list", { name: "实用功能" }).getByRole("link")).toHaveCount(1);
  await expect(footer.getByRole("list", { name: "站点信息" }).getByRole("link")).toHaveCount(4);
  await expect(footer.getByRole("link", { name: "文章" })).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "图片" })).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "标签" })).toHaveCount(0);
  for (const width of [320, 390, 520, 521, 600, 750, 900, 901, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const { overlap, outside } = await footer.evaluate(async (footer) => {
      await document.fonts.ready;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const identity = footer.querySelector(".footer-identity").getBoundingClientRect();
      const links = [...footer.querySelectorAll(".footer-links a")].map((a) => a.getBoundingClientRect());
      return {
        overlap: links.some((link) => link.left < identity.right && link.right > identity.left
          && link.top < identity.bottom && link.bottom > identity.top),
        outside: links.some((link) => link.left < -1 || link.right > innerWidth + 1),
      };
    });
    expect(overlap, `footer at ${width}px`).toBe(false);
    expect(outside, `footer at ${width}px`).toBe(false);
    if (width <= 900) {
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect.poll(async () => {
        const item = await button.boundingBox();
        const end = await footer.boundingBox();
        return end.y - item.y - item.height;
      }, { message: `back-to-top clearance at ${width}px` }).toBeGreaterThanOrEqual(7);
    } else {
      await expect(button).toBeHidden();
    }
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
  const header = page.locator(".site-header");
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
      await expect(panel.getByRole("link")).toHaveText(["文章", "图片 / GIF", "标签"]);
      await expect(header.locator('a[href="/favorites"]:visible')).toHaveCount(1);
      await expect(header.locator('a[href="/search"]:visible')).toHaveCount(1);
      await menu.click();
    } else {
      await expect(menu).toBeHidden();
    }
  }
});

test("search prompts fit and clearing restores the empty field", async ({ page }) => {
  for (const width of [320, 390, 601]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [path, selector] of [["/articles", ".inline-search"], ["/images", ".inline-search"], ["/search", ".search-page-input"]]) {
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
