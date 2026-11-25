import { imageArchiveFor, waitForCatalog } from "./archive-helpers.mjs";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Reusing this audit against production must not write synthetic favorite counts.
  await page.route("**/api/favorites/events", (route) => route.fulfill({ status: 202, body: "{}" }));
  await page.route("https://img.xgif.cn/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"/>',
  }));
});

for (const route of ["/", "/articles?page=2", "/images?media=animated", "/search?q=海边", "/tags/反转"]) {
  test(`list navigation preserves its origin, filters and page scroll: ${route}`, async ({ page }) => {
    await page.goto(route);
    const origin = page.url();
    const link = page.locator("main a[data-detail-link]:visible").first();
    const href = await link.getAttribute("href");
    await link.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    const visibleIds = await page.locator("main [data-search-item]:visible").evaluateAll((items) => items.map((item) => item.dataset.catalogId));
    await link.click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(link).toBeFocused();
    expect(page.url()).toBe(origin);
    await expect.poll(() => page.evaluate((before) => Math.abs(window.scrollY - before), scrollY)).toBeLessThanOrEqual(2);
    expect(await page.locator("main [data-search-item]:visible").evaluateAll((items) => items.map((item) => item.dataset.catalogId))).toEqual(visibleIds);
    await page.goForward();
    await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    const verticalScrollers = await dialog.evaluate((root) => [...root.querySelectorAll("*")]
      .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.className));
    expect(verticalScrollers.every((name) => name === "detail-dialog-shell")).toBe(true);
    expect(await dialog.locator("[data-detail-shell]").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/detail-dialog-open/);
  });
}

test("empty favorites offer both archives and backup import", async ({ page }) => {
  await page.goto("/favorites");
  const empty = page.locator("[data-favorites-empty]");
  await expect(empty.getByRole("link", { name: "去逛文章" })).toHaveAttribute("href", "/articles");
  await expect(empty.getByRole("link", { name: "去逛图片" })).toHaveAttribute("href", "/images");
  await expect(empty.getByRole("button", { name: "导入备份" })).toBeVisible();
});

test("unknown content preserves HTTP 404 and offers site navigation", async ({ page }) => {
  const response = await page.goto("/20990101-none");
  expect(response.status()).toBe(404);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "页面没有找到" })).toBeVisible();
  await expect(main.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  await expect(main.getByRole("link", { name: "搜索内容" })).toHaveAttribute("href", "/search");
  await expect(main.getByRole("link", { name: "浏览图片" })).toHaveAttribute("href", "/images");
});

test("reloading a removed overlay destination stays on its 404 page", async ({ page }) => {
  await page.goto("/images");
  const documents = [];
  page.on("request", request => {
    if (request.resourceType() === "document") documents.push(new URL(request.url()).pathname);
  });
  await page.evaluate(() => history.pushState({ detailDialog: true }, "", "/20990101-none"));
  const response = await page.reload();
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "页面没有找到" })).toBeVisible();
  expect(documents).toEqual(["/20990101-none"]);
});

test("image dialog close control does not overlap the image on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await imageArchiveFor(page, "20261117-0wmy");
  const card = page.locator('main a.image-card[href="/20261117-0wmy"]');
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const close = dialog.getByRole("button", { name: "关闭详情" });
  const button = await close.boundingBox();
  const image = await dialog.locator(".image-detail figure img").first().boundingBox();
  expect(button.y + button.height).toBeLessThanOrEqual(image.y);
  await dialog.locator(".image-source").scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport();
  await close.click();
  await expect(card).toBeFocused();
});

test("favorites open full pages and Back restores the saved list", async ({ page }) => {
  await page.goto("/20261112-cbac");
  await page.locator("main [data-favorite-toggle]").click();
  await page.goto("/favorites");
  await page.locator('.favorite-row a[href="/20261112-cbac"]').click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/favorites");
  await expect(page.locator(".favorite-row")).toHaveCount(1);
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("activity page keeps the header as its only home entry", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.locator("main a[href='/']")).toHaveCount(0);
  await expect(page.locator(".site-header .brand")).toHaveAttribute("href", "/");
});

