import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { sampleImage } from "../fixtures/image-sample.mjs";

test("similar images are shown for comparison and require confirmation before publication", async ({ page }) => {
  const image = await sampleImage();
  const sha256 = createHash("sha256").update(image).digest("hex");
  const similarity = { checked: 11, unavailable: 0, matches: [
    { title: "已有图片", image: "/og.png", kind: "similar", animated: false },
  ] };
  let publication = null;
  await page.route("**/api/check/image", (route) => route.fulfill({ json: { duplicates: [], similarity } }));
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: "/images/memes/new.png", width: 320, height: 320 } }));
  await page.route("**/api/quality/image", (route) => route.fulfill({ json: {
    ok: true, perImage: [{ src: "/images/memes/new.png", sha256, similarity }], duplicates: [],
    issues: [{ level: "warning", message: "发现疑似相似图片，请比较下方候选后再决定是否继续。" }],
  } }));
  await page.route("**/api/publish/image", async (route) => {
    publication = route.request().postDataJSON();
    await route.fulfill({ status: 422, json: { error: "测试结束，不写入内容。" } });
  });
  await page.goto("/#image");
  await page.locator('#image-form input[type="file"]').setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
  await expect(page.locator("#image-duplicates-status")).toContainText("发现疑似相似图片");
  await expect(page.locator("#image-duplicate-candidates article")).toHaveCount(1);
  await expect(page.locator("#image-duplicate-candidates img")).toHaveAttribute("alt", "已有图片");
  await page.locator('#image-form [name="title"]').fill("新的候选图片");
  await page.locator('#image-form [name="description"]').fill("确认保留的不同版本");
  await page.locator('#image-form [name="tags"]').fill("生活");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-result")).toContainText("已取消发布");
  expect(publication).toBeNull();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#image-next-action").click();
  await expect(page.locator("#image-result")).toContainText("测试结束");
  expect(publication.similarityReviewedHashes).toEqual([sha256]);
  expect(publication.images).toEqual([{ src: "/images/memes/new.png", width: 320, height: 320 }]);
});
