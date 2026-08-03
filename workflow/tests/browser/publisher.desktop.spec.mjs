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

test("articles without a source link use an explicit publishable disclosure", async ({ page }) => {
  await page.goto("/");
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="article"]').click();
  await page.locator("#article-source-summary").click();

  const sourceKind = page.locator('#article-form [name="sourceKind"]');
  const sourceUrl = page.locator('#article-form [name="sourceUrl"]');
  await expect(sourceKind.locator("option")).toHaveCount(3);
  await expect(sourceKind.locator("option")).toHaveText(["来源待确认", "原创内容", "外部来源"]);
  await sourceKind.selectOption("unknown");
  await expect(sourceUrl).not.toHaveAttribute("required", "");
  await expect(sourceUrl).toHaveAttribute("placeholder", "没有具体原文可留空并正常发布");
  await expect(page.locator('#article-form [name="editorNote"]')).toBeHidden();
  await expect(page.locator("#article-source-details")).toHaveAttribute("open", "");
  await expect(page.locator("#article-source-details")).toContainText("没有原文链接也能正常发布");
  await expect(page.locator("#article-source-details")).toContainText("不要填写网站首页");
});

test("imported articles use an explicit publish confirmation that resets after content changes", async ({ page }) => {
  await page.goto("/");
  await page.locator(".workspace-create-menu > summary").click();
  await page.locator('[data-tab="article"]').click();
  const confirmation = page.locator("#article-review-confirmation");
  const confirmed = page.locator('[name="internalReviewConfirmed"]');
  const status = page.locator('[name="internalReviewStatus"]');

  await expect(confirmation).toBeHidden();
  await page.locator("#article-source-summary").click();
  await page.locator(".internal-review-details summary").click();
  await page.locator('[name="internalNote"]').fill("从 flomo 私人收藏导入，请在公开前复核来源和内容。");
  await expect(confirmation).toBeVisible();
  await confirmed.check();
  await page.locator("#article-advanced-settings > summary").click();
  const shortFormReviewed = page.locator('[name="shortFormReviewed"]');
  await shortFormReviewed.check();
  await expect(status).toHaveValue("resolved");
  await page.locator("#article-body").fill("复核后补充了一句正文。");
  await expect(confirmed).not.toBeChecked();
  await expect(shortFormReviewed).not.toBeChecked();
  await expect(status).toHaveValue("unresolved");
});

