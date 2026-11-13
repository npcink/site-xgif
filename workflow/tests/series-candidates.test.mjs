import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { sampleImage } from "./fixtures/image-sample.mjs";
import { buildSeriesCandidates, classifySeriesSignals, cosineSimilarity } from "../series-candidates.js";
import { findSemanticSeriesMatches } from "../series-embeddings.js";
import { runImageTool } from "../image-cli.js";
import { createHash } from "node:crypto";

test("series classifier requires manual confirmation even for high-confidence matches", () => {
  const highConfidence = classifySeriesSignals({ visualSimilarity: 1, batchMatch: true, embeddingSimilarity: 1, textOverlap: 1 });
  assert.equal(highConfidence.decision, "review");
  assert.match(highConfidence.reasons.join(" "), /人工确认/);
  assert.equal(classifySeriesSignals({ visualSimilarity: 1 }).decision, "review");
  assert.equal(classifySeriesSignals({ visualSimilarity: 1, batchMatch: true, embeddingSimilarity: 1, sourceConflict: true }).decision, "separate");
  assert.equal(classifySeriesSignals({ visualSimilarity: 0.1 }).decision, "separate");
});

test("series candidates group member hits and keep exact duplicates as manual review items", () => {
  const candidates = buildSeriesCandidates([
    {
      file: "site/src/content/images/20990101-gall.md",
      contentId: "20990101-gall",
      title: "一组梗图",
      image: "https://img.example/one.png",
      memberIndex: 0,
      memberCount: 3,
      kind: "similar",
      distance: 5,
    },
    {
      file: "site/src/content/images/20990101-gall.md",
      contentId: "20990101-gall",
      title: "一组梗图",
      image: "https://img.example/two.png",
      memberIndex: 1,
      memberCount: 3,
      kind: "exact",
      distance: 0,
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].memberCount, 3);
  assert.equal(candidates[0].matchedMembers.length, 2);
  assert.equal(candidates[0].decision, "duplicate");
  assert.equal(candidates[0].reviewPolicy, "manual-required");
  assert.equal(candidates[0].requiresReview, true);
  assert.match(candidates[0].reasons.join(" "), /重复图片/);
});

test("cosine similarity rejects malformed vectors and compares normalized vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 1], [2, 2]), 1);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
});

test("semantic evidence can produce a review candidate without permitting auto merge", () => {
  const candidates = buildSeriesCandidates([{
    file: "site/src/content/images/20990101-gall.md",
    contentId: "20990101-gall",
    title: "一组梗图",
    image: "https://img.example/one.png",
    memberIndex: 0,
    memberCount: 3,
    kind: "semantic",
    embeddingSimilarity: 0.91,
  }]);
  assert.equal(candidates[0].decision, "review");
  assert.equal(candidates[0].reviewPolicy, "manual-required");
  assert.equal(candidates[0].matchedMembers[0].kind, "semantic");
  assert.match(candidates[0].reasons.join(" "), /图文向量相似/);
});

test("semantic-only evidence never fabricates perceptual evidence; any conflict survives grouping", () => {
  const match = { file: "gallery.md", kind: "semantic", embeddingSimilarity: 0.7 };
  const [candidate] = buildSeriesCandidates([match]);
  assert.equal(candidate.decision, "review");
  assert.equal(candidate.score, 0.175);
  assert.ok(!candidate.reasons.some(reason => reason.includes("感知指纹")));
  for (const distance of [null, undefined, "", "0"]) {
    const [missing] = buildSeriesCandidates([{ file: "gallery.md", kind: "similar", distance }]);
    assert.equal(missing.decision, "separate");
    assert.equal(missing.score, 0);
  }
  const [conflict] = buildSeriesCandidates([match, { ...match, embeddingSimilarity: 0.65, sourceConflict: true }]);
  assert.equal(conflict.decision, "separate");
  assert.equal(classifySeriesSignals({ batchMatch: true }).decision, "review");
});

const seriesEnv = { XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "http://127.0.0.1:11435", XGIF_EMBEDDING_MODEL: "series-test" };
const modelDigest = "a".repeat(64);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-series-embedding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "site/src/content/images"), { recursive: true });
  await mkdir(path.join(root, "site/public/images"), { recursive: true });
  const first = await sampleImage();
  const second = await sampleImage(true);
  const query = await sharp(first).jpeg({ quality: 75 }).toBuffer();
  await writeFile(path.join(root, "site/public/images/one.png"), first);
  await writeFile(path.join(root, "site/public/images/two.png"), second);
  const content = (id, images, extra = "") => `---\ncontentId: "${id}"\ntitle: "图片"\nimage: "${images[0].src}"\nimages: ${JSON.stringify(images)}\n${extra}---\n`;
  const galleryFile = path.join(root, "site/src/content/images/20990101-gall.md");
  const images = [{ src: "/images/two.png" }, { src: "/images/one.png" }];
  await writeFile(galleryFile, content("20990101-gall", images));
  return { root, first, second, query, content, images, galleryFile };
}
function fakeModel() {
  let digest = modelDigest;
  const calls = [];
  const fetchImpl = async (url, request) => {
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: [{ name: "series-test", digest, capabilities: ["embedding", "vision"] }] }) };
    const input = JSON.parse(request.body).input[0];
    assert.equal(input.text, "");
    calls.push(input);
    return { ok: true, json: async () => ({ embeddings: [[1, 0]] }) };
  };
  return { calls, fetchImpl, changeDigest() { digest = "b".repeat(64); } };
}

