import { expect, test } from "@playwright/test";
import sharp from "sharp";

async function imageFiles(count) {
  return Promise.all(Array.from({ length: count }, async (_, index) => ({
    name: `gallery-${index}.png`, mimeType: "image/png",
    buffer: await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: index * 17, g: 90, b: 250 - index * 17 } } }).png().toBuffer(),
  })));
}

async function mockChecks(page) {
  await page.route("**/api/check/image", (route) => route.fulfill({ json: { duplicates: [], similarity: { checked: 0, unavailable: 0, matches: [] } } }));
  await page.route("**/api/quality/image", (route) => route.fulfill({ json: { ok: true, issues: [], perImage: [], duplicates: [] } }));
  await page.route("**/api/image-reviews", (route) => route.fulfill({ json: { quality: { ok: true, issues: [], perImage: [], duplicates: [] }, review: { id: "fixture-review", warnings: [] } } }));
}

test("repeated local gallery saves update one item, offer its preview, and never sync from the editor", async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChecks(page);
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.services.sitePreview = { available: true, url: "http://127.0.0.1:4321/" };
    await route.fulfill({ json: status });
  });
  await page.route("**/api/ai/gallery-status", (route) => route.fulfill({ json: { available: false } }));
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: "/images/memes/published.png", width: 128, height: 128 } }));
  const previewUrl = "http://127.0.0.1:4321/20990101-link";
  const savedFile = "site/src/content/images/20990101-link.md";
  let creates = 0;
  const updates = [];
  const syncs = [];
  await page.route("**/api/publish/image", (route) => {
    creates += 1;
    return route.fulfill({ json: { ok: true, file: savedFile, previewUrl, contentSha256: "saved-version" } });
  });
  await page.route("**/api/content/update", (route) => {
    updates.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, file: savedFile, previewUrl, contentSha256: "updated-version" } });
  });
  await page.route("**/api/content/batch", (route) => {
    syncs.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: false } });
  });
  await context.route(previewUrl, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>发布后的图片页面</h1>" }));
  await page.goto("/#image");
  await page.locator('#image-form input[type="file"]').setInputFiles(await imageFiles(1));
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(1);
  await page.locator('#image-form [name="title"]').fill("发布后直接查看");
  await page.locator('#image-form [name="description"]').fill("保存后的实际站点页面");
  await page.locator('#image-form [name="tags"]').fill("生活");
  await page.locator("#image-next-action").click();
  await page.locator("#image-review-publish").click();
  const link = page.getByRole("link", { name: "查看效果", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", previewUrl);
  await expect(page.locator("#image-next-action")).toBeHidden();
  await expect(page.locator("#image-editor-state")).toHaveText("本地已保存");
  await expect(page.locator("#image-result")).toBeHidden();
  await expect(page.locator("#image-form").getByRole("button", { name: /上线|发布/ })).toHaveCount(0);
  const popupReady = context.waitForEvent("page");
  await link.click();
  const popup = await popupReady;
  await expect(popup).toHaveURL(previewUrl);
  await expect(popup.getByRole("heading")).toHaveText("发布后的图片页面");
  await popup.close();
  await page.locator('#image-form [name="title"]').fill("尚未保存的修改");
  await expect(link).toBeHidden();
  await expect(page.locator("#image-real-preview")).not.toHaveAttribute("href", previewUrl);
  await expect(page.locator("#image-editor-state")).toHaveText("有未保存修改 · 已在浏览器临时暂存");
  await expect(page.locator("#image-next-action")).toHaveText("保存并预览");
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-review-publish")).toHaveText("保存到本地");
  await page.locator("#image-review-publish").click();
  await expect(page.locator("#image-editor-state")).toHaveText("本地已保存");
  await expect(page.locator("#image-next-action")).toBeHidden();
  await expect(link).toHaveAttribute("href", previewUrl);
  expect(creates).toBe(1);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ type: "image", file: savedFile, expectedContentSha256: "saved-version", data: { title: "尚未保存的修改" } });
  expect(syncs).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("gallery-local-saved.png") });
});