test("batch publish repairs paragraphs and records one explicit review confirmation", async ({ page }) => {
  const file = "site/src/content/articles/20260101-batch.md";
  let publishPayload = null;
  await page.route("**/api/content?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      counts: { all: 1, draft: 1, local: 0, pending: 0, unknown: 0, online: 0, cloud: 0, attention: 1 },
      pagination: { page: 1, pages: 1, total: 1, from: 1, to: 1 },
      items: [{
        type: "article",
        file,
        title: "需要批量整理的草稿",
        summary: "用于验证批量安全分段与一次复核确认。",
        source: "煎蛋",
        sourceUrl: "https://jandan.net/t/1",
        tags: ["生活"],
        pubDate: "2026-01-01",
        publication: { state: "draft" },
        workflow: { state: "draft" },
        data: { draft: true },
      }],
    }),
  }));
  await page.route("**/api/content/batch", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "inspect-publish") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          total: 1,
          eligible: 1,
          skipped: 0,
          ready: 0,
          blocked: 1,
          needsParagraphs: 1,
          needsInternalReview: 1,
          results: [{
            type: "article",
            file,
            title: "需要批量整理的草稿",
            summary: "用于验证批量安全分段与一次复核确认。",
            source: "煎蛋",
            sourceUrl: "https://jandan.net/t/1",
            body: "需要批量安全分段的正文。",
            eligible: true,
            ok: false,
            needsParagraphs: true,
            longParagraphCount: 1,
            longestParagraph: 257,
            needsInternalReview: true,
            internalNote: "从私人收藏导入，请在公开前复核。",
            manualBlockers: [],
            contentSha256: "a".repeat(64),
            issues: [],
          }],
        }),
      });
      return;
    }
    publishPayload = payload;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        succeeded: [{ type: "article", file, title: "需要批量整理的草稿" }],
        skipped: [],
        failed: [],
        paragraphsOrganized: 1,
        reviewsResolved: 1,
      }),
    });
  });

  await page.goto("/#library");
  await page.locator("#library-batch-toggle").click();
  await page.locator(`[data-content-select="${file}"]`).check();
  await page.locator("#library-bulk-publish").click();

  await expect(page.locator("#batch-publish-dialog")).toBeVisible();
  await expect(page.locator("#batch-publish-summary")).toContainText("1 条将自动安全分段");
  await expect(page.locator("#batch-publish-summary")).toContainText("1 条需要一次批量复核确认");
  await page.locator(".batch-publish-body summary").click();
  await expect(page.locator(".batch-publish-body")).toContainText("需要批量安全分段的正文");
  await expect(page.locator("#batch-publish-submit")).toBeEnabled();
  await page.locator("#batch-publish-submit").click();
  await expect(page.locator("#batch-publish-status")).toContainText("请先确认");

  await page.locator("#batch-publish-review-confirmed").check();
  await page.locator("#batch-publish-submit").click();
  await expect(page.locator("#batch-publish-dialog")).toBeHidden();
  await expect(page.locator("#library-result")).toContainText("已安全分段 1 条");
  expect(publishPayload.autoOrganizeParagraphs).toBe(true);
  expect(publishPayload.confirmInternalReview).toBe(true);
  expect(publishPayload.items).toEqual([{
    type: "article",
    file,
    expectedContentSha256: "a".repeat(64),
  }]);
});

test("article editor keeps writing central and publishing controls in a desktop inspector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#article");

  await expect(page.locator(".article-workspace-toolbar")).toBeVisible();
  await expect(page.locator(".article-editor-canvas")).toBeVisible();
  await expect(page.locator(".article-inspector")).toBeVisible();
  await expect(page.locator("#article-title")).toBeVisible();
  await expect(page.locator("#article-ai-menu")).toBeHidden();
  await expect(page.locator("#article-body")).toBeVisible();
  await expect(page.locator('[data-ai-fill="article"]')).toHaveText("整理与分段");
  await expect(page.locator("#article-ai-review")).toBeHidden();
  await expect(page.locator("#article-cover-alt-field")).toBeHidden();
  await expect(page.locator(".article-inspector-tabs [role=tab]")).toHaveCount(3);
  await expect(page.locator("#article-save-draft")).toBeHidden();
  await expect(page.locator("#article-real-preview")).toBeHidden();
  await expect(page.locator("#article-next-action")).toBeVisible();
  await expect(page.locator("#article-next-action")).toHaveText("发布");
  await expect(page.locator("#article-next-action")).toBeEnabled();

  await page.locator("#article-body").fill("这是一段用于计算阅读时间的正文。");
  await expect(page.locator('[name="readTime"]')).toHaveValue("1 分钟");
  await expect(page.locator("#article-read-time-display")).toHaveText("1 分钟");
  await expect(page.locator("#article-save-draft")).not.toHaveAttribute("hidden", "");
  await page.locator(".article-workspace-toolbar .toolbar-more-menu > summary").click();
  await expect(page.locator("#article-save-draft")).toBeVisible();
  await page.locator(".article-workspace-toolbar .toolbar-more-menu > summary").click();

  await page.locator("#article-source-summary").click();
  await expect(page.locator('[data-article-inspector-panel="info"]')).toBeVisible();
  await expect(page.locator("#article-source-details")).toHaveAttribute("open", "");
  await expect(page.locator('[data-article-inspector-tab="info"]')).toBeFocused();

  await page.locator('[data-article-inspector-tab="info"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-article-inspector-tab="cover"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-article-inspector-tab="cover"]')).toBeFocused();

  await page.locator('[data-article-inspector-tab="preview"]').click();
  await expect(page.locator('[data-article-inspector-panel="preview"]')).toBeVisible();
  await expect(page.locator('[data-article-inspector-panel="details"]')).toBeHidden();

  await page.locator('[data-article-inspector-tab="cover"]').click();
  await page.locator("#article-cover-image").fill("/images/example.webp");
  await expect(page.locator("#article-cover-alt-field")).toBeVisible();
  await expect(page.locator("#article-cover-tab-status")).toHaveText("已设置");
  await expect
    .poll(() => page.locator("#article-panel").evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
});

