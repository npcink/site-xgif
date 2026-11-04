import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { GalleryAiJobs, galleryAiConfig, galleryFrames, galleryReviewDigest, requestGalleryAi, sanitizeGallerySuggestion } from "../gallery-ai.js";
import { GalleryReviews } from "../gallery-reviews.js";

const suggestion = { title: "猫咪反应", description: "一只猫看着镜头，适合表达惊讶。", altText: "看向镜头的猫咪", tags: ["可爱"], mood: ["惊讶"], scenes: ["回复"], warnings: [], coverIndex: 0 };
const config = { available: true, model: "fixture-vision", baseUrl: "http://127.0.0.1:11436/v1", timeoutMs: 1000 };
async function fixture(t, request, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xgif-gallery-ai-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const buffer = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  const readAsset = async (src) => ({ buffer, sha256: createHash("sha256").update(buffer).update(src).digest("hex") });
  const jobs = new GalleryAiJobs({ directory, config, readAsset, request, sleep: async () => {}, ...options });
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

test("summary failure preserves all twelve image results and retry only requests one new summary", async (t) => {
  let calls = 0;
  const { jobs } = await fixture(t, async () => {
    calls++;
    if (calls === 13) throw Object.assign(new Error("M4 请求失败（500）"), { statusCode: 502 });
    return suggestion;
  });
  const images = Array.from({ length: 12 }, (_, i) => ({ src: `/images/summary-${i}.png` }));
  const failed = await finished(jobs, (await jobs.create(images)).id);
  assert.equal(failed.state, "attention");
  assert.equal(failed.summary, null);
  assert.match(failed.error, /图集资料汇总失败.*500/u);
  assert.equal(failed.items.filter((item) => item.state === "done").length, 12);
  const results = failed.items.map((item) => item.result);
  await jobs.retry(failed.id);
  const retried = await finished(jobs, failed.id);
  assert.equal(retried.state, "done");
  assert.equal(retried.error, "");
  assert.equal(calls, 14, "twelve image requests, failed summary and one summary retry");
  assert.deepEqual(retried.items.map((item) => item.result), results);
});

test("a transient summary 500 retries once, persists safe diagnostics and preserves twelve completed results", async (t) => {
  let calls = 0;
  const ids = [];
  const { jobs, directory } = await fixture(t, (settings, messages, _fetch, options) => requestGalleryAi(settings, messages, async (_url, init) => {
    calls++; ids.push(init.headers["x-request-id"]);
    return calls === 13
      ? new Response("SECRET upstream body", { status: 500, headers: { "x-request-id": "m4-fixture-13" } })
      : Response.json({ choices: [{ message: { content: JSON.stringify(suggestion) } }] });
  }, options));
  const images = Array.from({ length: 12 }, (_, i) => ({ src: `/images/auto-${i}.png` }));
  const result = await finished(jobs, (await jobs.create(images)).id);
  assert.equal(result.state, "done");
  assert.equal(calls, 14);
  assert.equal(result.items.filter((item) => item.state === "done").length, 12);
  assert.equal(result.retrying, null);
  const [failed, recovered] = result.diagnostics.slice(-2);
  assert.equal(failed.stage, "summary"); assert.equal(failed.imageIndex, null);
  assert.equal(failed.httpStatus, 500); assert.equal(failed.attempt, 1);
  assert.equal(failed.upstreamRequestId, "m4-fixture-13");
  assert.equal(recovered.outcome, "success"); assert.equal(recovered.attempt, 2);
  assert.ok(failed.startedAt); assert.ok(failed.durationMs >= 0);
  assert.equal(new Set(ids).size, 14);
  assert.equal(failed.requestId, ids[12]);
  const persisted = await readFile(path.join(directory, `${result.id}.json`), "utf8");
  assert.doesNotMatch(persisted, /SECRET|Bearer|data:image/u);
  assert.deepEqual(JSON.parse(persisted).diagnostics, result.diagnostics);
});

test("rate limits respect Retry-After and lengthy waits pause instead of retrying early", async (t) => {
  for (const seconds of [3, 90]) {
    let calls = 0; const delays = [];
    const { jobs } = await fixture(t, (settings, messages, _fetch, options) => requestGalleryAi(settings, messages, async () => {
      calls++;
      return calls === 1 ? new Response("SECRET", { status: 429, headers: { "retry-after": String(seconds) } })
        : Response.json({ choices: [{ message: { content: JSON.stringify(suggestion) } }] });
    }, options), { sleep: async (ms) => { delays.push(ms); } });
    const created = await jobs.create([{ src: "/images/limited.png" }]);
    await jobs.work.tail;
    const result = await jobs.get(created.id);
    assert.equal(result.state, seconds === 3 ? "done" : "paused");
    assert.equal(calls, seconds === 3 ? 3 : 1);
    assert.deepEqual(delays, seconds === 3 ? [3000] : []);
  }
});

test("repeated HTTP 503 pauses the remaining queue after two attempts", async (t) => {
  let calls = 0;
  const { jobs } = await fixture(t, (settings, messages, _fetch, options) => requestGalleryAi(settings, messages, async () => {
    calls++;
    return new Response("SECRET outage", { status: 503 });
  }, options));
  const created = await jobs.create(Array.from({ length: 12 }, (_, i) => ({ src: `/images/outage-${i}.png` })));
  await jobs.work.tail;
  const result = await jobs.get(created.id);
  assert.equal(result.state, "paused"); assert.equal(calls, 2);
  assert.equal(result.items.filter((item) => item.state === "pending").length, 11);
  assert.equal(result.diagnostics.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/u);
});

test("permanent HTTP and malformed output errors are not automatically retried or leaked", async (t) => {
  for (const status of [400, 401, 403, 404, 200]) {
    let calls = 0;
    const { jobs } = await fixture(t, (settings, messages, _fetch, options) => requestGalleryAi(settings, messages, async () => {
      calls++;
      return new Response("SECRET malformed upstream output", { status });
    }, options));
    const result = await finished(jobs, (await jobs.create([{ src: "/images/invalid.png" }])).id);
    assert.equal(result.state, "attention"); assert.equal(calls, 1);
    assert.equal(result.diagnostics[0].httpStatus, status);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/u);
  }
});

