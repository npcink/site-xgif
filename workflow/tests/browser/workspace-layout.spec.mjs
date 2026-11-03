import { expect, test } from "@playwright/test";

const file = "site/src/content/articles/layout-fixture.md";
async function mockContent(page, type = "image") {
  const item = {
    type, file, title: "用于验证布局的竖向图片", summary: "内容说明", tags: ["生活"],
    pubDate: "2026-11-03", source: "来源待确认",
    publication: { state: "local", label: "本地已保存" },
    workflow: { state: "pending_commit", label: "待同步", description: "本地版本尚未同步。" },
  };
  await page.route("**/api/content?*", (route) => route.fulfill({ json: {
    items: [item], counts: { all: 1, local: 1, publishing: 1, attention: 1 },
    pagination: { page: 1, pages: 1, total: 1, from: 1, to: 1 },
  } }));
  await page.route("**/api/content/read?*", (route) => route.fulfill({ json: {
    ...item, body: "测试正文。".repeat(40),
    previewUrl: "http://127.0.0.1:4321/layout-fixture",
    publicUrl: "http://127.0.0.1:4321/layout-fixture",
    contentSha256: "a".repeat(64),
    data: { ...item, draft: false, description: "完整图片应保持可见。", sourceKind: "unknown",
      recommendationGroup: "general", readTime: "1 分钟", image: "/layout-fixture.svg" },
  } }));
  await page.route("**/layout-fixture.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1800"><rect width="500" height="1800" fill="#bcd3c5"/><text x="60" y="100" font-size="40">TOP</text><text x="60" y="1750" font-size="40">BOTTOM</text></svg>',
  }));
  await page.route("**/api/content/deployment?*", (route) => route.fulfill({ json: { state: "local", label: "待同步", description: "测试状态" } }));
  await page.route("**/api/status**", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ json: { ...status, services: { ...status.services, sitePreview: { available: true, url: "http://127.0.0.1:4321" } } } });
  });
}

for (const width of [1280, 1600]) {
  test(`library detail keeps actions visible and portrait media intact at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mockContent(page);
    await page.goto("/#library");
    await expect(page.locator(".content-table")).toBeVisible();
    const table = await page.locator(".content-table").boundingBox();
    expect(table.y).toBeLessThan(420);
    await expect(page.locator("#library-task-description")).toBeHidden();
    await page.locator("#library-task-banner > summary").click();
    await expect(page.locator("#library-task-description")).toBeVisible();
    await page.locator("[data-content-open]").click();
    const actions = page.locator("#library-actions");
    await expect(actions).toBeInViewport();
    await expect(page.locator(".library-detail h2")).toBeInViewport();
    await expect(page.locator(".library-detail-media img")).toHaveCSS("object-fit", "contain");
    const media = await page.locator(".library-detail-media").boundingBox();
    expect(media.height).toBeLessThanOrEqual(240);
    const before = await actions.boundingBox();
    await page.locator("#library-detail").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const after = await actions.boundingBox();
    expect(after.y).toBeCloseTo(before.y, 0);
    await page.locator(".library-detail-more > summary").click();
    await expect(page.locator("#library-duplicate")).toBeInViewport();
    await page.locator(".library-detail-more > summary").click();
    await page.locator("#library-detail").evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`) });
    if (width === 1280) {
      await page.keyboard.press("Escape");
      await expect(page.locator("#library-inspector")).toBeHidden();
      await expect(page.locator("[data-content-open]")).toBeFocused();
    }
  });
}

