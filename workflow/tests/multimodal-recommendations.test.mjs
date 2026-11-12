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
} from "../recommendation-engine.js";
import { sampleImage } from "./fixtures/image-sample.mjs";

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

test("all gallery members enter one model space; image bytes, captions, model digest and input version invalidate cache", async () => {
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
  assert.equal((await run()).summary.cacheHits, 1);
  assert.equal(requests, 7);
  // An entry from another input pipeline cannot masquerade as a valid cache hit.
  store.records.get("test-vl:image").contentSha256 = "old-pipeline-fingerprint";
  assert.equal((await run()).summary.cacheHits, 1);
  assert.equal(requests, 9);
  digest = "b".repeat(64);
  assert.equal((await run()).summary.cacheHits, 0);
  assert.equal(requests, 12);
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
