import { expect, test } from "@playwright/test";
import sharp from "sharp";

const summary = { title: "AI 整理的图集", description: "用于聊天回复的猫咪图片。", tags: ["可爱"], category: "表情包", mood: ["开心"], scenes: ["回复"], warnings: [] };
async function files() {
  return Promise.all(["#123456", "#987654"].map(async (background, index) => ({ name: `auto-${index}.png`, mimeType: "image/png",
    buffer: await sharp({ create: { width: 200, height: 200, channels: 3, background } }).png().toBuffer() })));
}
async function setup(page, { hold = false, failSecond = false } = {}) {
  const state = { released: !hold, retriedHashes: [], creates: 0, job: null };
  await page.route("**/api/ai/gallery-status", (route) => route.fulfill({ json: { available: true, model: "M4-fixture" } }));
  await page.route("**/api/check/image", (route) => route.fulfill({ json: { duplicates: [], similarity: { checked: 0, unavailable: 0, matches: [] } } }));
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: `/images/memes/${route.request().postDataJSON().fileName}`, width: 200, height: 200 } }));
  await page.route(/\/api\/ai\/gallery-jobs(?:\/.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/gallery-jobs") {
      state.creates++;
      const { images } = request.postDataJSON();
      const id = String(images.length).repeat(64);
      if (state.job?.id !== id) state.job = { id, revision: 0, items: images.map((image, i) => ({ src: image.src, sha256: String(i + 1).repeat(64) })) };
    }
    if (url.pathname.endsWith("/retry")) {
      state.retriedHashes = request.postDataJSON().hashes;
      failSecond = false;
    }
    const job = state.job;
    job.items = job.items.map((item, i) => ({ ...item,
      state: state.released ? failSecond && i === 1 ? "error" : "done" : "running",
      error: failSecond && i === 1 ? "M4 模拟断线" : "",
      result: { ...summary, altText: `第 ${i + 1} 张猫咪的画面`, warnings: [] },
    }));
    job.state = !state.released ? "running" : failSecond ? "attention" : "done";
    job.summary = state.released ? { ...summary, coverSrc: job.items.at(-1).src } : null;
    await route.fulfill({ json: { job } });
  });
  await page.goto("/#image");
  await page.locator('#image-form input[type="file"]').setInputFiles(await files());
  return state;
}

test("upload automatically starts M4, preserves edits made during processing and restores completed results", async ({ page }) => {
  const state = await setup(page, { hold: true });
  await expect(page.locator("#image-ai-availability")).toContainText("后台整理中");
  await page.locator('#image-form [name="title"]').fill("我手动改的标题");
  state.released = true;
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  await expect(page.locator('#image-form [name="title"]')).toHaveValue("我手动改的标题");
  await expect(page.locator('#image-form [name="description"]')).toHaveValue(summary.description);
  await expect(page.locator('#image-form [name="sourceKind"]')).toHaveValue("unknown");
  await expect(page.locator("#image-gallery-list textarea").first()).toHaveValue("第 1 张猫咪的画面");
  await expect(page.locator("#image-ai-cover")).toBeVisible();
  expect(state.creates).toBe(1);
  await page.locator("#image-gallery-list textarea").first().fill("我改过的逐图描述");
  await page.locator("#image-gallery-list textarea").last().fill("");
  await page.locator('#image-form [name="description"]').fill("");
  await page.reload();
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  await expect(page.locator('#image-form [name="title"]')).toHaveValue("我手动改的标题");
  await expect(page.locator("#image-gallery-list textarea").first()).toHaveValue("我改过的逐图描述");
  await expect(page.locator("#image-gallery-list textarea").last()).toHaveValue("");
  await expect(page.locator('#image-form [name="description"]')).toHaveValue("");
  await page.locator("#image-ai-cover").click();
  await expect(page.locator("#image-gallery-list li").first().locator("img")).toHaveAttribute("src", "/images/memes/auto-1.png");
});

test("a failed image is visible next to successful results and can retry by its own fingerprint", async ({ page }) => {
  const state = await setup(page, { failSecond: true });
  await expect(page.locator("#image-ai-availability")).toContainText("部分项目需要检查");
  await expect(page.locator("#image-ai-issues")).toContainText("第 2 张：M4 模拟断线");
  await expect(page.locator("#image-gallery-list textarea").first()).toHaveValue("第 1 张猫咪的画面");
  await page.getByRole("button", { name: "重试此图" }).click();
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  expect(state.retriedHashes).toEqual(["2".repeat(64)]);
  await expect(page.locator('#image-form [name="description"]')).toHaveValue(summary.description);
});

test("changing membership during recognition discards the old task's summary", async ({ page }) => {
  const state = await setup(page, { hold: true });
  await expect(page.locator("#image-ai-availability")).toContainText("后台整理中");
  await page.locator("#image-gallery-list li").last().getByRole("button", { name: "移除", exact: true }).click();
  state.released = true;
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 1 / 1");
  await expect(page.locator("#image-gallery-list li")).toHaveCount(1);
  expect(state.job.items).toHaveLength(1);
  await expect(page.locator('#image-form [name="description"]')).toHaveValue(summary.description);
});
