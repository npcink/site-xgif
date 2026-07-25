import { expect, test } from "@playwright/test";

test("1280 by 800 is the minimum desktop baseline without mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator("#workspace-sidebar")).toBeVisible();
  await expect(page.locator("#workspace-nav-toggle, #workspace-nav-close, #workspace-nav-scrim")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test("content library is the default and a new article starts clean", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#library-panel")).toHaveClass(/active/);
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="article"]').click();
  await expect(page.locator("#article-panel")).toHaveClass(/active/);
  await expect(page.locator("#article-result")).toBeHidden();
  await expect(page.locator('[data-ai-fill="article"]')).toBeDisabled();
  await expect(page.locator("#article-ai-availability")).not.toHaveText("");
  await expect(page.locator("#article-body-stats")).toHaveText("0 字，0 段");
});

test("imported articles use an explicit publish confirmation that resets after content changes", async ({ page }) => {
  await page.goto("/");
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="article"]').click();
  const confirmation = page.locator("#article-review-confirmation");
  const confirmed = page.locator('[name="internalReviewConfirmed"]');
  const status = page.locator('[name="internalReviewStatus"]');

  await expect(confirmation).toBeHidden();
  await page.locator("#article-details > summary").click();
  await page.locator(".internal-review-details summary").click();
  await page.locator('[name="internalNote"]').fill("从 flomo 私人收藏导入，请在公开前复核来源和内容。");
  await expect(confirmation).toBeVisible();
  await confirmed.check();
  await expect(status).toHaveValue("resolved");
  await page.locator("#article-body").fill("复核后补充了一句正文。");
  await expect(confirmed).not.toBeChecked();
  await expect(status).toHaveValue("unresolved");
});

test("system status is a dedicated workspace instead of a floating popover", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="system"]').click();
  await expect(page.locator("#system-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("系统");
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

test("image editor defaults to draft and exposes one publish action", async ({ page }) => {
  await page.goto("/");
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="image"]').click();
  await expect(page.locator('#image-form [name="publishMode"][value="draft"]')).toBeChecked();
  await expect(page.locator('#image-form button[type="submit"]')).toHaveText("保存草稿");
  await expect(page.locator("#image-form [data-quality]")).toHaveCount(0);
  await expect(page.locator("#image-form [name=commit], #image-form [name=push]")).toHaveCount(0);
  await expect(page.locator("#image-panel [data-image-preview]")).toHaveCount(0);
});

test("tag governance is a low-frequency system section", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="system"]').click();
  await page.locator('[data-system-view="tags"]').click();
  await expect(page).toHaveURL(/#system\/tags$/);
  await expect(page.locator('[data-system-section="tags"]')).toBeVisible();
  await expect(page.locator("#tag-governance-list")).toBeVisible();
  await expect(page.locator("#audit-panel .tag-governance")).toHaveCount(0);
});

test("workspace page titles are not repeated inside their content", async ({ page }) => {
  await page.goto("/#library");
  await expect(page.getByRole("heading", { name: "内容库", exact: true })).toHaveCount(1);

  await page.locator("#library-audit").click();
  await expect(page.getByRole("heading", { name: "待处理内容", exact: true })).toHaveCount(1);

  await page.locator('[data-tab="system"]').click();
  await expect(page.getByRole("heading", { name: "系统", exact: true })).toHaveCount(1);
});

test("content audit is a restorable workspace and not a dialog", async ({ page }) => {
  await page.goto("/");
  await page.locator("#library-audit").click();
  await expect(page).toHaveURL(/#audit$/);
  await expect(page.locator("#audit-panel")).toHaveClass(/active/);
  await expect(page.locator("#content-audit-summary")).not.toHaveText("正在检查内容…");
  await expect(page.locator("#content-audit-dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#audit-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("待处理内容");
});

test("opening an audited article carries its repair guidance into the editor", async ({ page }) => {
  await page.route("**/api/content/audit", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      counts: { ready: 0, review: 1, draft: 0 },
      items: [{
        file: "site/src/content/articles/20260101-test.md",
        type: "article",
        title: "待处理文章",
        source: "知乎",
        status: "review",
        blockers: [],
        warnings: [
          "正文含 1 个超过 180 字的长段落（最长 220 字），建议分段后再发布。",
          "来源链接只指向网站首页，需要确认具体原文地址。",
        ],
        notices: [],
      }],
    }),
  }));
  await page.route("**/api/content/read?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      type: "article",
      file: "site/src/content/articles/20260101-test.md",
      data: {
        title: "待处理文章",
        summary: "用于验证体检直达编辑器。",
        source: "知乎",
        sourceUrl: "https://www.zhihu.com/",
        sourceKind: "publication",
        tags: ["生活"],
        pubDate: "2026-01-01",
        readTime: "1 分钟",
        draft: true,
      },
      body: "需要安全分段的正文。",
      previewUrl: "http://127.0.0.1:4321/preview/articles/20260101-test",
      workflow: { state: "draft", label: "草稿", description: "只保存在本地内容库。" },
    }),
  }));

  await page.goto("/");
  await page.locator("#library-audit").click();
  await page.locator('[data-audit-open-article]').click();

  const guidance = page.locator("#article-audit-guidance");
  await expect(page.locator("#article-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("编辑文章");
  await expect(guidance).toBeVisible();
  await expect(guidance).toContainText("超过 180 字的长段落");
  await expect(guidance).toContainText("来源链接只指向网站首页");
  await expect(guidance).toContainText("AI 辅助");
  await expect(guidance).toContainText("自动复核");
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

test("recycle bin remains a focused dialog and returns focus to its library entry", async ({ page }) => {
  await page.goto("/#library");
  const recycleEntry = page.locator("#library-open-trash");
  await page.locator(".library-tools-more > summary").click();
  await recycleEntry.click();
  await expect(page.locator("#trash-dialog")).toBeVisible();
  await expect(page.locator("#library-trash-count")).not.toHaveText("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#trash-dialog")).toBeHidden();
  await expect(recycleEntry).toBeFocused();
  await expect(page).toHaveURL(/#library$/);
});

test("content library groups content locations and keeps process details", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="library"]').click();
  await expect(page.locator('[data-library-status="local"]')).toContainText("本地发布");
  await expect(page.locator('[data-library-status="cloud"]')).toContainText("云端流程");
  await expect(page.locator('[data-library-status="pending"]')).toHaveCount(0);
  await page.locator('[data-library-status="cloud"]').click();
  await expect(page.locator('[data-library-status="cloud"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-library-status="all"]').click();
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
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="article"]').click();
  await page.locator("#article-body").fill("正文");
  await page.locator("#article-body").selectText();
  await page.locator('[data-markdown-action="bold"]').click();
  await expect(page.locator("#article-body")).toHaveValue("**正文**");
  await page.locator("#article-version-history").click();
  await expect(page.locator("#version-history-dialog")).toBeVisible();
  await expect(page.locator("[data-browser-version]").first()).toBeVisible();
});
