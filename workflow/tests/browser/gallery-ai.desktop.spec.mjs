import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createHash } from "node:crypto";

const summary = { title: "AI 整理的图集", description: "用于聊天回复的猫咪图片。", tags: ["可爱"], category: "表情包", mood: ["开心"], scenes: ["回复"], warnings: [] };
async function files() {
  return Promise.all(["#123456", "#987654"].map(async (background, index) => ({ name: `auto-${index}.png`, mimeType: "image/png",
    buffer: await sharp({ create: { width: 200, height: 200, channels: 3, background } }).png().toBuffer() })));
}
async function setup(page, { hold = false, failSecond = false } = {}) {
  const state = { released: !hold, retriedHashes: [], creates: 0, job: null, model: "M4-fixture", modelVersion: "", summary, lastCreate: null };
  await page.route("**/api/ai/gallery-status", (route) => route.fulfill({ json: { available: true, model: state.model, modelVersion: state.modelVersion } }));
  await page.route("**/api/check/image", (route) => route.fulfill({ json: { duplicates: [], similarity: { checked: 0, unavailable: 0, matches: [] } } }));
  await page.route("**/api/assets/upload", (route) => route.fulfill({ json: { url: `/images/memes/${route.request().postDataJSON().fileName}`, width: 200, height: 200 } }));
  await page.route(/\/api\/ai\/gallery-jobs(?:\/.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/gallery-jobs") {
      state.creates++;
      const { images, force } = request.postDataJSON();
      state.lastCreate = request.postDataJSON();
      const id = createHash("sha256").update(JSON.stringify({ images: images.map((image) => image.src), model: state.model, modelVersion: state.modelVersion, run: force ? state.creates : 0 })).digest("hex");
      if (state.job?.id !== id) state.job = { id, model: state.model, modelVersion: state.modelVersion, revision: 0, items: images.map((image, i) => ({ src: image.src, sha256: String(i + 1).repeat(64) })) };
    }
    if (url.pathname.endsWith("/retry")) {
      state.retriedHashes = request.postDataJSON().hashes;
      failSecond = false;
    }
    const job = state.job;
    job.items = job.items.map((item, i) => ({ ...item,
      state: state.released ? failSecond && i === 1 ? "error" : "done" : "running",
      error: failSecond && i === 1 ? "M4 模拟断线" : "",
      result: { ...state.summary, altText: `第 ${i + 1} 张${state.model === "M4-fixture" ? "猫咪的画面" : "新模型画面"}`, warnings: [] },
    }));
    job.state = !state.released ? "running" : failSecond ? "attention" : "done";
    job.summary = state.released ? { ...state.summary, coverSrc: job.items.at(-1).src } : null;
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

test("processing progress is prominent above the image and identifies the active stage and model", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const state = await setup(page, { hold: true });
  await expect(page.locator("#image-ai-heading")).toContainText("正在识别第 1 / 2 张");
  await expect(page.locator("#image-ai-progress-bar")).toBeVisible();
  await expect(page.locator('[data-ai-step="recognize"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#image-ai-model")).toContainText("M4-fixture");
  const progress = await page.locator("#image-ai-progress").boundingBox();
  const image = await page.locator("#image-preview-stage").boundingBox();
  expect(progress.y + progress.height).toBeLessThanOrEqual(image.y);
  expect((await page.locator("#image-ai-progress-bar").boundingBox()).width).toBeGreaterThan(progress.width * 0.8);
  expect(await page.locator("#image-ai-heading").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);
  await expect(page.locator("#image-ai-reanalyze")).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("processing-progress.png") });
  state.released = true;
  await expect(page.locator('[data-ai-step="review"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#image-ai-progress-bar")).toHaveJSProperty("value", 3);
});

test("a stronger model starts a fresh run and suggestions survive reload without overwriting manual fields", async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  await page.locator('#image-form [name="title"]').fill("我的标题");
  await page.locator("#image-gallery-list textarea").first().fill("手工逐图描述");
  state.model = "M4-stronger"; state.modelVersion = "weights-2";
  state.summary = { ...summary, title: "更强模型标题", description: "更强模型的新描述" };
  await page.getByRole("button", { name: "重新识别", exact: true }).click();
  await expect(page.locator("#image-ai-candidates")).toBeVisible();
  expect(state.lastCreate.force).toBe(true);
  await expect(page.locator('#image-form [name="title"]')).toHaveValue("我的标题");
  await expect(page.locator('#image-form [name="description"]')).toHaveValue(summary.description);
  await expect(page.locator("#image-gallery-list textarea").first()).toHaveValue("手工逐图描述");
  await expect(page.locator("#image-ai-model")).toContainText("weights-2");
  const creates = state.creates;
  await page.reload();
  await expect(page.locator("#image-ai-candidates")).toBeVisible();
  expect(state.creates).toBe(creates);
  await page.getByRole("checkbox", { name: "采用新标题", exact: true }).check();
  await page.locator('#image-form [name="title"]').fill("我又改过的标题");
  await page.getByRole("button", { name: "采用所选建议", exact: true }).click();
  await expect(page.locator("#image-ai-apply-status")).toContainText("当前资料已修改");
  await expect(page.locator('#image-form [name="title"]')).toHaveValue("我又改过的标题");
  await page.getByRole("checkbox", { name: "采用新描述", exact: true }).check();
  await page.getByRole("checkbox", { name: "采用新第 2 张图片描述", exact: true }).check();
  await page.getByRole("button", { name: "采用所选建议", exact: true }).click();
  await expect(page.locator('#image-form [name="description"]')).toHaveValue("更强模型的新描述");
  await expect(page.locator('#image-form [name="title"]')).toHaveValue("我又改过的标题");
  await expect(page.locator("#image-gallery-list textarea").first()).toHaveValue("手工逐图描述");
  await expect(page.locator("#image-gallery-list textarea").last()).toHaveValue("第 2 张新模型画面");
  await expect(page.locator('#image-form [name="sourceKind"]')).toHaveValue("unknown");
});

test("retry after a model version change creates a comparison task instead of retrying the old model", async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  const previousId = state.job.id;
  state.modelVersion = "new-weights";
  state.summary = { ...summary, title: "新版本建议" };
  await page.locator('[data-ai-fill="image"]').click();
  await expect(page.locator("#image-ai-candidates")).toBeVisible();
  expect(state.job.id).not.toBe(previousId);
  expect(state.retriedHashes).toEqual([]);
  await expect(page.locator('#image-form [name="title"]')).toHaveValue(summary.title);
});

test("a lost progress response leaves retry available and resumes the existing task", async ({ page }) => {
  const state = await setup(page, { hold: true });
  await page.route("**/api/ai/gallery-jobs/*", async (route) => {
    if (route.request().method() === "GET" && !state.released) return route.fulfill({ status: 503, json: { error: "进度暂时不可读" } });
    await route.fallback();
  });
  await expect(page.locator("#image-ai-availability")).toContainText("暂时无法读取 M4 进度");
  await expect(page.locator('[data-ai-fill="image"]')).toBeEnabled();
  state.released = true;
  await page.locator('[data-ai-fill="image"]').click();
  await expect(page.locator("#image-ai-availability")).toContainText("已整理 2 / 2");
  expect(state.creates).toBe(1);
});