test("new galleries need no recommendation cache; member matches, byte changes, model digest and AI independence", async t => {
  const f = await fixture(t);
  const model = fakeModel();
  const lookup = () => findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: seriesEnv, fetchImpl: model.fetchImpl });
  const result = await lookup();
  assert.equal(result.status, "ready");
  assert.equal(result.checkedMembers, 2);
  assert.equal(result.generated, 3);
  assert.deepEqual(result.matches.map(match => match.memberIndex), [0, 1]);
  assert.equal(result.matches[0].memberCount, 2);
  assert.equal(result.modelDigest, modelDigest);
  const original = await readFile(f.galleryFile, "utf8");
  await writeFile(f.galleryFile, original.replace('title: "图片"', 'title: "任意新标题"\naltText: "新描述"\ntags: ["AI"]'));
  const reused = await lookup();
  assert.equal(reused.generated, 0);
  assert.equal(model.calls.length, 3);
  assert.ok(model.calls.every(input => input.text === ""));
  await writeFile(path.join(f.root, "site/public/images/one.png"), await sharp(f.first).jpeg().toBuffer());
  assert.equal((await lookup()).generated, 1);
  model.changeDigest();
  assert.equal((await lookup()).generated, 3);
  assert.equal(await readFile(f.galleryFile, "utf8"), original.replace('title: "图片"', 'title: "任意新标题"\naltText: "新描述"\ntags: ["AI"]'));
});

test("query bytes, held-out members, drafts, private and excluded entries never leak into the candidate corpus", async t => {
  const f = await fixture(t);
  const model = fakeModel();
  for (const [id, extra] of [["20990101-drft", "draft: true\n"], ["20990101-priv", "public: false\n"]]) {
    await writeFile(path.join(f.root, `site/src/content/images/${id}.md`), f.content(id, f.images, extra));
  }
  const result = await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.first, env: seriesEnv, fetchImpl: model.fetchImpl });
  assert.equal(result.checkedContents, 1);
  assert.equal(result.checkedMembers, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].memberIndex, 0);
  const excluded = await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: seriesEnv, fetchImpl: model.fetchImpl, excludeFile: "site/src/content/images/20990101-gall.md" });
  assert.equal(excluded.matches.length, 0);
  assert.equal(excluded.checkedContents, 0);
});

test("unverified images report partial coverage, corrupt caches rebuild, and service failure remains explicit", async t => {
  const f = await fixture(t);
  const model = fakeModel();
  await writeFile(path.join(f.root, "site/src/content/images/20990101-miss.md"), f.content("20990101-miss", [{ src: "https://unverified.invalid/no.png" }]));
  const result = await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: seriesEnv, fetchImpl: model.fetchImpl });
  assert.equal(result.status, "partial");
  assert.equal(result.unavailableContents, 1);
  assert.equal(result.checkedMembers, 2);
  await writeFile(path.join(f.root, "workflow/.runtime/series-image-embeddings-v1.json"), "broken");
  assert.equal((await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: seriesEnv, fetchImpl: model.fetchImpl })).generated, 3);
  const failed = await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: seriesEnv, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.matches, []);
  const disabled = await findSemanticSeriesMatches({ repoRoot: f.root, buffer: f.query, env: { ...seriesEnv, XGIF_SERIES_EMBEDDINGS: "off" }, fetchImpl: model.fetchImpl });
  assert.equal(disabled.status, "disabled");
});

test("upload gate blocks semantic-only candidates until the specific image has been reviewed", async t => {
  const f = await fixture(t);
  // Different pixels defeat perceptual matching; only the model supplies a hit.
  await writeFile(f.galleryFile, f.content("20990101-gall", [{ src: "/images/one.png" }]));
  const file = path.join(f.root, "site/public/images/two.png");
  const model = fakeModel();
  let uploads = 0;
  const args = { repoRoot: f.root, file, env: { ...seriesEnv }, fetchImpl: model.fetchImpl,
    storeAsset: async () => { uploads++; throw new Error("unexpected upload"); } };
  const original = await readFile(f.galleryFile, "utf8");
  const report = await runImageTool(args);
  assert.equal(report.similarity.matches.some(match => match.kind === "similar" || match.kind === "exact"), false);
  assert.equal(report.similarity.seriesCandidates[0].decision, "review");
  assert.equal(report.similarity.seriesEmbedding.checkedMembers, 1);
  assert.equal(report.similarity.seriesEmbedding.modelDigest, modelDigest);
  assert.equal(report.similarity.seriesEmbedding.inputVersion, "qwen3-vl-series-pixels-v1");
  assert.equal(report.similarity.checkRecordSaved, true);
  const recorded = JSON.parse((await readFile(path.join(f.root, "workflow/.runtime/image-checks.jsonl"), "utf8")).trim());
  assert.equal(recorded.sha256, report.sha256);
  assert.equal(recorded.reviewed, false);
  assert.equal(recorded.similarity.seriesCandidates[0].reviewPolicy, "manual-required");
  for (const reviewedSha256 of ["", "f".repeat(64)]) {
    await assert.rejects(runImageTool({ ...args, upload: true, apply: true, reviewedSha256 }), /reviewed-sha256/);
  }
  const reviewedSha256 = createHash("sha256").update(f.second).digest("hex");
  // Correct confirmation passes this gate; the unconfigured storage stops later.
  await assert.rejects(runImageTool({ ...args, upload: true, apply: true, reviewedSha256 }), /R2/);
  assert.equal(uploads, 0);
  assert.equal(await readFile(f.galleryFile, "utf8"), original);
});