test("article publish stays actionable and returns quality problems to the editor", async ({ page }) => {
  await page.goto("/#article");
  await page.locator("#article-title").fill("测试发布");
  await page.locator("#article-body").fill("太短");
  await page.locator('#article-form [name="summary"]').fill("用于验证发布检查。");
  await page.locator('#article-form [name="tags"]').fill("生活");
  await page.locator("#article-source-summary").click();
  await page.locator('#article-form [name="source"]').fill("来源待确认");
  await page.locator('#article-form [name="sourceKind"]').selectOption("unknown");
  await page.locator(".internal-review-details summary").click();
  await page.locator('#article-form [name="internalNote"]').fill("公开前需要确认。");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#article-next-action").click();

  await expect(page.locator("#article-audit-guidance")).toBeVisible();
  await expect(page.locator("#article-audit-guidance")).toContainText("发布检查未通过");
  await expect(page.locator("#article-next-action")).toBeEnabled();
  await expect(page.locator("#article-next-action")).toHaveText("发布");
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

test("image editor keeps the media central and publishing fields in a desktop inspector", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#image");

  await expect(page.locator(".image-workspace-toolbar")).toBeVisible();
  await expect(page.locator(".image-editor-canvas")).toBeVisible();
  await expect(page.locator(".image-inspector")).toBeVisible();
  await expect(page.locator("#image-preview-stage")).toHaveAttribute("data-empty", "true");
  await expect(page.locator("#image-ai-review")).toBeHidden();
  await expect(page.locator('[data-ai-fill="image"]')).toBeDisabled();
  await expect(page.locator(".image-inspector-tabs [role=tab]")).toHaveCount(3);
  await expect(page.locator("#image-save-draft")).toBeHidden();
  await expect(page.locator("#image-real-preview")).toBeHidden();
  await expect(page.locator("#image-next-action")).toBeVisible();
  await expect(page.locator("#image-next-action")).toHaveText("发布");
  await expect(page.locator("#image-next-action")).toBeEnabled();
  await expect(page.locator('#image-form [name="publishMode"][value="draft"]')).toBeChecked();
  await expect(page.locator("#image-form-submit")).toBeHidden();
  await expect(page.locator("#image-form [data-quality]")).toHaveCount(0);
  await expect(page.locator("#image-form [name=commit], #image-form [name=push]")).toHaveCount(0);

  await page.locator('#image-form input[type="file"]').setInputFiles("../site/public/og.png");
  await expect(page.locator("#image-preview-stage")).toHaveAttribute("data-empty", "false");
  await expect(page.locator("#image-preview img")).toBeVisible();
  await expect(page.locator("#image-ratio-summary")).toContainText("根据图片尺寸生成");
  await expect(page.locator("#image-save-draft")).toBeEnabled();

  await page.locator('[data-image-inspector-tab="details"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-image-inspector-tab="source"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-image-inspector-panel="source"]')).toBeVisible();
  await expect
    .poll(() => page.locator("#image-panel").evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
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
          "内部复核备注尚未确认，不能进入发布流程。",
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
        internalNote: "从私人收藏导入，请公开前复核。",
        internalReviewStatus: "unresolved",
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
  await expect(guidance).toContainText("内部复核备注尚未确认");
  await expect(guidance).toContainText("AI 辅助");
  await expect(guidance).toContainText("整理与分段");
  await expect(guidance).toContainText("候选标题");
  await expect(guidance).toContainText("自动复核");

  await page.locator("#article-source-summary").click();
  await page.locator('[name="internalReviewConfirmed"]').check();
  await expect(guidance).not.toContainText("内部复核备注尚未确认");
  await expect(guidance).toContainText("超过 180 字的长段落");
});

test("sync publishing is a dedicated workspace and browser back restores the previous page", async ({ page }) => {
  let syncPayload = null;
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({
      response,
      json: {
        ...status,
        git: { ...status.git, canPush: true, pushError: "" },
        publicationCounts: { ...status.publicationCounts, local: 2 },
        syncQueue: {
          counts: { total: 2, ready: 1, attention: 1 },
          items: [{
            file: "site/src/content/articles/ready.md",
            type: "article",
            title: "可以同步的文章",
            pubDate: "2026-07-29",
          }],
          needsAttention: [{
            file: "site/src/content/articles/review.md",
            type: "article",
            title: "需要处理的文章",
            auditStatus: "review",
            reason: "正文含长段落。",
          }],
        },
      },
    });
  });
  await page.route("**/api/content/batch", async (route) => {
    syncPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        noChange: false,
        branch: "content-sync/automatic-pr",
        branches: ["content-sync/automatic-pr"],
        synced: [{ type: "article", file: "site/src/content/articles/ready.md" }],
        deleted: [],
        skipped: [],
        push: { attempted: true, ok: true, error: "" },
        pullRequest: {
          attempted: true,
          ok: true,
          created: true,
          number: 21,
          url: "https://github.com/npcink/site-xgif/pull/21",
        },
        pullRequests: [{
          attempted: true,
          ok: true,
          created: true,
          number: 21,
          url: "https://github.com/npcink/site-xgif/pull/21",
        }],
      }),
    });
  });
  await page.goto("/#library");
  await page.locator('[data-tab="sync"]').click();
  await expect(page).toHaveURL(/#sync$/);
  await expect(page.locator("#sync-panel")).toHaveClass(/active/);
  await expect(page.locator("#workspace-page-title")).toHaveText("同步上线");
  await expect(page.locator("#sync-all-local")).toHaveText("同步 1 条到 GitHub");
  await expect(page.locator("#sync-queue-list .sync-queue-item")).toHaveCount(1);
  await expect(page.locator("#sync-queue-list")).toContainText("可以同步的文章");
  await expect(page.locator("#sync-queue-list")).not.toContainText("需要处理的文章");
  await expect(page.locator("#sync-queue-summary")).toContainText("另有 1 条需要先处理");
  await expect(page.locator("#sync-open-attention")).toHaveText("查看待处理（1）");
  await expect(page.locator("#sync-history-list")).toBeVisible();
  await expect(page.locator("#sync-history-dialog")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#sync-all-local").click();
  await expect.poll(() => syncPayload).not.toBeNull();
  expect(syncPayload.action).toBe("sync");
  await expect(page.locator("#sync-workspace-result")).toContainText("已自动创建 GitHub PR #21");
  await expect(page.locator("#sync-workspace-result")).toContainText("PR 不会自动合并");
  await page.locator("#sync-open-attention").click();
  await expect(page).toHaveURL(/#audit$/);
  await page.goBack();
  await expect(page).toHaveURL(/#sync$/);
  await page.goBack();
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator("#library-panel")).toHaveClass(/active/);
  await page.unrouteAll({ behavior: "wait" });
});

test("a failed withdrawal remains actionable when it is the only sync queue item", async ({ page }) => {
  let requestedBatch = null;
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({
      response,
      json: {
        ...status,
        git: { ...status.git, canPush: true, pushError: "" },
        publicationCounts: { ...status.publicationCounts, local: 0 },
        syncQueue: {
          counts: {
            total: 1,
            ready: 1,
            attention: 0,
            deletions: 1,
            deletionReady: 0,
            deletionRetry: 1,
          },
          items: [{
            action: "delete",
            auditStatus: "retry",
            file: "site/src/content/articles/withdrawn.md",
            type: "article",
            title: "需要重试下架的文章",
            deletedAt: "2026-07-29T00:00:00.000Z",
          }],
          needsAttention: [],
        },
      },
    });
  });
  await page.route("**/api/content/batch", async (route) => {
    requestedBatch = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        noChange: false,
        branch: "content-sync/retry-withdrawal",
        branches: ["content-sync/retry-withdrawal"],
        synced: [],
        deleted: [{ file: "site/src/content/articles/withdrawn.md" }],
        skipped: [],
        push: { attempted: true, ok: true, error: "" },
      }),
    });
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/#sync");
  const retryButton = page.locator("#sync-all-local");
  await expect(retryButton).toBeEnabled();
  await expect(retryButton).toHaveText("重试 1 条下架");
  await expect(page.locator("#sync-queue-list")).toContainText("重试下架");
  await retryButton.click();
  await expect.poll(() => requestedBatch).not.toBeNull();
  expect(requestedBatch).toMatchObject({
    action: "sync",
    includePendingDeletions: true,
  });
  await page.unrouteAll({ behavior: "wait" });
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
  await expect(page.locator('[data-library-status="publishing"]')).toContainText("发布中");
  await expect(page.locator('[data-library-status="online"]')).toContainText("已上线");
  await expect(page.locator('[data-library-status="pending"]')).toHaveCount(0);
  await page.locator('[data-library-status="publishing"]').click();
  await expect(page.locator('[data-library-status="publishing"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#library-publishing-filter")).toBeVisible();
  await page.locator("#library-publishing-status").selectOption("pending");
  await expect(page.locator('[data-library-status="publishing"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-library-status="all"]').click();
  await expect(page.locator(".content-table")).toBeVisible();
  await page.locator("[data-content-open]").first().click();
  await expect(page.locator(".content-state-grid")).toBeVisible();
  await expect(page.locator(".content-state-grid > div")).toHaveCount(3);
});

test("pending publication work links to its content branches instead of the active development branch", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({
      response,
      json: {
        ...status,
        gitCompareUrl: "https://github.com/npcink/site-xgif/compare/main...codex%2Fdevelopment",
        publicationCounts: { ...status.publicationCounts, pending: 8 },
        syncQueue: { counts: { total: 0, ready: 0, attention: 0 }, items: [], needsAttention: [] },
        pendingPublicationBatches: [
          {
            branch: "content-sync/first",
            count: 3,
            label: "已推送 · 待建 PR",
            url: "https://github.com/npcink/site-xgif/compare/main...content-sync%2Ffirst?expand=1",
            linkLabel: "创建 PR",
          },
          {
            branch: "content-sync/second",
            count: 5,
            label: "PR 已创建",
            url: "https://github.com/npcink/site-xgif/pull/99",
            linkLabel: "打开 PR",
          },
          {
            branch: "content-sync/untrusted",
            count: 1,
            label: "远端返回异常",
            url: "javascript:alert(1)",
            linkLabel: "不可信入口",
          },
        ],
      },
    });
  });

  await page.goto("/#sync");
  await expect(page.locator("#sync-pending-batches .sync-pending-batch")).toHaveCount(3);
  await expect(page.locator("#sync-pending-batches")).toContainText("content-sync/first");
  await expect(page.locator("#sync-pending-batches")).toContainText("content-sync/second");
  await expect(page.locator("#sync-pending-batches a").first()).toHaveAttribute("href", /content-sync%2Ffirst/);
  await expect(page.locator("#sync-pending-batches a").last()).toHaveAttribute("href", /pull\/99/);
  await expect(page.locator("#sync-pending-batches a")).toHaveCount(2);
  await expect(page.locator("#sync-pending-batches")).toContainText("GitHub 入口暂不可用");
  await expect(page.locator("#sync-pr-link")).toBeHidden();
  await page.unrouteAll({ behavior: "wait" });
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
  await page.locator(".article-workspace-toolbar .toolbar-more-menu > summary").click();
  await page.locator("#article-version-history").click();
  await expect(page.locator("#version-history-dialog")).toBeVisible();
  await expect(page.locator("[data-browser-version]").first()).toBeVisible();
});
