import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { GalleryAiJobs, galleryAiConfig, galleryFrames, galleryReviewDigest, requestGalleryAi, sanitizeGallerySuggestion } from "../gallery-ai.js";
import { GalleryReviews } from "../gallery-reviews.js";

const suggestion = { title: "猫咪反应", description: "一只猫看着镜头，适合表达惊讶。", altText: "看向镜头的猫咪", tags: ["可爱"], mood: ["惊讶"], scenes: ["回复"], warnings: [], coverIndex: 0 };
const config = { available: true, model: "fixture-vision", baseUrl: "http://127.0.0.1:11436/v1", timeoutMs: 1000 };
async function fixture(t, request) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xgif-gallery-ai-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const buffer = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  const readAsset = async (src) => ({ buffer, sha256: createHash("sha256").update(buffer).update(src).digest("hex") });
  const jobs = new GalleryAiJobs({ directory, config, readAsset, request });
  await jobs.ready;
  return { jobs, directory, readAsset };
}
async function finished(jobs, id) {
  for (let i = 0; i < 300; i++) {
    const job = await jobs.get(id);
    if (["done", "attention"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("任务没有结束");
}

test("gallery AI requires an explicit loopback endpoint and never falls back to the article provider", () => {
  assert.equal(galleryAiConfig({ XGIF_AI_MODEL: "remote", XGIF_AI_BASE_URL: "https://example.com/v1" }).available, false);
  assert.equal(galleryAiConfig({ XGIF_IMAGE_AI_MODEL: "vision", XGIF_IMAGE_AI_BASE_URL: "http://127.0.0.1:11436/v1" }).available, true);
  for (const baseUrl of ["https://example.com/v1", "http://192.168.1.1/v1", "http://user:pass@localhost/v1", "http://localhost/v1?key=x"]) {
    assert.equal(galleryAiConfig({ XGIF_IMAGE_AI_MODEL: "vision", XGIF_IMAGE_AI_BASE_URL: baseUrl }).available, false);
  }
});

test("AI fields are bounded, source claims are discarded and uncertain results always request review", () => {
  const result = sanitizeGallerySuggestion({ ...suggestion, sourceUrl: "https://fake", author: "fake", license: "fake", uncertain: true, tags: ["not-a-tag", "可爱"], altText: "猫".repeat(500) });
  assert.equal(result.sourceUrl, undefined);
  assert.equal(result.author, undefined);
  assert.equal(result.license, undefined);
  assert.equal(result.altText.length, 240);
  assert.deepEqual(result.tags, ["可爱"]);
  assert.equal(result.warnings.length, 1);
  assert.throws(() => sanitizeGallerySuggestion({ ...suggestion, description: [] }), /为空/);
});

test("request turns off thinking, refuses redirects and reports malformed model output without leaking it", async () => {
  let options;
  const raw = await requestGalleryAi(config, [], async (url, init) => {
    options = init;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }) };
  });
  assert.equal(raw.title, suggestion.title);
  assert.equal(options.redirect, "error");
  assert.equal(JSON.parse(options.body).reasoning_effort, "none");
  await assert.rejects(requestGalleryAi(config, [], async () => { throw new Error("SECRET"); }), /M4 连接/);
  await assert.rejects(requestGalleryAi(config, [], async () => ({ ok: true, json: async () => { throw new DOMException("SECRET", "AbortError"); } })), { code: "M4_UNAVAILABLE" });
  await assert.rejects(requestGalleryAi(config, [], async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "SECRET" } }] }) })), /格式不完整/);
});

test("twelve images run serially; one failure is isolated and retry does not repeat successful recognition", async (t) => {
  let running = 0, peak = 0, calls = 0, failOnce = true;
  const { jobs } = await fixture(t, async (_config, messages) => {
    running++; peak = Math.max(peak, running); calls++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    running--;
    if (calls === 3 && failOnce) { failOnce = false; throw Object.assign(new Error("模拟断线"), { statusCode: 503 }); }
    return suggestion;
  });
  const images = Array.from({ length: 12 }, (_, i) => ({ src: `/images/${i}.png` }));
  const created = await jobs.create(images);
  const job = await finished(jobs, created.id);
  assert.equal(job.items.filter((item) => item.state === "done").length, 11);
  assert.equal(peak, 1);
  assert.equal(calls, 13, "twelve recognition calls plus summary");
  const failedHash = job.items.find((item) => item.state === "error").sha256;
  await jobs.retry(job.id, [failedHash]);
  const retried = await finished(jobs, job.id);
  assert.equal(retried.state, "done");
  assert.equal(calls, 15, "only failed image and summary retried");
  const reordered = await jobs.create([...images].reverse());
  await finished(jobs, reordered.id);
  assert.equal(calls, 16, "reordered images only need a new summary");
  await assert.rejects(jobs.create([...images, { src: "/images/13.png" }]), /1 至 12/);
  await assert.rejects(jobs.inspect(job.id, [...images].reverse()), /顺序已变化/);
});

