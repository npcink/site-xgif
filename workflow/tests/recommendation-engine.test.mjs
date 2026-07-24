import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EmbeddingServiceError,
  buildRecommendationManifest,
  generateRecommendationManifest,
  getRecommendationStatus,
  rankHybridCandidates,
  refreshRecommendationManifest,
  requestEmbeddings,
  writeRecommendationManifest,
} from "../recommendation-engine.js";

const embeddingConfig = {
  available: true,
  endpoint: "http://127.0.0.1:11435/v1/embeddings",
  model: "embedding-test",
  apiKey: "",
  timeoutMs: 1_000,
  batchSize: 16,
};

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function entry(id, {
  title = id,
  summary = "",
  tags = [],
  pubDate = "2026-07-24",
} = {}) {
  return {
    id,
    data: {
      contentId: id,
      title,
      summary,
      tags,
      pubDate: new Date(pubDate),
      draft: false,
      public: true,
    },
  };
}

test("OpenAI-compatible embedding response is validated and restored by index", async () => {
  const vectors = await requestEmbeddings(["first", "second"], embeddingConfig, async () => response({
    data: [
      { index: 1, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] },
    ],
  }));
  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
});

test("embedding response rejects inconsistent dimensions", async () => {
  await assert.rejects(
    requestEmbeddings(["first", "second"], embeddingConfig, async () => response({
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [1, 0, 0] },
      ],
    })),
    (error) =>
      error instanceof EmbeddingServiceError
      && error.code === "EMBEDDING_RESPONSE_INVALID",
  );
});

test("hybrid ranking can promote semantic similarity over a shared broad tag", () => {
  const source = entry("source", { title: "父亲与海边旧事", tags: ["回忆"] });
  const broadTagCandidate = entry("tag", { title: "校园回忆", tags: ["回忆"] });
  const semanticCandidate = entry("semantic", { title: "家人与海岸的往事", tags: ["亲情"] });
  const vectors = new Map([
    ["source", [1, 0]],
    ["tag", [0, 1]],
    ["semantic", [0.99, 0.01]],
  ]);
  const ranked = rankHybridCandidates(
    source,
    [broadTagCandidate, semanticCandidate],
    vectors,
  );
  assert.equal(ranked[0].id, "semantic");
  assert.ok(ranked[0].vector > ranked[1].vector);
});

test("manifest excludes drafts and offers a deterministic surprise slot", () => {
  const source = entry("source", { title: "远方", tags: ["旅行"] });
  const related = entry("related", { title: "火车旅行", tags: ["旅行"] });
  const surprise = entry("surprise", { title: "厨房", tags: ["饮食"] });
  const draft = {
    ...entry("draft", { title: "草稿", tags: ["旅行"] }),
    data: { ...entry("draft").data, draft: true },
  };
  const documents = [
    { id: "source", type: "article", contentSha256: "1", entry: source },
    { id: "related", type: "article", contentSha256: "2", entry: related },
    { id: "surprise", type: "article", contentSha256: "3", entry: surprise },
    { id: "draft", type: "article", contentSha256: "4", entry: draft },
  ];
  const manifest = buildRecommendationManifest(documents, {
    generatedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.deepEqual(manifest.recommendations.source.articles, ["related", "surprise"]);
  assert.ok(!manifest.recommendations.source.articles.includes("draft"));
});

test("missing embedding configuration safely generates a rules manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-recommendations-"));
  const articlesDir = path.join(root, "site", "src", "content", "articles");
  await mkdir(articlesDir, { recursive: true });
  await writeFile(path.join(articlesDir, "one.md"), `---
title: "公开文章"
contentId: "20260724-one"
summary: "规则推荐仍可工作"
tags: ["测试"]
pubDate: "2026-07-24"
draft: false
---
正文
`, "utf8");
  await writeFile(path.join(articlesDir, "draft.md"), `---
title: "私密草稿"
contentId: "20260724-draft"
tags: ["测试"]
pubDate: "2026-07-24"
draft: true
---
不会进入推荐。
`, "utf8");

  const store = {
    listRecommendationEmbeddings() {
      throw new Error("rules fallback must not read the embedding cache");
    },
  };
  const result = await generateRecommendationManifest({
    repoRoot: root,
    store,
    env: {},
    generatedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.summary.mode, "rules");
  assert.equal(result.summary.fallbackCode, "EMBEDDING_CONFIG_UNAVAILABLE");
  assert.deepEqual(Object.keys(result.manifest.recommendations), ["20260724-one"]);

  const unavailableService = await generateRecommendationManifest({
    repoRoot: root,
    store: {
      listRecommendationEmbeddings() {
        return [];
      },
      upsertRecommendationEmbedding() {
        throw new Error("failed requests must not populate the cache");
      },
      pruneRecommendationEmbeddings() {
        return 0;
      },
    },
    env: {
      XGIF_EMBEDDING_BASE_URL: "http://127.0.0.1:9/v1",
      XGIF_EMBEDDING_MODEL: "embedding-test",
      XGIF_EMBEDDING_TIMEOUT_MS: "100",
    },
    fetchImpl: async () => {
      throw new Error("service offline");
    },
    generatedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(unavailableService.summary.mode, "rules");
  assert.equal(unavailableService.summary.fallbackCode, "EMBEDDING_REQUEST_FAILED");
});

test("recommendation status detects changed public content and refreshes atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-recommendation-status-"));
  const articlesDir = path.join(root, "site", "src", "content", "articles");
  const articlePath = path.join(articlesDir, "one.md");
  await mkdir(articlesDir, { recursive: true });
  await writeFile(articlePath, `---
title: "第一版"
contentId: "20260724-one"
summary: "状态检查"
tags: ["测试"]
pubDate: "2026-07-24"
draft: false
---
正文
`, "utf8");

  const store = {
    listRecommendationEmbeddings() {
      throw new Error("rules mode must not read vectors");
    },
  };
  const generated = await generateRecommendationManifest({
    repoRoot: root,
    store,
    env: {},
    generatedAt: "2026-07-24T00:00:00.000Z",
  });
  await writeRecommendationManifest(root, generated.manifest);

  const current = await getRecommendationStatus({ repoRoot: root, env: {} });
  assert.equal(current.stale, false);
  assert.equal(current.covered, 1);
  assert.equal(current.total, 1);

  const unchanged = await refreshRecommendationManifest({
    repoRoot: root,
    store,
    env: {},
  });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.status.generatedAt, "2026-07-24T00:00:00.000Z");

  await writeFile(articlePath, (await readFile(articlePath, "utf8")).replace("第一版", "第二版"), "utf8");
  const stale = await getRecommendationStatus({ repoRoot: root, env: {} });
  assert.equal(stale.stale, true);

  const refreshed = await refreshRecommendationManifest({
    repoRoot: root,
    store,
    env: {},
  });
  assert.equal(refreshed.unchanged, false);
  assert.equal(refreshed.summary.fallbackCode, "EMBEDDING_CONFIG_UNAVAILABLE");
  assert.equal(refreshed.status.stale, false);
});
