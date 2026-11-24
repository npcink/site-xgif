import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRecommendationManifest, generateRecommendationManifest, getEmbeddingConfig,
  loadPublicRecommendationContent, MULTIMODAL_INPUT_VERSION, refreshRecommendationManifest,
  requestEmbeddings, writeRecommendationManifest, getRecommendationStatus,
  articleEvidenceChunks, TEXT_CHUNK_SIZE, recommendationSourceHash,
} from "../recommendation-engine.js";
import { sampleImage } from "./fixtures/image-sample.mjs";
import { verifyRecommendationPublication } from "../recommendation-verify.js";

const config = getEmbeddingConfig({ XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "http://127.0.0.1:11439", XGIF_EMBEDDING_MODEL: "test-vl" });
const response = (payload) => ({ ok: true, json: async () => payload });

test("native Ollama supports text/image items and validates dimensions, counts and nonzero finite vectors", async () => {
  const inputs = ["文章", { text: "图片描述", image: "aW1hZ2U=" }];
  const vectors = await requestEmbeddings(inputs, config, async (url, request) => {
    assert.equal(url, "http://127.0.0.1:11439/api/embed");
    const body = JSON.parse(request.body);
    assert.deepEqual(body.input, inputs);
    assert.equal(body.truncate, false);
    return response({ embeddings: [[1, 0], [0, 1]] });
  });
  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
  for (const embeddings of [[[1, 0]], [[1, 0], [0]], [[1, 0], [NaN, 1]], [[1, 0], [0, 0]], [[1, 0], ["1", 0]]]) {
    await assert.rejects(requestEmbeddings(inputs, config, async () => response({ embeddings })), { code: "EMBEDDING_RESPONSE_INVALID" });
  }
  assert.throws(() => getEmbeddingConfig({ XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "http://localhost:11434/v1" }), { code: "EMBEDDING_CONFIG_INVALID" });
  assert.throws(() => getEmbeddingConfig({ XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "https://example.com" }), { code: "EMBEDDING_CONFIG_INVALID" });
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-vl-"));
  for (const dir of ["site/public/images", "site/src/content/articles", "site/src/content/images", "workflow/records"]) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, "site/public/images/one.png"), await sampleImage());
  await writeFile(path.join(root, "site/public/images/two.png"), await sampleImage(true));
  const article = '---\ncontentId: "article"\ntitle: "正文标题"\nsummary: "摘要"\ntags: ["生活"]\ndraft: false\n---\n正文不得改动。\n';
  await writeFile(path.join(root, "site/src/content/articles/one.md"), article);
  await writeFile(path.join(root, "site/src/content/articles/draft.md"), article.replace('"article"', '"draft"').replace("draft: false", "draft: true"));
  await writeFile(path.join(root, "site/src/content/articles/hold.md"), article.replace('"article"', '"hold"').replace("draft: false", "draft: false\npublicationHold: true"));
  await writeFile(path.join(root, "site/src/content/images/one.md"), '---\ncontentId: "image"\ntitle: "图集"\ndescription: "两个画面"\nimage: "/images/one.png"\nimages: [{"src":"/images/one.png"},{"src":"/images/two.png"}]\ndraft: false\npublic: true\n---\n');
  return root;
}

function fakeStore() {
  const records = new Map();
  return {
    records,
    listRecommendationEmbeddings: ({ model }) => [...records.values()].filter(r => r.model === model),
    upsertRecommendationEmbedding: record => records.set(`${record.model}:${record.contentId}`, record),
    pruneRecommendationEmbeddings: () => 0,
  };
}

const env = { XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "http://localhost:11434", XGIF_EMBEDDING_MODEL: "test-vl" };

test("published upscales are verified but never encoded or recommended", async () => {
  const root = await fixture(), store = fakeStore();
  const file = path.join(root, "site/src/content/images/upscaled.md");
  const raw = `---\ncontentId: "upscaled"\nimage: "https://img.xgif.cn/memes/${"a".repeat(64)}.png"\nupscale: "real-esrgan"\n---\n`;
  await writeFile(file, raw); // No private copy: this image must never be loaded for inference.
  const fetchImpl = async (url) => url.endsWith("/api/tags")
    ? response({ models: [{ name: "test-vl", digest: "a".repeat(64), capabilities: ["embedding", "vision"] }] })
    : response({ embeddings: [[1, 0]] });
  const { manifest, summary } = await generateRecommendationManifest({ repoRoot: root, store, env, fetchImpl, requireEmbeddings: true });
  assert.equal(summary.generated, 2);
  assert.equal(store.records.has("test-vl:upscaled"), false);
  assert.deepEqual(manifest.recommendations.upscaled, { sourceType: "image", articles: [], images: [] });
  for (const record of Object.values(manifest.recommendations)) assert(!record.images.includes("upscaled"));
  await writeRecommendationManifest(root, manifest);
  assert.equal((await verifyRecommendationPublication(root)).publicCount, 3);
  await writeFile(file, raw.replace("real-esrgan", "lanczos"));
  await assert.rejects(verifyRecommendationPublication(root), /快照不一致/);
  await writeFile(file, raw);
  manifest.recommendations.article.images = ["upscaled"];
  await writeRecommendationManifest(root, manifest);
  await assert.rejects(verifyRecommendationPublication(root), /不允许的内容/);
});