test("article cards and detail views offer one entry for each action", async ({ page }) => {
  const href = "/20260710-vfks";
  const source = 'a[href="https://jandan.net/t/6175953"]';
  await page.goto(`/search?q=${encodeURIComponent("海边")}`);
  await waitForCatalog(page);
  const card = page.locator(`.article-card[data-catalog-id="${href.slice(1)}"]`);
  await expect(card.locator(`a[href="${href}"]`)).toHaveCount(1);
  await card.getByRole("heading").getByRole("link").press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(source)).toBeVisible();
  await expect(dialog.locator(source)).toHaveCount(1);
  await expect(dialog.locator("[data-favorite-toggle]")).toHaveCount(1);
  await dialog.getByRole("link", { name: "打开独立文章页" }).click();
  const detail = page.locator("main [data-detail-content]");
  await expect(detail.locator(source)).toBeVisible();
  await expect(detail.locator(source)).toHaveCount(1);
  await expect(detail.locator("[data-favorite-toggle]")).toHaveCount(1);
  await expect(detail.getByRole("link", { name: "打开独立文章页" })).toHaveCount(0);
});

test("long image copy and real galleries have one vertical scroller at phone, tablet and desktop widths", async ({ page }) => {
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    for (const id of ["20261112-cbac", "20261112-8jzn"]) {
      await imageArchiveFor(page, id);
      await page.locator(`a.image-card[href="/${id}"]`).click();
      const dialog = page.locator("[data-detail-dialog]");
      await expect(dialog).toHaveAttribute("aria-busy", "false");
      const geometry = await dialog.evaluate((root) => ({
        scrollable: [...root.querySelectorAll("*")]
          .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
          .map((element) => element.className),
        overflow: root.querySelector("[data-detail-shell]").scrollWidth - root.querySelector("[data-detail-shell]").clientWidth,
      }));
      expect(geometry.scrollable).toEqual(["detail-dialog-shell"]);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      await dialog.locator(".image-source").scrollIntoViewIfNeeded();
      await expect(dialog.locator(".image-source")).toBeInViewport();
    }
  }
});

test("Back retains the selected image of a gallery", async ({ page }) => {
  const archiveUrl = await imageArchiveFor(page, "20261112-8jzn");
  await page.locator('a.image-card[href="/20261112-8jzn"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await dialog.locator('[data-gallery-index="1"]').click();
  await expect(dialog.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  await expect(dialog.locator("[data-gallery-stage] a")).toHaveCount(0);
  await expect(dialog.locator("[data-gallery-original]")).toHaveAttribute("href", await dialog.locator('[data-gallery-index="1"]').getAttribute("href"));
  const original = await dialog.locator("[data-gallery-original]").getAttribute("href");
  const next = dialog.locator('a[data-recommendation-id]:visible').first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await page.goBack();
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", "20261112-8jzn");
  await expect(dialog.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  await expect(dialog.locator("[data-gallery-original]")).toHaveAttribute("href", original);
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator('a.image-card[href="/20261112-8jzn"]').click();
  await expect(dialog.locator("[data-gallery-counter]")).toHaveText("1 / 3");
});

test("a failed dialog fetch falls back to a usable standalone page", async ({ page }) => {
  await page.route("**/20261112-cbac", (route) => route.request().resourceType() === "document"
    ? route.continue() : route.fulfill({ status: 503, body: "temporarily unavailable" }));
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(archiveUrl);
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("image recommendations on standalone pages also navigate natively", async ({ page }) => {
  await page.goto("/20261112-cbac");
  const next = page.locator('main a[data-recommendation-id][data-detail-kind="image"]:visible').first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goBack();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("a dialog can switch between images and articles without another scroll layer", async ({ page }) => {
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const next = dialog.locator('.article-recommendation:visible').first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(dialog).toHaveAttribute("data-detail-kind", "article");
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  expect(await dialog.evaluate((root) => [...root.querySelectorAll("*")]
    .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
    .every((element) => element.classList.contains("detail-dialog-shell")))).toBe(true);
  await page.goBack();
  await expect(dialog).toHaveAttribute("data-detail-kind", "image");
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page).toHaveURL(archiveUrl);
  await expect(dialog).not.toBeVisible();
});

test("Escape during a pending detail request closes without locking the list", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/20261112-cbac", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
    await page.locator('a.image-card[href="/20261112-cbac"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(archiveUrl);
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/detail-dialog-open/);
    release();
    await page.locator('a.image-card[href="/20261112-cbac"]').click();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