test("R2 images load after restoring a draft and in publication review without a localhost referrer", async ({ page }) => {
  const files = await imageFiles(2);
  const sources = ["https://img.xgif.cn/fixtures/preview.png", "https://img.xgif.cn/fixtures/similar.png"];
  const referrers = [];
  await page.route("https://img.xgif.cn/fixtures/*", (route) => {
    const referrer = route.request().headers().referer || "";
    referrers.push(referrer);
    return route.fulfill({ status: referrer ? 403 : 200, contentType: "image/png", body: files[0].buffer });
  });
  await page.route("**/api/ai/gallery-status", (route) => route.fulfill({ json: { available: false } }));
  await page.route("**/api/check/image", (route) => route.fulfill({ json: { duplicates: [], similarity: { checked: 0, unavailable: 0, matches: [] } } }));
  await page.route("**/api/image-reviews", (route) => route.fulfill({ json: {
    quality: { ok: true, issues: [], perImage: [{ src: sources[0], similarity: { matches: [{ image: sources[1], title: "相似图片" }] } }] },
    review: { id: "fixture-review", warnings: ["请对照相似图片"] },
  } }));
  await page.addInitScript((src) => {
    localStorage.setItem("xgif-publisher-draft:image-form:new", JSON.stringify({ savedAt: Date.now(), data: {
      title: "恢复后的 R2 图片", description: "实际显示远端图片", tags: "生活", sourceKind: "unknown",
      images: [{ src, width: 128, height: 128, altText: "待确认图片" }],
    } }));
  }, sources[0]);
  await page.goto("/#image");
  await page.reload();
  const loaded = (image) => image.complete && image.naturalWidth > 0;
  await expect.poll(() => page.locator("#image-gallery-list img").evaluate(loaded)).toBe(true);
  await expect.poll(() => page.locator("#image-preview img").evaluate(loaded)).toBe(true);
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-publication-review")).toBeVisible();
  await expect.poll(() => page.locator("#image-review-images img").evaluate(loaded)).toBe(true);
  await expect(page.locator("#image-review-warning-list img")).toHaveCount(2);
  await expect.poll(() => page.locator("#image-review-warning-list img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  expect(referrers.length).toBeGreaterThan(0);
  expect(referrers.every((value) => value === "")).toBe(true);
  await page.locator("#image-review-edit").click();
});

test("gallery appends up to twelve images, supports keyboard sorting and cover, and restores its order", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChecks(page);
  await page.route("**/api/assets/upload", (route) => {
    const { fileName } = route.request().postDataJSON();
    return route.fulfill({ json: { url: `/images/memes/${fileName}`, width: 128, height: 128 } });
  });
  await page.goto("/#image");
  await expect(page.locator('#image-form [name="confirmedAt"]')).toHaveValue("");
  await page.locator("#image-tab-source").click();
  await page.locator('#image-form [name="sourceKind"]').selectOption("user_provided");
  await expect(page.locator('#image-form [name="confirmedAt"]')).toHaveValue("");
  await page.locator('#image-form [name="sourceKind"]').selectOption("unknown");
  const files = await imageFiles(13);
  const input = page.locator('#image-form input[type="file"]');
  await input.setInputFiles(files.slice(0, 13));
  await expect(page.locator("#image-gallery-feedback")).toContainText("最多 12 张");
  await expect(page.locator("#image-gallery-list li")).toHaveCount(0);
  await input.setInputFiles(files.slice(0, 2));
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(2);
  await page.locator("#image-gallery-list li strong").first().dragTo(page.locator("#image-gallery-list li").nth(1));
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("gallery-1.png");
  await page.locator("#image-gallery-list li").first().getByRole("button", { name: /预览/ }).click();
  await page.locator("#image-gallery-current").getByRole("button", { name: "后移" }).click();
  await input.setInputFiles(files.slice(2, 12));
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(12);
  await expect(input).toBeDisabled();
  await page.locator("#image-gallery-list li").nth(1).getByRole("button", { name: /预览/ }).click();
  await page.locator("#image-gallery-current").getByRole("button", { name: "设为封面" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("gallery-1.png");
  await expect(page.locator("#image-gallery-list li").first().getByRole("button", { name: /预览/ })).toBeFocused();
  await page.locator("#image-gallery-current").getByRole("button", { name: "后移" }).click();
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("gallery-0.png");
  await page.locator("#image-gallery-list li").last().getByRole("button", { name: /预览/ }).click();
  await page.locator("#image-gallery-current").getByRole("button", { name: "移除" }).click();
  await expect(input).toBeEnabled();
  await expect(page.locator("#image-gallery-status")).toContainText("11 / 12");
  await page.reload();
  await expect(page.locator("#image-gallery-list li")).toHaveCount(11);
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("图片 1");
  await expect(page.locator("#image-preview img")).toHaveAttribute("src", "/images/memes/gallery-0.png");
  await expect.poll(() => page.locator("#image-panel").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  let submitted;
  await page.route("**/api/publish/image", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 422, json: { error: "已验证图集请求" } });
  });
  await page.locator('#image-form [name="title"]').fill("十二张以内的图集");
  await page.locator('#image-form [name="description"]').fill("共用标题和描述");
  await page.locator('#image-form [name="tags"]').fill("生活");
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-publication-review")).toBeVisible();
  await page.locator("#image-review-publish").click();
  await expect(page.locator("#image-result")).toContainText("已验证图集请求");
  expect(submitted.images).toHaveLength(11);
  expect(submitted.images[0].src).toBe("/images/memes/gallery-0.png");
});

test("a failed image can retry independently and incomplete galleries cannot publish", async ({ page }) => {
  await mockChecks(page);
  let attempts = 0;
  await page.route("**/api/assets/upload", (route) => {
    attempts += 1;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: "模拟上传失败" } }
      : { json: { url: "/images/memes/retry.png", width: 128, height: 128 } });
  });
  await page.goto("/#image");
  const files = await imageFiles(1);
  await page.locator('#image-form input[type="file"]').setInputFiles(files);
  await expect(page.locator("#image-gallery-list")).toContainText("模拟上传失败");
  await page.locator('#image-form [name="title"]').fill("失败重试");
  await page.locator('#image-form [name="description"]').fill("保留已选图片");
  await page.locator('#image-form [name="tags"]').fill("生活");
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-result")).toContainText("等待全部上传成功");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("#image-gallery-list li small:not(.gallery-ai-item-state)")).toHaveText("已上传");
  expect(attempts).toBe(2);
  await page.locator('#image-form input[type="file"]').setInputFiles(files);
  await expect(page.locator("#image-gallery-feedback")).toContainText("已选过相同图片");
  await expect(page.locator("#image-gallery-list li")).toHaveCount(1);
});