test("all gallery members enter one model space; image bytes, model digest and input version invalidate cache; generated captions do not", async () => {
  const root = await fixture(), store = fakeStore();
  const original = await readFile(path.join(root, "site/src/content/articles/one.md"));
  let digest = "a".repeat(64), requests = 0;
  const fetchImpl = async (url, request) => {
    if (url.endsWith("/api/tags")) return response({ models: [{ name: "test-vl", digest, capabilities: ["embedding", "vision"] }] });
    requests += 1;
    const input = JSON.parse(request.body).input[0];
    if (typeof input === "string") {
      assert.ok(input.includes("正文不得改动。"));
      return response({ embeddings: [[1, 0]] });
    }
    assert.equal(input.text, "");
    assert.ok(Buffer.from(input.image, "base64").subarray(1, 4).equals(Buffer.from("PNG")));
    return response({ embeddings: [[0, 1]] });
  };
  const run = () => generateRecommendationManifest({ repoRoot: root, store, env, fetchImpl, requireEmbeddings: true });
  const first = await run();
  assert.equal(requests, 3);
  assert.equal(first.summary.documents, 2);
  assert.equal(first.manifest.embedding.inputVersion, MULTIMODAL_INPUT_VERSION);
  assert.equal(first.manifest.embedding.modelDigest, digest);
  assert.equal(first.manifest.embedding.dimensions, 2);
  assert.deepEqual(Object.keys(first.manifest.recommendations).sort(), ["article", "image"]);
  await writeRecommendationManifest(root, first.manifest);
  assert.equal((await getRecommendationStatus({ repoRoot: root, env })).stale, false);
  assert.equal((await run()).summary.cacheHits, 2);
  assert.equal(requests, 3);
  // Alter a non-cover member at the same URL; title and description are unchanged.
  await writeFile(path.join(root, "site/public/images/two.png"), await sampleImage());
  assert.equal((await getRecommendationStatus({ repoRoot: root, env })).stale, true);
  const second = await run();
  assert.equal(second.summary.cacheHits, 1);
  assert.equal(requests, 5);
  const galleryFile = path.join(root, "site/src/content/images/one.md");
  await writeFile(galleryFile, (await readFile(galleryFile, "utf8")).replace('"/images/two.png"}', '"/images/two.png","altText":"不同描述"}'));
  assert.equal((await run()).summary.cacheHits, 2);
  assert.equal(requests, 5);
  // An entry from another input pipeline cannot masquerade as a valid cache hit.
  store.records.get("test-vl:image").contentSha256 = "old-pipeline-fingerprint";
  assert.equal((await run()).summary.cacheHits, 1);
  assert.equal(requests, 7);
  digest = "b".repeat(64);
  assert.equal((await run()).summary.cacheHits, 0);
  assert.equal(requests, 10);
  assert.ok(original.equals(await readFile(path.join(root, "site/src/content/articles/one.md"))));
  const changedModel = { ...env, XGIF_EMBEDDING_MODEL: "another-model" };
  assert.equal((await getRecommendationStatus({ repoRoot: root, env: changedModel })).stale, true);
});

