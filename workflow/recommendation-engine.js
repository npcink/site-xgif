import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  rankRecommendationCandidates,
  recommendationDocument,
  selectContentRecommendations,
} from "../site/src/lib/recommendations.mjs";
import { parseContentDocument } from "./local-data-store.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BATCH_SIZE = 16;
const VECTOR_INPUT_LIMIT = 1_600;

export function recommendationManifestPath(repoRoot) {
  return path.join(repoRoot, "site", "src", "data", "recommendations.json");
}

export class EmbeddingServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "EmbeddingServiceError";
    this.code = code;
  }
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function getEmbeddingConfig(env = process.env) {
  const baseUrl = String(env.XGIF_EMBEDDING_BASE_URL || "").trim().replace(/\/+$/, "");
  const model = String(env.XGIF_EMBEDDING_MODEL || "").trim();
  let endpoint = "";
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
      endpoint = `${baseUrl}/embeddings`;
    } catch {
      throw new EmbeddingServiceError(
        "EMBEDDING_CONFIG_INVALID",
        "XGIF_EMBEDDING_BASE_URL must be an HTTP(S) URL.",
      );
    }
  }
  return {
    available: Boolean(endpoint && model),
    endpoint,
    model,
    apiKey: String(env.XGIF_EMBEDDING_API_KEY || "").trim(),
    timeoutMs: positiveInteger(env.XGIF_EMBEDDING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 300_000),
    batchSize: positiveInteger(env.XGIF_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE, 128),
  };
}

function validateEmbeddingVector(vector) {
  return (
    Array.isArray(vector)
    && vector.length > 0
    && vector.every((value) => Number.isFinite(value))
  );
}