test("reload resumes a failed middle upload in order and recovers its completed upload reference", async ({ page }) => {
  await mockChecks(page);
  const attempts = new Map();
  let disconnected = true;
  await page.route("**/api/assets/upload", (route) => {
    const { fileName } = route.request().postDataJSON();
    attempts.set(fileName, (attempts.get(fileName) || 0) + 1);
    return route.fulfill(disconnected && fileName === "gallery-1.png"
      ? { status: 503, json: { error: "网络中断" } }
      : { json: { url: `/images/memes/${fileName}`, width: 128, height: 128 } });
  });
  await page.goto("/#image");
  await page.locator('#image-form input[type="file"]').setInputFiles(await imageFiles(3));
  await expect(page.locator("#image-gallery-list")).toContainText("网络中断");
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(2);
  await page.locator("#image-gallery-list li").nth(1).getByRole("button", { name: /预览/ }).click();
  await page.locator("#image-gallery-current textarea").fill("我的中间图片描述");
  // Simulate closing after the upload reference is committed to IndexedDB but
  // before the newer LocalStorage snapshot is written.
  const pendingDraft = await page.evaluate(() => localStorage.getItem("xgif-publisher-draft:image-form:new"));
  disconnected = false;
  await page.reload();
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(3);
  expect(await page.locator("#image-gallery-list li img").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")))).toEqual([
    "/images/memes/gallery-0.png", expect.stringMatching(/^(?:data:image|\/images\/memes\/gallery-1)/u), "/images/memes/gallery-2.png",
  ]);
  await page.locator("#image-gallery-list li").nth(1).getByRole("button", { name: /预览/ }).click();
  await expect(page.locator("#image-gallery-current textarea")).toHaveValue("我的中间图片描述");
  expect([...attempts.values()]).toEqual([1, 2, 1]);
  await page.evaluate((draft) => localStorage.setItem("xgif-publisher-draft:image-form:new", draft), pendingDraft);
  await page.reload();
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(3);
  await expect(page.locator("#image-gallery-list li img").nth(1)).toHaveAttribute("src", "/images/memes/gallery-1.png");
  expect([...attempts.values()]).toEqual([1, 2, 1]);
});