test("unverified remote images and symlinks outside public assets are rejected without network fetches", async () => {
  const root = await fixture();
  const file = path.join(root, "site/src/content/images/one.md");
  const remote = '---\ncontentId: "image"\nimage: "https://example.com/not-backed-up.png"\npublic: true\n---\n';
  await writeFile(path.join(root, "workflow/records/r2-assets.jsonl"), "");
  await writeFile(file, remote);
  await assert.rejects(loadPublicRecommendationContent(root, { multimodal: true }), { code: "EMBEDDING_IMAGE_UNAVAILABLE" });
  const outside = path.join(root, "outside.png");
  await writeFile(outside, await sampleImage());
  await symlink(outside, path.join(root, "site/public/images/link.png"));
  await writeFile(file, remote.replace("https://example.com/not-backed-up.png", "/images/link.png"));
  await assert.rejects(loadPublicRecommendationContent(root, { multimodal: true }), { code: "EMBEDDING_IMAGE_UNAVAILABLE" });
  // A valid ledger with corrupted bytes is also rejected.
  const hash = createHash("sha256").update(await sampleImage()).digest("hex");
  await mkdir(path.join(root, "workflow/private-sources/r2-assets"), { recursive: true });
  await writeFile(path.join(root, "workflow/private-sources/r2-assets", `${hash}.png`), await sampleImage(true));
  await writeFile(path.join(root, "workflow/records/r2-assets.jsonl"), JSON.stringify({ publicUrl: "https://example.com/not-backed-up.png", sha256: hash, objectKey: `memes/${hash}.png` }) + "\n");
  await writeFile(file, remote);
  await assert.rejects(loadPublicRecommendationContent(root, { multimodal: true }), { code: "EMBEDDING_IMAGE_UNAVAILABLE" });
});

test("multimodal failure preserves last good bytes; strict mode throws; explicit rules mode can replace", async () => {
  const root = await fixture(), store = fakeStore();
  const good = await generateRecommendationManifest({ repoRoot: root, store, env: {}, rulesOnly: true });
  good.manifest.mode = "hybrid";
  good.manifest.embedding = { model: "old-text-model", dimensions: 1024 };
  await writeRecommendationManifest(root, good.manifest);
  const file = path.join(root, "site/src/data/recommendations.json"), before = await readFile(file);
  const args = { repoRoot: root, store, env, force: true, fetchImpl: async () => { throw new Error("offline"); } };
  const result = await refreshRecommendationManifest(args);
  assert.equal(result.preservedLastGood, true);
  assert.ok(before.equals(await readFile(file)));
  await assert.rejects(refreshRecommendationManifest({ ...args, requireEmbeddings: true }));
  assert.ok(before.equals(await readFile(file)));
  const rules = await refreshRecommendationManifest({ ...args, rulesOnly: true });
  assert.equal(rules.preservedLastGood, undefined);
  assert.equal(JSON.parse(await readFile(file)).mode, "rules");
});

test("multimodal image candidates below the similarity threshold remain empty", () => {
  const documents = ["source", "weak", "related"].map(id => ({
    id, type: "image", contentSha256: id,
    entry: { data: { contentId: id, title: id, tags: [], draft: false, public: true } },
  }));
  const manifest = buildRecommendationManifest(documents, {
    mode: "hybrid", model: "test-vl", embeddingDetails: { inputVersion: MULTIMODAL_INPUT_VERSION },
    vectors: new Map([["source", [1, 0]], ["weak", [0, 1]], ["related", [0.9, 0.1]]]),
  });
  assert.deepEqual(manifest.recommendations.source.images, ["related"]);
  assert.deepEqual(manifest.recommendations.weak.images, []);
});

test("a response with changing dimensions cannot persist partial cache updates", async () => {
  const root = await fixture(), store = fakeStore();
  let calls = 0;
  await assert.rejects(generateRecommendationManifest({
    repoRoot: root, store, env, requireEmbeddings: true,
    fetchImpl: async url => url.endsWith("/api/tags")
      ? response({ models: [{ name: "test-vl", digest: "a".repeat(64), capabilities: ["embedding", "vision"] }] })
      : response({ embeddings: [++calls === 1 ? [1, 0] : [1, 0, 0]] }),
  }), { code: "EMBEDDING_RESPONSE_INVALID" });
  assert.equal(store.records.size, 0);
});