export async function requestEmbeddings(inputs, config, fetchImpl = globalThis.fetch) {
  if (!config?.available) {
    throw new EmbeddingServiceError(
      "EMBEDDING_CONFIG_UNAVAILABLE",
      "Local embedding service is not configured.",
    );
  }
  if (!Array.isArray(inputs) || !inputs.length || inputs.some((input) => typeof input !== "string")) {
    throw new TypeError("Embedding inputs must be a non-empty string array.");
  }
  if (typeof fetchImpl !== "function") {
    throw new EmbeddingServiceError(
      "EMBEDDING_FETCH_UNAVAILABLE",
      "No fetch implementation is available.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
        encoding_format: "float",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new EmbeddingServiceError(
      "EMBEDDING_REQUEST_FAILED",
      error?.name === "AbortError"
        ? `Embedding request timed out after ${config.timeoutMs}ms.`
        : "Embedding request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    throw new EmbeddingServiceError(
      "EMBEDDING_REQUEST_FAILED",
      `Embedding service returned HTTP ${response?.status || "unknown"}.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new EmbeddingServiceError(
      "EMBEDDING_RESPONSE_INVALID",
      "Embedding service returned invalid JSON.",
      { cause: error },
    );
  }

  if (!Array.isArray(payload?.data) || payload.data.length !== inputs.length) {
    throw new EmbeddingServiceError(
      "EMBEDDING_RESPONSE_INVALID",
      "Embedding response count does not match the request.",
    );
  }
  const ordered = Array(inputs.length);
  for (const item of payload.data) {
    if (
      !Number.isInteger(item?.index)
      || item.index < 0
      || item.index >= inputs.length
      || ordered[item.index]
      || !validateEmbeddingVector(item.embedding)
    ) {
      throw new EmbeddingServiceError(
        "EMBEDDING_RESPONSE_INVALID",
        "Embedding response contains an invalid item.",
      );
    }
    ordered[item.index] = item.embedding;
  }
  const dimensions = ordered[0].length;
  if (ordered.some((vector) => vector.length !== dimensions)) {
    throw new EmbeddingServiceError(
      "EMBEDDING_RESPONSE_INVALID",
      "Embedding response dimensions are inconsistent.",
    );
  }
  return ordered;
}

async function listMarkdownFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(entryPath);
      return /\.mdx?$/i.test(entry.name) ? [entryPath] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function semanticInput(type, data, body) {
  const lines = [
    `类型：${type === "article" ? "文章" : "图片"}`,
    `标题：${String(data.title || "").trim()}`,
    `摘要：${String(data.summary || data.description || "").trim()}`,
    `标签：${Array.isArray(data.tags) ? data.tags.join("、") : ""}`,
    `分类：${String(data.category || "").trim()}`,
    `情绪：${Array.isArray(data.mood) ? data.mood.join("、") : ""}`,
    `场景：${Array.isArray(data.scenes) ? data.scenes.join("、") : ""}`,
    type === "article"
      ? `正文：${String(body || "").replace(/\s+/g, " ").trim().slice(0, VECTOR_INPUT_LIMIT)}`
      : "",
  ];
  return lines.filter((line) => !line.endsWith("：")).join("\n");
}

export async function loadPublicRecommendationContent(repoRoot) {
  const sources = [
    {
      type: "article",
      directory: path.join(repoRoot, "site", "src", "content", "articles"),
    },
    {
      type: "image",
      directory: path.join(repoRoot, "site", "src", "content", "images"),
    },
  ];
  const documents = [];
  for (const source of sources) {
    const files = await listMarkdownFiles(source.directory);
    for (const file of files.sort()) {
      const raw = await readFile(file, "utf8");
      const { data, body } = parseContentDocument(raw);
      if (Boolean(data.draft) || data.public === false) continue;
      const contentId = String(data.contentId || "").trim();
      if (!contentId) continue;
      const input = semanticInput(source.type, data, body);
      documents.push({
        id: contentId,
        type: source.type,
        input,
        contentSha256: createHash("sha256").update(input).digest("hex"),
        entry: {
          id: contentId,
          collection: source.type === "article" ? "articles" : "images",
          data: {
            ...data,
            contentId,
            pubDate: data.pubDate ? new Date(data.pubDate) : new Date(0),
          },
        },
      });
    }
  }
  return documents.sort((left, right) => left.id.localeCompare(right.id));
}

export function recommendationSourceHash(documents) {
  return createHash("sha256")
    .update(documents.map((document) => {
      const group = recommendationDocument(document.entry).recommendationGroup;
      return `${document.id}:${document.contentSha256}${group === "adult-humor" ? `:${group}` : ""}`;
    }).join("\n"))
    .digest("hex");
}

export async function readRecommendationManifest(repoRoot) {
  try {
    const raw = await readFile(recommendationManifestPath(repoRoot), "utf8");
    const manifest = JSON.parse(raw);
    if (
      !manifest
      || typeof manifest !== "object"
      || !manifest.recommendations
      || typeof manifest.recommendations !== "object"
      || Array.isArray(manifest.recommendations)
    ) {
      throw new Error("Recommendation manifest has an invalid structure.");
    }
    return manifest;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRecommendationManifest(repoRoot, manifest) {
  const outputPath = recommendationManifestPath(repoRoot);
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return outputPath;
}

export async function getRecommendationStatus({
  repoRoot,
  env = process.env,
} = {}) {
  const documents = await loadPublicRecommendationContent(repoRoot);
  let manifest = null;
  let manifestError = "";
  try {
    manifest = await readRecommendationManifest(repoRoot);
  } catch {
    manifestError = "RECOMMENDATION_MANIFEST_INVALID";
  }

  let embeddingConfig = null;
  let configurationCode = "";
  try {
    embeddingConfig = getEmbeddingConfig(env);
  } catch (error) {
    configurationCode = error?.code || "EMBEDDING_CONFIG_INVALID";
  }

  const recommendations = manifest?.recommendations || {};
  const covered = documents.reduce(
    (count, document) => count + (recommendations[document.id] ? 1 : 0),
    0,
  );
  const total = documents.length;
  const currentSourceHash = recommendationSourceHash(documents);
  const stale = (
    !manifest
    || manifest.sourceHash !== currentSourceHash
    || covered !== total
  );
  const mode = manifest?.mode === "hybrid" ? "hybrid" : manifest ? "rules" : "missing";

  return {
    available: Boolean(manifest),
    mode,
    model: manifest?.embedding?.model || null,
    dimensions: Number.isInteger(manifest?.embedding?.dimensions)
      ? manifest.embedding.dimensions
      : null,
    generatedAt: manifest?.generatedAt || null,
    total,
    covered,
    stale,
    embeddingConfigured: Boolean(embeddingConfig?.available),
    embeddingModel: embeddingConfig?.model || null,
    configurationCode: (
      manifestError
      || configurationCode
      || (embeddingConfig?.available ? "" : "EMBEDDING_CONFIG_UNAVAILABLE")
    ),
  };
}

export function cosineSimilarity(left, right) {
  if (
    !validateEmbeddingVector(left)
    || !validateEmbeddingVector(right)
    || left.length !== right.length
  ) {
    return 0;
  }
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] ** 2;
    rightLength += right[index] ** 2;
  }
  if (!leftLength || !rightLength) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftLength * rightLength)));
}

export function rankHybridCandidates(source, candidates, vectors) {
  const sourceId = recommendationDocument(source).id;
  const sourceVector = vectors.get(sourceId);
  return rankRecommendationCandidates(source, candidates)
    .map((candidate) => {
      const vector = cosineSimilarity(sourceVector, vectors.get(candidate.id));
      return {
        ...candidate,
        vector,
        score: vector * 0.55 + candidate.relevance * 0.35 + candidate.freshness * 0.1,
      };
    })
    .sort(
      (left, right) =>
        Number(right.groupMatch) - Number(left.groupMatch)
        || right.score - left.score
        || right.vector - left.vector
        || right.relevance - left.relevance
        || left.id.localeCompare(right.id),
    );
}

function ids(entries) {
  return entries.map((entry) => recommendationDocument(entry).id).filter(Boolean);
}

function rulesFor(source, candidates, options) {
  return ids(selectContentRecommendations(source, candidates, options));
}

function applyAdultHumorCoverage(documents, recommendations) {
  const adultArticleIds = documents
    .filter((document) => {
      const entry = recommendationDocument(document.entry);
      return document.type === "article"
        && !entry.isDraft
        && entry.isPublic
        && entry.recommendationGroup === "adult-humor";
    })
    .map((document) => document.id)
    .sort();
  if (adultArticleIds.length < 2) return;

  adultArticleIds.forEach((sourceId, index) => {
    const coverageId = adultArticleIds[(index + 1) % adultArticleIds.length];
    const current = recommendations[sourceId]?.articles || [];
    if (!current.length || current.includes(coverageId)) return;
    recommendations[sourceId].articles = [
      ...current.slice(0, Math.max(0, current.length - 1)),
      coverageId,
    ];
  });
}

export function buildRecommendationManifest(
  documents,
  {
    vectors = new Map(),
    mode = "rules",
    model = null,
    generatedAt = new Date().toISOString(),
  } = {},
) {
  const articles = documents.filter((document) => document.type === "article");
  const images = documents.filter((document) => document.type === "image");
  const recommendations = {};

  for (const document of documents) {
    const source = document.entry;
    if (document.type === "article") {
      if (mode === "hybrid") {
        const preferredArticles = rankHybridCandidates(
          source,
          articles.map((candidate) => candidate.entry),
          vectors,
        ).slice(0, 2).map((candidate) => candidate.id);
        const preferredImages = rankHybridCandidates(
          source,
          images.map((candidate) => candidate.entry),
          vectors,
        ).slice(0, 3).map((candidate) => candidate.id);
        recommendations[document.id] = {
          articles: rulesFor(source, articles.map((candidate) => candidate.entry), {
            limit: 3,
            relatedSlots: 0,
            allowSurprise: true,
            preferredIds: preferredArticles,
          }),
          images: rulesFor(source, images.map((candidate) => candidate.entry), {
            limit: 3,
            relatedSlots: 0,
            allowSurprise: false,
            preferredIds: preferredImages,
          }),
        };
      } else {
        recommendations[document.id] = {
          articles: rulesFor(source, articles.map((candidate) => candidate.entry), {
            limit: 3,
            relatedSlots: 2,
            allowSurprise: true,
          }),
          images: rulesFor(source, images.map((candidate) => candidate.entry), {
            limit: 3,
            relatedSlots: 3,
            allowSurprise: false,
          }),
        };
      }
    } else {
      const preferredArticles = mode === "hybrid"
        ? rankHybridCandidates(
            source,
            articles.map((candidate) => candidate.entry),
            vectors,
          ).slice(0, 2).map((candidate) => candidate.id)
        : [];
      recommendations[document.id] = {
        articles: rulesFor(source, articles.map((candidate) => candidate.entry), {
          limit: 2,
          relatedSlots: mode === "hybrid" ? 0 : 2,
          allowSurprise: false,
          preferredIds: preferredArticles,
        }),
        images: [],
      };
    }
  }

  applyAdultHumorCoverage(documents, recommendations);
  const sourceHash = recommendationSourceHash(documents);
  const dimensions = mode === "hybrid" ? vectors.values().next().value?.length || null : null;
  return {
    schemaVersion: 1,
    generatedAt,
    sourceHash,
    mode,
    embedding: {
      model: mode === "hybrid" ? model : null,
      dimensions,
    },
    recommendations,
  };
}

async function embeddingVectors(documents, store, config, fetchImpl) {
  const cache = new Map(
    store.listRecommendationEmbeddings({ model: config.model })
      .map((record) => [record.contentId, record]),
  );
  const vectors = new Map();
  const pending = [];
  let cacheHits = 0;
  for (const document of documents) {
    const cached = cache.get(document.id);
    if (cached?.contentSha256 === document.contentSha256) {
      vectors.set(document.id, cached.vector);
      cacheHits += 1;
    } else {
      pending.push(document);
    }
  }

  for (let index = 0; index < pending.length; index += config.batchSize) {
    const batch = pending.slice(index, index + config.batchSize);
    const batchVectors = await requestEmbeddings(
      batch.map((document) => document.input),
      config,
      fetchImpl,
    );
    for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
      const document = batch[itemIndex];
      const vector = batchVectors[itemIndex];
      vectors.set(document.id, vector);
      store.upsertRecommendationEmbedding({
        contentId: document.id,
        contentType: document.type,
        contentSha256: document.contentSha256,
        model: config.model,
        vector,
      });
    }
  }

  const dimensions = new Set([...vectors.values()].map((vector) => vector.length));
  if (vectors.size !== documents.length || dimensions.size !== 1) {
    throw new EmbeddingServiceError(
      "EMBEDDING_RESPONSE_INVALID",
      "Embedding corpus is incomplete or has inconsistent dimensions.",
    );
  }
  const pruned = store.pruneRecommendationEmbeddings({
    model: config.model,
    validContentIds: documents.map((document) => document.id),
  });
  return { vectors, cacheHits, generated: pending.length, pruned };
}

export async function generateRecommendationManifest({
  repoRoot,
  store,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requireEmbeddings = false,
  rulesOnly = false,
  generatedAt,
}) {
  const documents = await loadPublicRecommendationContent(repoRoot);
  let config;
  try {
    config = getEmbeddingConfig(env);
  } catch (error) {
    if (requireEmbeddings) throw error;
    return {
      manifest: buildRecommendationManifest(documents, { generatedAt }),
      summary: {
        mode: "rules",
        documents: documents.length,
        cacheHits: 0,
        generated: 0,
        fallbackCode: error.code || "EMBEDDING_CONFIG_INVALID",
      },
    };
  }

  if (rulesOnly || !config.available) {
    if (requireEmbeddings && !rulesOnly) {
      throw new EmbeddingServiceError(
        "EMBEDDING_CONFIG_UNAVAILABLE",
        "Local embedding service is not configured.",
      );
    }
    return {
      manifest: buildRecommendationManifest(documents, { generatedAt }),
      summary: {
        mode: "rules",
        documents: documents.length,
        cacheHits: 0,
        generated: 0,
        fallbackCode: rulesOnly ? "" : "EMBEDDING_CONFIG_UNAVAILABLE",
      },
    };
  }

  try {
    const result = await embeddingVectors(documents, store, config, fetchImpl);
    return {
      manifest: buildRecommendationManifest(documents, {
        vectors: result.vectors,
        mode: "hybrid",
        model: config.model,
        generatedAt,
      }),
      summary: {
        mode: "hybrid",
        documents: documents.length,
        cacheHits: result.cacheHits,
        generated: result.generated,
        pruned: result.pruned,
        model: config.model,
        dimensions: result.vectors.values().next().value?.length || 0,
      },
    };
  } catch (error) {
    if (requireEmbeddings) throw error;
    return {
      manifest: buildRecommendationManifest(documents, { generatedAt }),
      summary: {
        mode: "rules",
        documents: documents.length,
        cacheHits: 0,
        generated: 0,
        fallbackCode: error.code || "EMBEDDING_REQUEST_FAILED",
      },
    };
  }
}

export async function refreshRecommendationManifest({
  repoRoot,
  store,
  env = process.env,
  fetchImpl = globalThis.fetch,
  force = false,
} = {}) {
  const before = await getRecommendationStatus({ repoRoot, env });
  if (!force && before.available && !before.stale) {
    return {
      unchanged: true,
      summary: {
        mode: before.mode,
        documents: before.total,
        cacheHits: 0,
        generated: 0,
        fallbackCode: "",
        model: before.model,
        dimensions: before.dimensions,
      },
      status: before,
    };
  }

  const result = await generateRecommendationManifest({
    repoRoot,
    store,
    env,
    fetchImpl,
  });
  await writeRecommendationManifest(repoRoot, result.manifest);
  return {
    unchanged: false,
    summary: result.summary,
    status: await getRecommendationStatus({ repoRoot, env }),
  };
}