test("HTTP 200 with missing required metadata is diagnosed as invalid output without a retry loop", async (t) => {
  let calls = 0;
  const { jobs } = await fixture(t, (settings, messages, _fetch, options) => requestGalleryAi(settings, messages, async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ ...suggestion, description: "" }) } }] });
  }, options));
  const result = await finished(jobs, (await jobs.create([{ src: "/images/missing-description.png" }])).id);
  assert.equal(result.state, "attention"); assert.equal(calls, 1);
  assert.equal(result.diagnostics[0].errorCode, "M4_INVALID_RESPONSE");
  assert.match(result.items[0].error, /描述为空/u);
});

test("summary retry exposes its stage while waiting and succeeds without re-recognizing images", async (t) => {
  let calls = 0, release, waiting;
  const ready = new Promise((resolve) => { waiting = resolve; });
  const { jobs } = await fixture(t, async () => {
    if (++calls === 2) throw Object.assign(new Error("临时 503"), { statusCode: 502, httpStatus: 503, retryable: true });
    return suggestion;
  }, { sleep: () => new Promise((resolve) => { release = resolve; waiting(); }) });
  const created = await jobs.create([{ src: "/images/wait.png" }]);
  await ready;
  const waitingJob = await jobs.get(created.id);
  assert.equal(waitingJob.state, "summarizing"); assert.equal(waitingJob.retrying.stage, "summary");
  assert.equal(waitingJob.retrying.attempt, 2); assert.equal(waitingJob.items[0].state, "done");
  release();
  assert.equal((await finished(jobs, created.id)).state, "done"); assert.equal(calls, 3);
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

test("fresh recognition bypasses both caches, preserves the old run and separates model weight versions", async (t) => {
  let calls = 0;
  const { jobs } = await fixture(t, async () => ({ ...suggestion, title: `第 ${++calls} 次识别` }));
  const images = [{ src: "/images/one.png" }];
  const first = await finished(jobs, (await jobs.create(images)).id);
  const original = structuredClone(first);
  const fresh = await finished(jobs, (await jobs.create(images, { force: true })).id);
  assert.notEqual(fresh.id, first.id);
  assert.equal(calls, 4, "each run performs recognition and summary");
  assert.notEqual(fresh.items[0].result.title, first.items[0].result.title);
  assert.deepEqual(await jobs.get(first.id), original, "the prior run remains available unchanged");
  assert.ok(fresh.createdAt);
  jobs.config = { ...config, modelVersion: "weights-2" };
  const upgraded = await finished(jobs, (await jobs.create(images)).id);
  assert.notEqual(upgraded.id, first.id);
  assert.equal(upgraded.modelVersion, "weights-2");
  assert.equal(calls, 6, "same model alias with new weights cannot reuse older recognition");
  await assert.rejects(jobs.retry(first.id), /模型配置已变化/);
});

test("a prompt upgrade retains the old run and avoids reusing its recognition cache", async (t) => {
  const { jobs, directory, readAsset } = await fixture(t, async () => suggestion);
  const images = [{ src: "/images/older-prompt.png" }];
  const original = await finished(jobs, (await jobs.create(images)).id);
  await jobs.work.tail;
  // The old identity came from an earlier prompt, so its ID must differ from the current identity.
  const oldId = "a".repeat(64);
  const older = { ...original, id: oldId, prompt: "gallery-v1" };
  await writeFile(path.join(directory, `${oldId}.json`), JSON.stringify(older));
  await rm(path.join(directory, `${original.id}.json`));
  let calls = 0;
  const upgraded = new GalleryAiJobs({ directory, config, readAsset, request: async () => { calls++; return suggestion; } });
  await upgraded.ready;
  await assert.rejects(upgraded.retry(oldId), /配置已变化/u);
  const next = await finished(upgraded, (await upgraded.create(images)).id);
  assert.equal(next.prompt, "gallery-v2"); assert.equal(calls, 2);
  assert.deepEqual(await upgraded.get(oldId), { ...older, retrying: null });
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
  assert.equal(calls, 2);
  jobs.request = async () => { calls++; return suggestion; };
  await jobs.create([{ src: "/images/one.png" }, { src: "/images/two.png" }]);
  assert.equal((await finished(jobs, job.id)).state, "done");
  assert.equal(calls, 5);
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