test("article save exposes a preview and keeps repeated editing local", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockContent(page, "article");
  let saved = null;
  await page.route("**/api/quality/article", (route) => route.fulfill({ json: { ok: true, issues: [] } }));
  await page.route("**/api/content/update", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { file, previewUrl: "http://127.0.0.1:4321/layout-fixture", contentSha256: "b".repeat(64) } });
  });
  await page.goto("/#article");
  await expect(page.locator("#article-editor-state")).toHaveText("尚未保存到本地");
  await page.locator('[data-tab="library"]').click();
  await page.locator("[data-content-open]").click();
  await page.locator("#library-edit").click();
  await expect(page.locator("#article-editor-state")).toHaveText("本地已保存");
  await expect(page.locator("#article-next-action")).toBeHidden();
  await expect(page.locator("#article-real-preview")).toBeEnabled();
  const body = await page.locator("#article-body").boundingBox();
  expect(body.y).toBeLessThan(460);
  await page.locator("#article-title").fill("已修改的文章标题");
  await expect(page.locator("#article-next-action")).toHaveText("保存并预览");
  await expect(page.locator("#article-real-preview")).toBeHidden();
  await page.locator("#article-next-action").click();
  await expect.poll(() => saved).not.toBeNull();
  expect(saved.data.draft).toBe(false);
  await expect(page.locator("#article-editor-state")).toHaveText("本地已保存");
  await expect(page.locator("#article-next-action")).toBeHidden();
  await expect(page.locator("#article-real-preview")).toHaveText("查看效果");
  await expect(page.locator("#article-real-preview")).toBeEnabled();
  await expect(page.locator("#article-result")).toBeHidden();
  await page.locator("#article-title").fill("第二次本地修改");
  await expect(page.locator("#article-next-action")).toBeVisible();
  await expect(page).toHaveURL(/#article$/);
});

test("sync history shows three recent batches and discloses older and technical details", async ({ page }) => {
  await page.route("**/api/history?*", (route) => route.fulfill({ json: { items: Array.from({ length: 5 }, (_, i) => ({
    createdAt: `2026-11-0${5 - i}T10:00:00Z`,
    details: { count: i + 1, pushOk: true, branch: `content-sync/layout-${i}`, commitSha: String(i).repeat(40),
      pullRequestUrl: `https://github.com/npcink/site-xgif/pull/${100 + i}`, pullRequestNumber: 100 + i },
  })) } }));
  await page.goto("/#sync");
  await expect(page.locator(".sync-history-item:visible")).toHaveCount(3);
  await expect(page.locator(".sync-history-item code").first()).toBeHidden();
  await page.locator(".sync-history-technical > summary").first().click();
  await expect(page.locator(".sync-history-item code").first()).toHaveText("content-sync/layout-0");
  await expect(page.locator(".sync-history-item code").first()).toBeVisible();
  await page.locator(".sync-history-older > summary").click();
  await expect(page.locator(".sync-history-item:visible")).toHaveCount(5);
  await expect(page.locator(".sync-history-older a").last()).toHaveAttribute("href", "https://github.com/npcink/site-xgif/pull/104");
});

test("system status puts read failures first and refreshes without hiding network information", async ({ page }) => {
  let failing = true;
  await page.route("**/api/status**", async (route) => {
    if (failing) return route.fulfill({ status: 503, json: { error: "暂时不可用" } });
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ json: { ...status,
      ai: { available: false, configurationError: "配置错误 <b>请重试</b>" },
    } });
  });
  await page.goto("/#system");
  const attention = page.locator("#system-attention");
  await expect(attention).toContainText("暂时无法读取完整状态");
  failing = false;
  await page.locator("#refresh-services").click();
  await expect(attention).toContainText("文章 AI：配置错误 <b>请重试</b>");
  await expect(attention.locator("b")).toHaveCount(0);
  const issueBox = await attention.boundingBox();
  const connections = await page.locator(".connection-grid").boundingBox();
  expect(issueBox.y).toBeLessThan(connections.y);
  await expect(page.locator(".network-disclosure dl")).toBeHidden();
  await page.locator(".network-disclosure > summary").click();
  await expect(page.locator("#network-ai-detail")).toBeVisible();
  await expect(page.locator("#network-ai-detail")).toContainText("配置错误");
});
