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
  await page.locator('[data-tab="system"]').click();
  await expect(page.locator("#system-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("系统状态与恢复");
  await expect(page.locator(".status-details")).toHaveCount(0);
  await expect(page.locator(".network-disclosure")).toBeVisible();
  await expect(page.locator(".network-disclosure")).toContainText("M4 Ollama");
  await expect(page.locator(".recommendation-status")).toBeVisible();
  await expect(page.locator("#recommendation-mode")).not.toHaveText("检查中");
  await expect(page.locator("#recommendation-refresh")).toBeEnabled();
  await expect(page.locator("#connection-ai-detail")).not.toContainText("undefined");
  await expect(page.getByText("公开代码 GitHub", { exact: true })).toBeVisible();
  await expect(page.getByText("私有内容 GitHub", { exact: true })).toBeVisible();
  await expect(page.locator("#private-content-sync")).toBeEnabled();
  await expect(page.locator("#connection-private-git-detail")).not.toContainText("undefined");
  await expect
    .poll(() =>
      page.locator(".connection-grid").evaluate((element) => element.scrollWidth <= element.clientWidth)
    )
    .toBe(true);
});

test("workspace page titles are not repeated inside their content", async ({ page }) => {
  await page.goto("/#library");
  await expect(page.getByRole("heading", { name: "内容库", exact: true })).toHaveCount(1);

  await page.locator('[data-tab="audit"]').click();
  await expect(page.getByRole("heading", { name: "内容体检与标签", exact: true })).toHaveCount(1);

  await page.locator('[data-tab="system"]').click();
  await expect(page.getByRole("heading", { name: "系统状态与恢复", exact: true })).toHaveCount(1);
});

test("content audit is a restorable workspace and not a dialog", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="audit"]').click();
  await expect(page).toHaveURL(/#audit$/);
  await expect(page.locator("#audit-panel")).toHaveClass(/active/);
  await expect(page.locator("#content-audit-summary")).not.toHaveText("正在检查内容…");
  await expect(page.locator("#content-audit-dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#audit-panel")).toHaveClass(/active/);
  await expect(page.locator('[data-tab="audit"]')).toHaveAttribute("aria-current", "page");
});

test("sync history belongs to the system workspace and browser back restores the previous page", async ({ page }) => {
  await page.goto("/#library");
  await page.locator('[data-tab="system"]').click();
  await page.locator('[data-system-view="sync"]').click();
  await expect(page).toHaveURL(/#system\/sync$/);
  await expect(page.locator('[data-system-section="sync"]')).toBeVisible();
  await expect(page.locator("#sync-history-dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#system$/);
  await expect(page.locator('[data-system-section="status"]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator("#library-panel")).toHaveClass(/active/);
});

test("recycle bin remains a focused dialog and returns focus to its sidebar entry", async ({ page }) => {
  await page.goto("/#library");
  const recycleEntry = page.locator('[data-nav-action="trash"]');
  await recycleEntry.click();
  await expect(page.locator("#trash-dialog")).toBeVisible();
  await expect(page.locator("#sidebar-trash-count")).not.toHaveText("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#trash-dialog")).toBeHidden();
  await expect(recycleEntry).toBeFocused();
  await expect(page).toHaveURL(/#library$/);
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