test("changing every AI field leaves source hashes, vector cache and recommendation lists unchanged", async () => {
  const root = await fixture(), store = fakeStore(); let requests = 0;
  const fetchImpl = async (url) => url.endsWith("/api/tags")
    ? response({ models: [{ name: "test-vl", digest: "c".repeat(64), capabilities: ["embedding", "vision"] }] })
    : (requests++, response({ embeddings: [[1, 0]] }));
  const options = { repoRoot: root, store, env, fetchImpl, requireEmbeddings: true, generatedAt: "2026-11-13T00:00:00Z" };
  const before = await generateRecommendationManifest(options); await writeRecommendationManifest(root, before.manifest);
  const sourceHash = recommendationSourceHash(await loadPublicRecommendationContent(root, { multimodal: true }));
  for (const file of ["site/src/content/articles/one.md", "site/src/content/images/one.md"]) {
    const full = path.join(root, file); let raw = await readFile(full, "utf8");
    raw = raw.replace(/^(title|summary|description|tags):.*\n/gmu, "").replace("\n---\n", '\ntitle: "完全换了主题的新标题"\nsummary: "新摘要"\ndescription: "新图述"\ntags: ["任意标签"]\ncategory: "新分类"\nmood: ["开心"]\nscenes: ["回应群聊"]\naltText: "新说明"\ncoverAlt: "新封面说明"\n---\n');
    if (file.includes("/images/")) raw = raw.replace('"/images/two.png"}', '"/images/two.png","altText":"新的组图说明"}');
    await writeFile(full, raw);
  }
  assert.equal((await getRecommendationStatus({ repoRoot: root, env })).stale, false);
  assert.equal(recommendationSourceHash(await loadPublicRecommendationContent(root, { multimodal: true })), sourceHash);
  const next = await generateRecommendationManifest(options);
  assert.equal(next.summary.cacheHits, 2); assert.equal(requests, 3);
  assert.deepEqual(next.manifest, before.manifest);
  const article = path.join(root, "site/src/content/articles/one.md");
  await writeFile(article, (await readFile(article, "utf8")).replace("draft: false", 'recommendationGroup: "adult-humor"\ndraft: false'));
  assert.equal((await getRecommendationStatus({ repoRoot: root, env })).stale, true);
  const changedGroup = await generateRecommendationManifest(options);
  assert.equal(changedGroup.summary.cacheHits, 2); assert.equal(requests, 3);
  assert.notEqual(changedGroup.manifest.sourceHash, sourceHash);
  // Match the frontend's existing group constraint for preferred image lists.
  assert.deepEqual(changedGroup.manifest.recommendations.article.images, []);
  const hashAfterGroup = changedGroup.manifest.sourceHash;
  await writeFile(article, (await readFile(article, "utf8")).replace("\n---\n", '\npubDate: "2025-01-01"\n---\n'));
  const changedDate = await generateRecommendationManifest(options);
  assert.equal(changedDate.summary.cacheHits, 2); assert.equal(requests, 3);
  assert.notEqual(changedDate.manifest.sourceHash, hashAfterGroup);
  await writeFile(article, (await readFile(article, "utf8")).replace("\n---\n", '\npublicationHold: true\n---\n'));
  assert.equal((await generateRecommendationManifest(options)).summary.documents, 1);
});

test("a legacy text endpoint cannot use generated descriptions instead of image pixels", async () => {
  const root = await fixture(); let calls = 0;
  await assert.rejects(generateRecommendationManifest({ repoRoot: root, store: fakeStore(), requireEmbeddings: true,
    env: { XGIF_EMBEDDING_BASE_URL: "http://localhost:11434/v1", XGIF_EMBEDDING_MODEL: "text-only" },
    fetchImpl: async () => { calls++; throw Error("Should not call provider"); },
  }), { code: "EMBEDDING_VISION_UNAVAILABLE" });
  assert.equal(calls, 0);
});

test("full body chunks preserve Unicode and late paragraphs affect the pooled vector", async () => {
  const original = "🦊原文".repeat(TEXT_CHUNK_SIZE) + "最后的备份事故";
  const chunks = articleEvidenceChunks(original);
  assert.equal(chunks.map(c => c.text).join(""), original);
  assert.ok(chunks.every(c => Array.from(c.text).length <= TEXT_CHUNK_SIZE));
  const root = await fixture(), store = fakeStore();
  const file = path.join(root, "site/src/content/articles/one.md");
  const body = "甲".repeat(TEXT_CHUNK_SIZE) + "乙".repeat(TEXT_CHUNK_SIZE);
  await writeFile(file, (await readFile(file, "utf8")).replace("正文不得改动。", body));
  const seen = [];
  const run = () => generateRecommendationManifest({ repoRoot: root, store, env, requireEmbeddings: true, fetchImpl: async (url, request) => {
    if (url.endsWith("/api/tags")) return response({ models: [{ name: "test-vl", digest: "d".repeat(64), capabilities: ["embedding", "vision"] }] });
    const input = JSON.parse(request.body).input[0]; seen.push(input);
    return response({ embeddings: [typeof input === "string" && input.includes("乙") ? [0, 1] : [1, 0]] });
  } });
  await run(); assert.ok(seen.some(input => typeof input === "string" && input.includes("乙")));
  const vector = store.records.get("test-vl:article").vector;
  assert.ok(Math.abs(vector[0] - vector[1]) < 0.01);
  await writeFile(file, (await readFile(file, "utf8")).replaceAll("乙", "丙"));
  const changed = await run(); assert.equal(changed.summary.cacheHits, 1);
  assert.notDeepEqual(store.records.get("test-vl:article").vector, vector);
});
