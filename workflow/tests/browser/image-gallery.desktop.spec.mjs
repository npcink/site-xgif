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
  await page.locator("#image-gallery-list li").first().getByRole("button", { name: "后移" }).click();
  await input.setInputFiles(files.slice(2, 12));
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(12);
  await expect(input).toBeDisabled();
  await page.locator('#image-gallery-list li').nth(1).getByRole("button", { name: "设为封面" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("gallery-1.png");
  await expect(page.locator("#image-gallery-list li").first().getByRole("button", { name: /预览/ })).toBeFocused();
  await page.locator('#image-gallery-list li').first().getByRole("button", { name: "后移" }).click();
  await expect(page.locator("#image-gallery-list li strong").first()).toContainText("gallery-0.png");
  await page.locator('#image-gallery-list li').last().getByRole("button", { name: "移除" }).click();
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
  await page.locator("#image-gallery-list textarea").nth(1).fill("我的中间图片描述");
  // Simulate closing after the upload reference is committed to IndexedDB but
  // before the newer LocalStorage snapshot is written.
  const pendingDraft = await page.evaluate(() => localStorage.getItem("xgif-publisher-draft:image-form:new"));
  disconnected = false;
  await page.reload();
  await expect(page.locator("#image-gallery-list li small").filter({ hasText: "已上传" })).toHaveCount(3);
  expect(await page.locator("#image-gallery-list li img").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")))).toEqual([
    "/images/memes/gallery-0.png", expect.stringMatching(/^(?:data:image|\/images\/memes\/gallery-1)/u), "/images/memes/gallery-2.png",
  ]);
  await expect(page.locator("#image-gallery-list textarea").nth(1)).toHaveValue("我的中间图片描述");
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
