import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { sampleImage } from "./fixtures/image-sample.mjs";
import { buildSeriesCandidates } from "../series-candidates.js";
import { findThemeSeriesMatches } from "../series-theme.js";
import { requestSeriesVision, seriesVisionConfig } from "../series-vision-provider.js";
import { runImageTool } from "../image-cli.js";

const env = { XGIF_SERIES_THEME: "on", XGIF_SERIES_EMBEDDINGS: "off", XGIF_SERIES_VISION_PROVIDER: "openai",
  XGIF_SERIES_VISION_BASE_URL: "https://vision.example", XGIF_SERIES_VISION_MODEL: "vision-test", XGIF_SERIES_VISION_API_KEY: "secret-test-key" };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const comparison = (id, relation = "related_theme") => ({ id, relation, confidence: "high",
  reason: "物品不同，但都用夸张名称制造反差", queryEvidence: ["物品配有夸张标签"], candidateEvidence: ["包装文字被放大成抽象概念"] });
function model(positive, { reportedModel = "vision-test", invalidId = false } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, request) => {
    const payload = JSON.parse(request.body); calls.push(payload);
    const input = JSON.parse(payload.messages[1].content[0].text);
    const comparisons = input.candidateIds.map(id => comparison(invalidId ? "fabricated" : id, id === positive ? "related_theme" : "unrelated"));
    return { ok: true, json: async () => ({ model: reportedModel, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ comparisons }) } }] }) };
  } };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-theme-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "site/src/content/images"), { recursive: true });
  await mkdir(path.join(root, "site/public/images"), { recursive: true });
  const first = await sampleImage(), second = await sampleImage(true);
  const query = await sharp(first).jpeg({ quality: 65 }).toBuffer();
  await writeFile(path.join(root, "query.jpg"), query);
  await writeFile(path.join(root, "site/public/images/one.png"), first);
  await writeFile(path.join(root, "site/public/images/two.png"), second);
  const document = (id, images, extra = "") => `---\ncontentId: "${id}"\ntitle: "不能作为事实的标题"\ndescription: "不能作为依据的描述"\nimage: "${images[0].src}"\nimages: ${JSON.stringify(images)}\n${extra}---\n`;
  const file = "site/src/content/images/20990101-gall.md";
  await writeFile(path.join(root, file), document("20990101-gall", [{ src: "/images/one.png", altText: "不应发送的alt" }, { src: "/images/two.png" }]));
  return { root, query, first, second, file, document };
}

test("theme-only evidence recalls a review candidate without changing embedding thresholds or content", async t => {
  const f = await fixture(t), m = model(digest(f.first));
  const before = await readFile(path.join(f.root, f.file), "utf8");
  const result = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, fetchImpl: m.fetchImpl });
  assert.equal(result.status, "ready"); assert.equal(result.checkedMembers, 2); assert.equal(result.matches.length, 1);
  const [candidate] = buildSeriesCandidates(result.matches);
  assert.equal(candidate.decision, "review"); assert.equal(candidate.requiresReview, true);
  assert.equal(candidate.reviewPolicy, "manual-required"); assert.equal(candidate.matchedMembers[0].themeRelation, "related_theme");
  assert.match(candidate.reasons.join(" "), /不等于同一系列/);
  assert.equal(candidate.score, 0); // No fabricated perceptual or embedding evidence.
  const wire = JSON.stringify(m.calls);
  for (const forbidden of ["不能作为事实", "不能作为依据", "不应发送的alt", "20990101-gall", "/images/one.png"]) assert.ok(!wire.includes(forbidden));
  assert.equal(await readFile(path.join(f.root, f.file), "utf8"), before);
  await writeFile(path.join(f.root, f.file), before.replace("不能作为事实的标题", "新标题").replace("不能作为依据的描述", "任意新描述"));
  const reused = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, fetchImpl: m.fetchImpl });
  assert.equal(reused.requests, 0); assert.equal(reused.cacheHits, 2);
  assert.deepEqual(reused.matches.map(x => x.themeRelation), ["related_theme"]);
  const record = await readFile(path.join(f.root, "workflow/.runtime/series-theme-v1.json"), "utf8");
  assert.ok(!record.includes("secret-test-key"));
  assert.equal(buildSeriesCandidates([{ ...result.matches[0], sourceConflict: true }])[0].decision, "separate");
});

test("original bytes, provider revisions and refresh invalidate theme decisions", async t => {
  const f = await fixture(t), m = model(digest(f.first));
  const lookup = extra => findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env: { ...env, ...extra }, fetchImpl: m.fetchImpl });
  await lookup();
  await writeFile(path.join(f.root, "site/public/images/one.png"), await sharp(f.first).jpeg().toBuffer());
  assert.equal((await lookup()).cacheHits, 1);
  assert.equal((await lookup({ XGIF_SERIES_VISION_REVISION: "new-model-revision" })).cacheHits, 0);
  assert.equal((await lookup({ XGIF_SERIES_THEME_REFRESH: "1" })).cacheHits, 0);
});