test("a restarted process keeps completed recognition and resumes only interrupted images", async (t) => {
  const { jobs, directory, readAsset } = await fixture(t, async () => suggestion);
  const created = await jobs.create([{ src: "/images/one.png" }, { src: "/images/two.png" }]);
  const job = await finished(jobs, created.id);
  await jobs.work.tail;
  job.items[1].state = "running"; delete job.items[1].result;
  job.state = "running"; job.summary = null;
  await writeFile(path.join(directory, `${job.id}.json`), JSON.stringify(job));
  let calls = 0;
  const restarted = new GalleryAiJobs({ directory, config, readAsset, request: async () => { calls++; return suggestion; } });
  assert.equal((await restarted.get(job.id)).state, "paused");
  await restarted.create(job.items.map(({ src }) => ({ src })));
  assert.equal((await finished(restarted, job.id)).state, "done");
  assert.equal(calls, 2);
  restarted.readAsset = async () => ({ sha256: "changed" });
  await assert.rejects(restarted.inspect(job.id, job.items.map(({ src }) => ({ src }))), /图片已改变/);
});

test("a service outage pauses remaining work instead of timing out twelve separate requests", async (t) => {
  let calls = 0;
  const { jobs } = await fixture(t, async () => {
    calls++;
    throw Object.assign(new Error("M4 已断线"), { statusCode: 503, code: "M4_UNAVAILABLE" });
  });
  const created = await jobs.create([{ src: "/images/one.png" }, { src: "/images/two.png" }]);
  await jobs.work.tail;
  const job = await jobs.get(created.id);
  assert.equal(job.state, "paused");
  assert.equal(job.items[0].state, "error");
  assert.equal(job.items[1].state, "pending");
  assert.equal(calls, 1);
  jobs.request = async () => { calls++; return suggestion; };
  await jobs.create([{ src: "/images/one.png" }, { src: "/images/two.png" }]);
  assert.equal((await finished(jobs, job.id)).state, "done");
  assert.equal(calls, 4);
});

test("animated GIF sampling includes first, middle and last frames", async () => {
  const pixels = Buffer.concat([Buffer.alloc(8 * 8 * 3, 0), Buffer.alloc(8 * 8 * 3, 120), Buffer.alloc(8 * 8 * 3, 240)]);
  const gif = await sharp(pixels, { raw: { width: 8, height: 24, channels: 3, pageHeight: 8 } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
  const frames = await galleryFrames(gif);
  assert.equal(frames.pages, 3);
  assert.deepEqual(frames.indices, [0, 1, 2]);
  assert.equal(new Set(frames.images).size, 3);
});

test("review receipts bind metadata, image order, edit version and AI revision; repeat returns the saved result", async (t) => {
  const { directory } = await fixture(t, async () => suggestion);
  const store = new GalleryReviews(path.join(directory, "reviews"));
  const data = { title: "原始标题", images: [{ src: "/images/one.png" }], galleryAiJobId: "job" };
  const job = { id: "job", revision: 3 };
  const receipt = await store.create(data, { job, warnings: ["请检查文字"] });
  const payload = { ...data, galleryReviewId: receipt.id, galleryWarningsConfirmed: true };
  await assert.rejects(store.authorize({ ...payload, galleryWarningsConfirmed: false }, { job }), /待检查/);
  await assert.rejects(store.authorize({ ...payload, title: "新标题" }, { job }), /资料或编辑版本/);
  await assert.rejects(store.authorize({ ...payload, ratio: "wide" }, { job }), /资料或编辑版本/);
  await assert.rejects(store.authorize({ ...payload, contentId: "changed-id" }, { job }), /资料或编辑版本/);
  await assert.rejects(store.authorize(payload, { job: { ...job, revision: 4 } }), /结果已更新/);
  assert.equal((await store.authorize(payload, { job })).id, receipt.id);
  assert.notEqual(galleryReviewDigest(data), galleryReviewDigest({ ...data, images: [{ src: "/images/one.png", altText: "新描述" }] }));
  await store.complete(receipt, { ok: true, file: "saved.md" });
  assert.equal((await store.authorize(payload, { job: { ...job, revision: 4 } })).result.file, "saved.md");
});
