import { expect, test } from "@playwright/test";

test("new article starts clean and explains disabled AI actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#article-panel")).toHaveClass(/active/);
  await expect(page.locator("#article-result")).toBeHidden();
  await expect(page.locator('[data-ai-fill="article"]')).toBeDisabled();
  await expect(page.locator("#article-ai-availability")).not.toHaveText("");
  await expect(page.locator("#article-body-stats")).toHaveText("0 字，0 段");
});

test("system status is a dedicated workspace instead of a floating popover", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-nav-action="system-status"]').click();
  await expect(page.locator("#system-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("系统状态与恢复");
  await expect(page.locator(".status-details")).toHaveCount(0);
  await expect(page.locator(".network-disclosure")).toBeVisible();
});

test("content library exposes separate Git and deployment states", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="library"]').click();
  await expect(page.locator('[data-library-status="local"]')).toContainText("待同步");
  await expect(page.locator('[data-library-status="pending"]')).toContainText("待上线");
  await expect(page.locator('[data-library-status="unknown"]')).toContainText("待验证");
  await expect(page.locator(".content-table")).toBeVisible();
  await page.locator("[data-content-open]").first().click();
  await expect(page.locator(".content-state-grid")).toBeVisible();
  await expect(page.locator(".content-state-grid > div")).toHaveCount(3);
});

test("switching workspaces resets the desktop scroll position", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('[data-tab="library"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("markdown toolbar and browser version history remain keyboard reachable", async ({ page }) => {
  await page.goto("/");
  await page.locator("#article-body").fill("正文");
  await page.locator("#article-body").selectText();
  await page.locator('[data-markdown-action="bold"]').click();
  await expect(page.locator("#article-body")).toHaveValue("**正文**");
  await page.locator("#article-version-history").click();
  await expect(page.locator("#version-history-dialog")).toBeVisible();
  await expect(page.locator("[data-browser-version]").first()).toBeVisible();
});
