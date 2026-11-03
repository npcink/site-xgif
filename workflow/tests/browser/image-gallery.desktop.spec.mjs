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
}

test("gallery appends up to twelve images, supports keyboard sorting and cover, and restores its order", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChecks(page);
  await page.route("**/api/assets/upload", (route) => {
    const { fileName } = route.request().postDataJSON();
    return route.fulfill({ json: { url: `/images/memes/${fileName}`, width: 128, height: 128 } });
  });
  await page.goto("/#image");
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
  await expect(page.locator("#image-gallery-list li small")).toHaveText("已上传");
  expect(attempts).toBe(2);
  await page.locator('#image-form input[type="file"]').setInputFiles(files);
  await expect(page.locator("#image-gallery-feedback")).toContainText("已选过相同图片");
  await expect(page.locator("#image-gallery-list li")).toHaveCount(1);
});