test("unavailable browser file storage explicitly warns while allowing uploads", async ({ page }) => {
  await mockChecks(page);
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error("模拟空间不足"); }; });
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: "/images/memes/no-storage.png", width: 128, height: 128 } }));
  await page.goto("/#image");
  await page.locator('#image-form input[type="file"]').setInputFiles(await imageFiles(1));
  await expect(page.locator("#image-gallery-feedback")).toContainText("浏览器无法暂存，请在关闭页面前完成上传");
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(1);
});

test("twelve portraits stay in a horizontal strip with one current editor and a full-image dialog", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChecks(page);
  const portrait = await sharp({ create: { width: 400, height: 1600, channels: 3, background: "#547973" } }).png().toBuffer();
  await page.route("**/images/memes/compact-*.png", (route) => route.fulfill({ contentType: "image/png", body: portrait }));
  await page.route("**/api/ai/gallery-status", (route) => route.fulfill({ json: { available: false } }));
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: `/images/memes/${route.request().postDataJSON().fileName}`, width: 400, height: 1600 } }));
  await page.goto("/#image");
  const files = await imageFiles(12);
  await page.locator('#image-form input[type="file"]').setInputFiles(files.map((file, index) => ({ ...file, name: `compact-${index}.png`, buffer: index === 0 ? portrait : file.buffer })));
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(12);
  const strip = page.locator("#image-gallery-list");
  const current = page.locator("#image-gallery-current");
  await expect(current.locator("textarea")).toHaveCount(1);
  await current.locator("textarea").fill("第一张的人工描述");
  await strip.getByRole("button", { name: "预览第 12 张", exact: true }).click();
  await expect(current.locator("strong")).toHaveText("第 12 张");
  await expect(current.locator("textarea")).toHaveValue("");
  await current.locator("textarea").fill("最后一张的人工描述");
  await strip.getByRole("button", { name: "预览第 1 张，封面", exact: true }).click();
  await expect(current.locator("textarea")).toHaveValue("第一张的人工描述");
  await page.reload();
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(12);
  await expect(current.locator("textarea")).toHaveValue("第一张的人工描述");
  await strip.getByRole("button", { name: "预览第 12 张", exact: true }).click();
  await expect(current.locator("textarea")).toHaveValue("最后一张的人工描述");
  await strip.getByRole("button", { name: "预览第 1 张，封面", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const stage = await page.locator("#image-preview-stage").boundingBox();
    const image = await page.locator("#image-preview img").boundingBox();
    const toolbar = await page.locator(".image-workspace-toolbar").boundingBox();
    const inspector = await page.locator(".image-inspector").boundingBox();
    const canvas = await page.locator(".image-editor-canvas").boundingBox();
    expect(image.y).toBeGreaterThanOrEqual(stage.y);
    expect(image.y + image.height).toBeLessThanOrEqual(stage.y + stage.height);
    expect(stage.y + stage.height).toBeLessThan(800);
    expect(toolbar.y + toolbar.height).toBeLessThan(stage.y);
    expect(inspector.height).toBeLessThan(canvas.height);
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(800);
    expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect((await strip.boundingBox()).height).toBeLessThan(150);
    expect(await page.locator("#image-panel").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`compact-gallery-${width}.png`) });
  }
  await page.getByRole("button", { name: "放大查看当前图片" }).click();
  await expect(page.getByRole("dialog", { name: "查看原图" })).toBeVisible();
  await expect(page.locator("#image-original-preview img")).toHaveAttribute("src", /compact-0.png$/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#image-original-preview")).toBeHidden();
  await expect(page.getByRole("button", { name: "放大查看当前图片" })).toBeFocused();
});
