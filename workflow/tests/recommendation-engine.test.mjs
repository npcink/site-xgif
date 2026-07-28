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
import { selectContentRecommendations } from "../../site/src/lib/recommendations.mjs";

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
  recommendationGroup = "general",
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
      recommendationGroup,
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

test("adult-humor recommendations stay in their group while general articles exclude it", () => {
  const generalSource = entry("general-source", { title: "周末随笔", tags: ["生活"] });
  const generalCandidate = entry("general-candidate", { title: "平常的一天", tags: ["生活"] });
  const adultCandidate = entry("adult-candidate", {
    title: "两性调侃", tags: ["生活"], recommendationGroup: "adult-humor",
  });
  const adultSource = entry("adult-source", {
    title: "夫妻间的玩笑", tags: ["情感"], recommendationGroup: "adult-humor",
  });
  const adultRelatedOne = entry("adult-related-one", {
    title: "恋人之间的轻松笑话", tags: ["情感"], recommendationGroup: "adult-humor",
  });
  const adultRelatedTwo = entry("adult-related-two", {
    title: "婚姻里的调侃", tags: ["情感"], recommendationGroup: "adult-humor",
  });
  const adultRelatedThree = entry("adult-related-three", {
    title: "情侣玩笑", tags: ["情感"], recommendationGroup: "adult-humor",
  });
  const documents = [
    generalSource,
    generalCandidate,
    adultCandidate,
    adultSource,
    adultRelatedOne,
    adultRelatedTwo,
    adultRelatedThree,
  ].map((entry, index) => ({
    id: entry.id,
    type: "article",
    contentSha256: String(index),
    entry,
  }));
  const vectors = new Map([
    ["general-source", [1, 0]],
    ["general-candidate", [0.9, 0.1]],
    ["adult-candidate", [1, 0]],
    ["adult-source", [1, 0]],
    ["adult-related-one", [0.8, 0.2]],
    ["adult-related-two", [0.7, 0.3]],
    ["adult-related-three", [0.6, 0.4]],
  ]);
  const manifest = buildRecommendationManifest(documents, {
    vectors,
    mode: "hybrid",
    model: "embedding-test",
    generatedAt: "2026-07-24T00:00:00.000Z",
  });

  assert.ok(manifest.recommendations["general-source"].articles.includes("general-candidate"));
  assert.ok(!manifest.recommendations["general-source"].articles.includes("adult-candidate"));
  assert.equal(manifest.recommendations["adult-source"].articles.length, 3);
  assert.ok(manifest.recommendations["adult-source"].articles.every((id) => id.startsWith("adult-")));
});

test("adult-humor recommendations keep a deterministic path through every group item", () => {
  const adultIds = ["adult-a", "adult-b", "adult-c", "adult-d", "adult-e"];
  const documents = adultIds.map((id, index) => ({
    id,
    type: "article",
    contentSha256: String(index),
    entry: entry(id, {
      title: index === adultIds.length - 1 ? "南京旅行后的备孕玩笑" : "夫妻日常",
      tags: index === adultIds.length - 1 ? ["回忆"] : ["婚姻"],
      recommendationGroup: "adult-humor",
    }),
  }));
  const draftAdultEntry = entry("adult-draft", { recommendationGroup: "adult-humor" });
  documents.push({
    id: "adult-draft",
    type: "article",
    contentSha256: "draft",
    entry: {
      ...draftAdultEntry,
      data: {
        ...draftAdultEntry.data,
        draft: true,
      },
    },
  });
  const vectors = new Map(adultIds.map((id, index) => [
    id,
    index === adultIds.length - 1 ? [0, 1] : [1, index / 100],
  ]));
  vectors.set("adult-draft", [1, 0]);
  const manifest = buildRecommendationManifest(documents, {
    vectors,
    mode: "hybrid",
    model: "embedding-test",
    generatedAt: "2026-07-24T00:00:00.000Z",
  });

  adultIds.forEach((sourceId, index) => {
    const coverageId = adultIds[(index + 1) % adultIds.length];
    assert.ok(manifest.recommendations[sourceId].articles.includes(coverageId));
    assert.ok(!manifest.recommendations[sourceId].articles.includes("adult-draft"));
  });
});

test("a stale preferred list cannot put general content ahead of an adult-humor group", () => {
  const source = entry("adult-source", { recommendationGroup: "adult-humor", tags: ["情感"] });
  const general = entry("general-preferred", { tags: ["情感"] });
  const candidates = [
    general,
    entry("adult-one", { recommendationGroup: "adult-humor", tags: ["情感"] }),
    entry("adult-two", { recommendationGroup: "adult-humor", tags: ["情感"] }),
    entry("adult-three", { recommendationGroup: "adult-humor", tags: ["情感"] }),
  ];

  assert.deepEqual(
    selectContentRecommendations(source, candidates, { limit: 3, preferredIds: ["general-preferred"] })
      .map((item) => item.data.contentId),
    ["adult-one", "adult-three", "adult-two"],
  );
});

test("adult-humor group candidates are retained even when their rule similarity is sparse", () => {
  const source = entry("source", {
    title: "甲", recommendationGroup: "adult-humor", tags: [],
  });
  const adultCandidate = entry("adult-candidate", {
    title: "乙", recommendationGroup: "adult-humor", tags: [],
  });
  const generalCandidate = entry("general-candidate", { title: "甲", tags: [] });

  assert.equal(
    selectContentRecommendations(source, [generalCandidate, adultCandidate], { limit: 1 })[0].data.contentId,
    "adult-candidate",
  );
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
