import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

const yellow = "rgb(240, 200, 87)";
const ink = "rgb(21, 21, 21)";
const coral = "rgb(185, 56, 36)";
const transparent = "rgba(0, 0, 0, 0)";

test.describe("mouse hover feedback", () => {
  test.skip(({ isMobile }) => isMobile, "A mouse-capable browser is needed for hover.");

  test("pagination highlights available controls without changing the current or disabled state", async ({ page }) => {
    await page.goto("/images?page=3");
    await waitForCatalog(page);
    const nav = page.getByRole("navigation", { name: "图片分页" });
    const previous = nav.getByRole("button", { name: "上一页" });
    const next = nav.getByRole("button", { name: "下一页" });
    const shortcut = nav.getByRole("button", { name: "第 2 页", exact: true });
    const current = nav.getByRole("button", { name: "第 3 页", exact: true });

    for (const control of [previous, next, shortcut]) {
      await expect(control).toHaveCSS("cursor", "pointer");
      await control.hover();
      await expect(control).toHaveCSS("background-color", yellow);
      await expect(control).toHaveCSS("border-top-color", ink);
    }
    await current.hover();
    await expect(current).toHaveCSS("background-color", ink);
    await shortcut.focus();
    await page.keyboard.press("Tab");
    await expect(current).toBeFocused();
    await expect(current).toHaveCSS("outline-style", "solid");

    // The screenshot's compact layout must still respond on narrow windows with a mouse.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(shortcut).toBeHidden();
    for (const control of [previous, next]) {
      await control.hover();
      await expect(control).toHaveCSS("background-color", yellow);
    }
    await nav.screenshot({ path: test.info().outputPath("compact-next-hover.png") });

    await page.goto("/articles");
    await waitForCatalog(page);
    const articleNav = page.getByRole("navigation", { name: "文章分页" });
    const disabled = articleNav.getByRole("button", { name: "上一页" });
    await expect(disabled).toBeDisabled();
    await disabled.hover();
    await expect(disabled).toHaveCSS("background-color", transparent);
    const articleNext = articleNav.getByRole("button", { name: "下一页" });
    await articleNext.hover();
    await expect(articleNext).toHaveCSS("background-color", yellow);
  });

  test("navigation, search clear and gallery controls respond to a mouse", async ({ page }) => {
    await page.goto("/browse/images/2");
    const staticNext = page.getByRole("link", { name: "下一页" });
    await staticNext.hover();
    await expect(staticNext).toHaveCSS("color", coral);
    for (const selector of [".header-search", ".header-favorites"]) {
      const link = page.locator(selector);
      await link.hover();
      await expect(link).toHaveCSS("color", coral);
    }

    await page.goto("/search?q=开心");
    const clear = page.getByRole("button", { name: "清空搜索" });
    await clear.hover();
    await expect(clear).toHaveCSS("background-color", yellow);
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.locator(".mobile-nav summary");
    await menu.hover();
    await expect(menu).toHaveCSS("background-color", yellow);
    await menu.click();
    const menuLink = page.locator(".mobile-nav nav a").first();
    await menuLink.hover();
    await expect(menuLink).toHaveCSS("background-color", yellow);

    await page.goto("/20261117-mpyo");
    const gallery = page.locator("main [data-image-gallery]");
    const next = gallery.getByRole("button", { name: "下一张图片" });
    await next.hover();
    await expect(next).toHaveCSS("background-color", yellow);
    const thumbnail = gallery.getByRole("link", { name: "第 2 张" });
    await thumbnail.hover();
    await expect(thumbnail).toHaveCSS("border-top-color", coral);
    const selected = gallery.getByRole("link", { name: "第 1 张" });
    await selected.hover();
    await expect(selected).toHaveCSS("border-top-color", ink);
  });
});