test("self matches, private images, drafts and explicit held-out members do not leak into theme comparisons", async t => {
  const f = await fixture(t), m = model(digest(f.first));
  await writeFile(path.join(f.root, "site/src/content/images/20990101-priv.md"), f.document("20990101-priv", [{ src: "https://private.invalid/image" }], "public: false\n"));
  await writeFile(path.join(f.root, "site/src/content/images/20990101-drft.md"), f.document("20990101-drft", [{ src: "https://private.invalid/draft" }], "draft: true\n"));
  const result = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.first, env, excludeImageHashes: [digest(f.second)], fetchImpl: m.fetchImpl });
  assert.equal(result.status, "ready"); assert.equal(result.checkedMembers, 0); assert.equal(m.calls.length, 0);
  const excluded = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, excludeFile: f.file, fetchImpl: m.fetchImpl });
  assert.equal(excluded.totalMembers, 0); assert.equal(excluded.checkedContents, 0);
});

test("unreadable sources, malformed IDs and wrong model identity never report a clean negative", async t => {
  const f = await fixture(t);
  const mismatch = model(digest(f.first), { reportedModel: "silently-changed-model" });
  assert.equal((await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, fetchImpl: mismatch.fetchImpl })).reason, "SERIES_VISION_MODEL_MISMATCH");
  const invalid = model(digest(f.first), { invalidId: true });
  const rejected = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, fetchImpl: invalid.fetchImpl });
  assert.equal(rejected.status, "unavailable"); assert.deepEqual(rejected.matches, []);
  await assert.rejects(readFile(path.join(f.root, "workflow/.runtime/series-theme-v1.json")), { code: "ENOENT" });
  await writeFile(path.join(f.root, "site/src/content/images/20990101-miss.md"), f.document("20990101-miss", [{ src: "https://unverified.invalid/image" }]));
  const partial = await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env, fetchImpl: model(digest(f.first)).fetchImpl });
  assert.equal(partial.status, "partial"); assert.equal(partial.unavailableContents, 1);
  assert.equal((await findThemeSeriesMatches({ repoRoot: f.root, buffer: f.query, env: {} })).status, "disabled");
});

test("theme candidates and unavailable enabled checks require review before upload", async t => {
  const f = await fixture(t), m = model(digest(f.first));
  const args = { repoRoot: f.root, file: path.join(f.root, "query.jpg"), env: { ...env }, fetchImpl: m.fetchImpl };
  const report = await runImageTool(args);
  assert.ok(report.similarity.seriesCandidates.some(c => c.matchedMembers.some(m => m.kind === "theme")));
  await assert.rejects(runImageTool({ ...args, upload: true, apply: true }), /reviewed-sha256/);
  await assert.rejects(runImageTool({ ...args, upload: true, apply: true, reviewedSha256: digest(f.query) }), /R2/);
  await assert.rejects(runImageTool({ ...args, env: { ...env, XGIF_SERIES_VISION_BASE_URL: "" }, upload: true, apply: true }), /reviewed-sha256/);
});

test("vision transport supports local Ollama and explicitly permitted reported identities", async () => {
  const local = seriesVisionConfig({ XGIF_SERIES_VISION_PROVIDER: "ollama", XGIF_SERIES_VISION_BASE_URL: "http://127.0.0.1:11434", XGIF_SERIES_VISION_MODEL: "local-vl" });
  const response = await requestSeriesVision({ config: local, system: "pixels only", input: {}, images: ["png-base64"], fetchImpl: async (url, request) => {
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    const payload = JSON.parse(request.body); assert.deepEqual(payload.messages[1].images, ["png-base64"]);
    return { ok: true, json: async () => ({ model: "local-vl", done: true, done_reason: "stop", message: { content: '{"comparisons":[]}' } }) };
  } });
  assert.deepEqual(response.output, { comparisons: [] });
  assert.throws(() => seriesVisionConfig({ ...env, XGIF_SERIES_VISION_BASE_URL: "http://remote.example" }));
  assert.throws(() => seriesVisionConfig({ ...env, XGIF_SERIES_VISION_REPORTED_MODEL_ALIASES: '[1]' }));
});

test("vision errors preserve safe status codes and aliases require explicit opt-in", async () => {
  const config = seriesVisionConfig(env);
  const args = { config, system: "pixels only", input: {}, images: [] };
  await assert.rejects(requestSeriesVision({ ...args, fetchImpl: async () => ({ ok: false, status: 403 }) }), /^Error: SERIES_VISION_HTTP_403$/);
  await assert.rejects(requestSeriesVision({ ...args, fetchImpl: async () => { throw new Error("secret-test-key"); } }), /^Error: SERIES_VISION_REQUEST_FAILED$/);
  const reply = async () => ({ ok: true, json: async () => ({ model: "explicit-alias", choices: [{ finish_reason: "stop", message: { content: '{"comparisons":[]}' } }] }) });
  await assert.rejects(requestSeriesVision({ ...args, fetchImpl: reply }), /MODEL_MISMATCH/);
  const permitted = seriesVisionConfig({ ...env, XGIF_SERIES_VISION_REPORTED_MODEL_ALIASES: '["explicit-alias"]' });
  assert.equal((await requestSeriesVision({ ...args, config: permitted, fetchImpl: reply })).reportedModel, "explicit-alias");
});
