import { imageArchiveFor } from "./archive-helpers.mjs";
import { expect, test } from "@playwright/test";

test("list overlays reuse one dialog and Back/Forward restore the matching content", async ({ page }) => {
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  const content = dialog.locator("[data-detail-content]");
  await expect(content).toHaveAttribute("data-content-id", "20261112-cbac");
  const next = dialog.locator('a[data-recommendation-id][data-detail-kind="image"]:visible').first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(content).toHaveAttribute("data-content-id", href.slice(1));
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.goBack();
  await expect(content).toHaveAttribute("data-content-id", "20261112-cbac");
  await page.goForward();
  await expect(content).toHaveAttribute("data-content-id", href.slice(1));
  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(page).toHaveURL(archiveUrl);
  await expect(dialog).not.toBeVisible();
});

test("standalone recommendations navigate as pages and Back restores the original page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/20260722-3u91");
  // A cold document may retain a fallback face with font-display: optional.
  // Compare navigation on the same warm font layout, as the reference does.
  await page.evaluate(() => document.fonts.ready);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const next = page.locator("main .article-recommendation:visible").first();
  const href = await next.getAttribute("href");
  // Playwright may scroll again while making the link clickable. Record the
  // position at navigation, after any actionability scroll has taken place.
  await next.evaluate(link => link.addEventListener("click", () => {
    sessionStorage.setItem("test:recommendation-scroll", String(window.scrollY));
  }, { once: true }));
  await next.click();
  await expect(page).toHaveURL(href);
  const scrollY = await page.evaluate(() => sessionStorage.getItem("test:recommendation-scroll"));
  expect(Number(scrollY)).toBeGreaterThan(0);
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goBack();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20260722-3u91");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate((before) => Math.abs(window.scrollY - before), Number(scrollY))).toBeLessThanOrEqual(2);
  await page.goForward();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("reloading an overlay does not let old history entries reopen it", async ({ page }) => {
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  await expect(page.locator("[data-detail-dialog]")).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(archiveUrl);
  await expect(page.getByRole("main").getByRole("heading", { name: "图片与表情包", level: 1 })).toBeVisible();
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  await page.goForward();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
  const next = page.locator('main a[data-recommendation-id]:visible').first();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await page.goBack();
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("Forward loads the detail page even before the archive dialog script starts", async ({ page }) => {
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  await expect(page.locator("[data-detail-dialog]")).toHaveAttribute("aria-busy", "false");
  await page.reload();

  let scriptRequested;
  const scriptPending = new Promise(resolve => { scriptRequested = resolve; });
  let allowScript;
  const releaseScript = new Promise(resolve => { allowScript = resolve; });
  await page.route("**/scripts/detail-dialog.js", async route => {
    scriptRequested();
    await releaseScript;
    await route.continue();
  }, { times: 1 });

  try {
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(archiveUrl);
    await expect(page.getByRole("main").getByRole("heading", { name: "图片与表情包", level: 1 })).toBeVisible();
    await scriptPending;
    await page.evaluate(() => history.forward());
    await expect(page).toHaveURL("/20261112-cbac");
  } finally {
    allowScript();
  }
  await expect(page.locator("main [data-detail-content]")).toHaveAttribute("data-content-id", "20261112-cbac");
  await expect(page.locator("[data-detail-dialog]")).not.toBeVisible();
});

test("long image dialogs use one vertical scroll container and keep all actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const archiveUrl = await imageArchiveFor(page, "20261112-cbac");
  await page.locator('a.image-card[href="/20261112-cbac"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const scrollers = await dialog.evaluate((root) => [...root.querySelectorAll("*")]
    .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
    .map((element) => element.className));
  expect(scrollers).toEqual(["detail-dialog-shell"]);
  const copy = dialog.locator(".image-detail-copy");
  expect(await copy.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await dialog.getByRole("link", { name: "查看 / 保存原图" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("link", { name: "查看 / 保存原图" })).toBeInViewport();
  await dialog.locator(".image-source").scrollIntoViewIfNeeded();
  await expect(dialog.locator(".image-source")).toBeInViewport();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page).toHaveURL(archiveUrl);
  await expect(dialog).not.toBeVisible();
});

test("Back restores the reading position of an earlier dialog", async ({ page }) => {
  await page.goto("/articles");
  await page.getByRole("textbox", { name: "筛选文章" }).fill("我总想用海边那天");
  await page.locator('a[data-detail-link][href="/20260710-vfks"]').first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const next = dialog.locator(".article-recommendation:visible").first();
  await next.scrollIntoViewIfNeeded();
  const shell = dialog.locator("[data-detail-shell]");
  const before = await shell.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(100);
  const href = await next.getAttribute("href");
  await next.click();
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await shell.evaluate((element) => { element.scrollTop = 300; });
  const nextScroll = await shell.evaluate((element) => element.scrollTop);
  await page.goBack();
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", "20260710-vfks");
  await expect.poll(() => shell.evaluate((element, previous) => Math.abs(element.scrollTop - previous), before)).toBeLessThanOrEqual(2);
  await page.goForward();
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", href.slice(1));
  await expect.poll(() => shell.evaluate((element, previous) => Math.abs(element.scrollTop - previous), nextScroll)).toBeLessThanOrEqual(2);
});
