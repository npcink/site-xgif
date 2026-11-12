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
import { validateServiceBaseUrl } from "./service-url-policy.js";
import { recommendationImages } from "./recommendation-images.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BATCH_SIZE = 16;
const VECTOR_INPUT_LIMIT = 1_600;
export const MULTIMODAL_INPUT_VERSION = "qwen3-vl-pixels-v1";
export const DEFAULT_MULTIMODAL_MODEL = "RizwanMalik/qwen3-vl-embedding-2b:q8_0-q8_0";
const IMAGE_MIN_SIMILARITY = 0.35;

export function recommendationManifestPath(repoRoot) {
  return path.join(repoRoot, "site", "src", "data", "recommendations.json");
}

export function recommendationAttemptPath(repoRoot) {
  return path.join(repoRoot, "workflow", ".runtime", "recommendation-attempt.json");
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
  let baseUrl = "";
  try {
    baseUrl = validateServiceBaseUrl(env.XGIF_EMBEDDING_BASE_URL, {
      label: "XGIF_EMBEDDING_BASE_URL",
    });
  } catch (error) {
    throw new EmbeddingServiceError(
      "EMBEDDING_CONFIG_INVALID",
      error.message,
      { cause: error },
    );
  }
  const provider = String(env.XGIF_EMBEDDING_PROVIDER || "openai").trim();
  if (!["openai", "ollama"].includes(provider)) {
    throw new EmbeddingServiceError("EMBEDDING_CONFIG_INVALID", "Unknown embedding provider.");
  }
  const model = String(env.XGIF_EMBEDDING_MODEL || (provider === "ollama" ? DEFAULT_MULTIMODAL_MODEL : "")).trim();
  if (provider === "ollama" && baseUrl && new URL(baseUrl).pathname !== "/") {
    throw new EmbeddingServiceError("EMBEDDING_CONFIG_INVALID", "Ollama base URL must be the service root, without /v1.");
  }
  if (provider === "ollama" && baseUrl && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname)) {
    throw new EmbeddingServiceError("EMBEDDING_CONFIG_INVALID", "Multimodal Ollama must use a local loopback endpoint or SSH tunnel.");
  }
  let endpoint = "";
  if (baseUrl) {
    endpoint = `${baseUrl}${provider === "ollama" ? "/api/embed" : "/embeddings"}`;
  }
  return {
    available: Boolean(endpoint && model),
    provider,
    endpoint,
    model,
    apiKey: String(env.XGIF_EMBEDDING_API_KEY || "").trim(),
    timeoutMs: positiveInteger(env.XGIF_EMBEDDING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 300_000),
    batchSize: provider === "ollama" ? 1 : positiveInteger(env.XGIF_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE, 128),
  };
}

function validateEmbeddingVector(vector) {
  return (
    Array.isArray(vector)
    && vector.length > 0
    && vector.every((value) => Number.isFinite(value))
    && vector.some((value) => value !== 0)
  );
}

export async function requestEmbeddings(inputs, config, fetchImpl = globalThis.fetch) {
  if (!config?.available) {
    throw new EmbeddingServiceError(
      "EMBEDDING_CONFIG_UNAVAILABLE",
      "Local embedding service is not configured.",
    );
  }
  const isOllama = config.provider === "ollama";
  if (!Array.isArray(inputs) || !inputs.length || inputs.some((input) => (
    typeof input !== "string" && !(isOllama && input && typeof input.text === "string" && typeof input.image === "string")
  ))) {
    throw new TypeError("Embedding inputs must contain text or Ollama text/image items.");
  }
  if (typeof fetchImpl !== "function") {
    throw new EmbeddingServiceError(
      "EMBEDDING_FETCH_UNAVAILABLE",
      "No fetch implementation is available.",
    );
  }

  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(isOllama ? {
        model: config.model,
        input: inputs,
        truncate: false,
        keep_alive: "2m",
        options: { num_ctx: 4096 },
      } : {
        model: config.model,
        input: inputs,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new EmbeddingServiceError(
      "EMBEDDING_REQUEST_FAILED",
      error?.name === "AbortError"
        ? `Embedding request timed out after ${config.timeoutMs}ms.`
        : "Embedding request failed.",
      { cause: error },
    );
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

  if (isOllama) {
    const vectors = payload?.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== inputs.length
      || vectors.some((vector) => !validateEmbeddingVector(vector) || vector.length !== vectors[0].length
        || (config.model === DEFAULT_MULTIMODAL_MODEL && vector.length !== 2048))) {
      throw new EmbeddingServiceError("EMBEDDING_RESPONSE_INVALID", "Ollama returned invalid or inconsistent embeddings.");
    }
    return vectors;
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

export async function loadPublicRecommendationContent(repoRoot, { multimodal = false } = {}) {
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
      if (Boolean(data.draft) || data.public === false || data.publicationHold === true) continue;
      const contentId = String(data.contentId || "").trim();
      if (!contentId) continue;
      const input = semanticInput(source.type, data, body);
      let images = [];
      if (multimodal && source.type === "image") {
        try {
          images = await recommendationImages(repoRoot, data);
        } catch (error) {
          throw new EmbeddingServiceError("EMBEDDING_IMAGE_UNAVAILABLE", `Cannot read verified images for ${contentId}: ${error.message}`, { cause: error });
        }
      }
      const fingerprint = multimodal
        ? JSON.stringify([MULTIMODAL_INPUT_VERSION, input, images.map(({ sha256, altText }) => [sha256, altText])])
        : input;
      documents.push({
        id: contentId,
        type: source.type,
        input,
        // Metadata already contributes to rule ranking; keep visual similarity grounded in pixels.
        inputs: images.length ? images.map(({ image }) => ({ text: "", image })) : [input],
        contentSha256: createHash("sha256").update(fingerprint).digest("hex"),
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

async function readRecommendationAttempt(repoRoot) {
  try {
    const attempt = JSON.parse(await readFile(recommendationAttemptPath(repoRoot), "utf8"));
    return attempt && typeof attempt === "object" && !Array.isArray(attempt) ? attempt : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeRecommendationAttempt(repoRoot, attempt) {
  const outputPath = recommendationAttemptPath(repoRoot);
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(attempt, null, 2)}\n`, "utf8");
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function getRecommendationStatus({
  repoRoot,
  env = process.env,
} = {}) {
  let documents = await loadPublicRecommendationContent(repoRoot);
  let manifest = null;
  let manifestError = "";
  try {
    manifest = await readRecommendationManifest(repoRoot);
  } catch {
    manifestError = "RECOMMENDATION_MANIFEST_INVALID";
  }
  const attempt = await readRecommendationAttempt(repoRoot);

  let embeddingConfig = null;
  let configurationCode = "";
  try {
    embeddingConfig = getEmbeddingConfig(env);
  } catch (error) {
    configurationCode = error?.code || "EMBEDDING_CONFIG_INVALID";
  }
  if (embeddingConfig?.provider === "ollama") {
    try {
      documents = await loadPublicRecommendationContent(repoRoot, { multimodal: true });
    } catch (error) {
      configurationCode = error?.code || "EMBEDDING_IMAGE_UNAVAILABLE";
    }
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
    || Boolean(configurationCode)
    || (embeddingConfig?.available && manifest?.mode === "hybrid" && (
      manifest.embedding?.model !== embeddingConfig.model
      || (manifest.embedding?.provider || "openai") !== embeddingConfig.provider
      || (embeddingConfig.provider === "ollama" && manifest.embedding?.inputVersion !== MULTIMODAL_INPUT_VERSION)
    ))
  );
  const mode = manifest?.mode === "hybrid" ? "hybrid" : manifest ? "rules" : "missing";
  const manifestGeneratedAt = Date.parse(manifest?.generatedAt || "");
  const attemptAt = Date.parse(attempt?.attemptedAt || "");
  const currentAttempt = attempt && (
    !Number.isFinite(manifestGeneratedAt)
    || (Number.isFinite(attemptAt) && attemptAt >= manifestGeneratedAt)
  )
    ? attempt
    : null;
  const fallbackCode = String(
    currentAttempt?.fallbackCode
    || manifest?.generation?.fallbackCode
    || "",
  );
  const degraded = Boolean(
    currentAttempt?.preservedLastGood
    || (
      manifest
      && mode === "rules"
      && embeddingConfig?.available
      && (fallbackCode || !manifest.generation)
    )
  );

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
    degraded,
    fallbackCode,
    lastAttemptAt: currentAttempt?.attemptedAt
      || manifest?.generation?.attemptedAt
      || manifest?.generatedAt
      || null,
    preservedLastGood: Boolean(currentAttempt?.preservedLastGood),
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
    generation = {},
    embeddingDetails = {},
  } = {},
) {
  const articles = documents.filter((document) => document.type === "article");
  const images = documents.filter((document) => document.type === "image");
  const recommendations = {};

  for (const document of documents) {
    const multimodal = mode === "hybrid" && embeddingDetails.inputVersion === MULTIMODAL_INPUT_VERSION;
    const source = document.entry;
    const sourceGroup = recommendationDocument(source).recommendationGroup;
    const articleEntries = articles
      .filter((candidate) => sourceGroup !== "adult-humor"
        || recommendationDocument(candidate.entry).recommendationGroup === "adult-humor")
      .map((candidate) => candidate.entry);
    const imageEntries = images.map((candidate) => candidate.entry);
    const articleLimit = document.type === "article" ? 12 : 8;
    const rankedArticles = mode === "hybrid" ? rankHybridCandidates(source, articleEntries, vectors) : [];
    const rankedImages = mode === "hybrid" ? rankHybridCandidates(source, imageEntries, vectors) : [];
    // Keep two close matches and one exploration choice at the front, then
    // retain ranked alternatives for browsers which have already seen them.
    const firstArticles = rulesFor(source, articleEntries, {
      limit: document.type === "article" ? 3 : 2,
      relatedSlots: mode === "hybrid" ? 0 : 2,
      allowSurprise: document.type === "article",
      preferredIds: rankedArticles.slice(0, 2).map((candidate) => candidate.id),
    });
    recommendations[document.id] = {
      ...(multimodal ? { sourceType: document.type } : {}),
      articles: multimodal && document.type === "image"
        ? rankedArticles.filter((candidate) => candidate.vector >= IMAGE_MIN_SIMILARITY).slice(0, articleLimit).map((candidate) => candidate.id)
        : rulesFor(source, articleEntries, {
        limit: articleLimit,
        relatedSlots: articleLimit,
        allowSurprise: false,
        preferredIds: [...new Set([...firstArticles, ...rankedArticles.map((candidate) => candidate.id)])],
      }),
      images: multimodal
        ? rankedImages.filter((candidate) => candidate.vector >= IMAGE_MIN_SIMILARITY).slice(0, 8).map((candidate) => candidate.id)
        : rulesFor(source, imageEntries, {
        limit: 8,
        relatedSlots: 8,
        allowSurprise: false,
        preferredIds: rankedImages.map((candidate) => candidate.id),
      }),
    };
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
      ...embeddingDetails,
    },
    ...(mode === "hybrid" && embeddingDetails.inputVersion === MULTIMODAL_INPUT_VERSION
      ? { selection: { imageMinSimilarity: IMAGE_MIN_SIMILARITY } } : {}),
    generation: {
      fallbackCode: String(generation.fallbackCode || ""),
      requestedModel: String(generation.requestedModel || model || ""),
      attemptedAt: String(generation.attemptedAt || generatedAt),
    },
    recommendations,
  };
}

async function embeddingVectors(documents, store, config, fetchImpl) {
  let modelDigest = "";
  if (config.provider === "ollama") {
    let response;
    try {
      response = await fetchImpl(config.endpoint.replace(/\/api\/embed$/u, "/api/tags"), {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new EmbeddingServiceError("EMBEDDING_REQUEST_FAILED", "Cannot inspect the Ollama model registry.", { cause: error });
    }
    if (!response.ok) throw new EmbeddingServiceError("EMBEDDING_REQUEST_FAILED", "Cannot inspect the Ollama model registry.");
    const payload = await response.json();
    const model = Array.isArray(payload?.models)
      ? payload.models.find((item) => item.name === config.model || item.name === `${config.model}:latest`) : null;
    if (!/^[a-f0-9]{64}$/u.test(model?.digest || "") || !model?.capabilities?.includes("embedding") || !model?.capabilities?.includes("vision")) {
      throw new EmbeddingServiceError("EMBEDDING_MODEL_INVALID", "The configured model must support vision and embeddings and have a valid digest.");
    }
    modelDigest = model.digest;
  }
  const cacheHash = (document) => config.provider === "ollama"
    ? createHash("sha256").update(`${config.provider}:${modelDigest}:${document.contentSha256}`).digest("hex")
    : document.contentSha256;
  const cache = new Map(
    store.listRecommendationEmbeddings({ model: config.model })
      .map((record) => [record.contentId, record]),
  );
  const vectors = new Map();
  const pending = [];
  const updates = [];
  let cacheHits = 0;
  for (const document of documents) {
    const cached = cache.get(document.id);
    if (cached?.contentSha256 === cacheHash(document) && validateEmbeddingVector(cached.vector)
      && (config.model !== DEFAULT_MULTIMODAL_MODEL || cached.vector.length === 2048)) {
      vectors.set(document.id, cached.vector);
      cacheHits += 1;
    } else {
      pending.push(document);
    }
  }

  for (let index = 0; index < pending.length; index += config.batchSize) {
    const batch = pending.slice(index, index + config.batchSize);
    let batchVectors;
    if (config.provider === "ollama") {
      batchVectors = [];
      for (const document of batch) {
        const members = [];
        for (const input of document.inputs) members.push((await requestEmbeddings([input], config, fetchImpl))[0]);
        const dimensions = members[0].length;
        if (members.some((vector) => vector.length !== dimensions)) {
          throw new EmbeddingServiceError("EMBEDDING_RESPONSE_INVALID", "Gallery embeddings have inconsistent dimensions.");
        }
        const combined = Array(dimensions).fill(0);
        for (const vector of members) {
          const norm = Math.hypot(...vector);
          for (let index = 0; index < dimensions; index += 1) combined[index] += vector[index] / norm / members.length;
        }
        if (!validateEmbeddingVector(combined)) throw new EmbeddingServiceError("EMBEDDING_RESPONSE_INVALID", "Gallery embedding is empty.");
        batchVectors.push(combined);
      }
    } else {
      batchVectors = await requestEmbeddings(batch.map((document) => document.input), config, fetchImpl);
    }
    for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
      const document = batch[itemIndex];
      const vector = batchVectors[itemIndex];
      vectors.set(document.id, vector);
      updates.push({
        contentId: document.id,
        contentType: document.type,
        contentSha256: cacheHash(document),
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
  for (const record of updates) store.upsertRecommendationEmbedding(record);
  const pruned = store.pruneRecommendationEmbeddings({
    model: config.model,
    validContentIds: documents.map((document) => document.id),
  });
  return { vectors, cacheHits, generated: pending.length, pruned, modelDigest };
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
  let documents = await loadPublicRecommendationContent(repoRoot);
  let config;
  try {
    config = getEmbeddingConfig(env);
  } catch (error) {
    if (requireEmbeddings) throw error;
    return {
      manifest: buildRecommendationManifest(documents, {
        generatedAt,
        generation: {
          fallbackCode: error.code || "EMBEDDING_CONFIG_INVALID",
          attemptedAt: generatedAt,
        },
      }),
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
      manifest: buildRecommendationManifest(documents, {
        generatedAt,
        generation: {
          fallbackCode: rulesOnly ? "" : "EMBEDDING_CONFIG_UNAVAILABLE",
          requestedModel: config.model,
          attemptedAt: generatedAt,
        },
      }),
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
    if (config.provider === "ollama") documents = await loadPublicRecommendationContent(repoRoot, { multimodal: true });
    const result = await embeddingVectors(documents, store, config, fetchImpl);
    return {
      manifest: buildRecommendationManifest(documents, {
        vectors: result.vectors,
        mode: "hybrid",
        model: config.model,
        embeddingDetails: config.provider === "ollama" ? {
          provider: "ollama", inputVersion: MULTIMODAL_INPUT_VERSION, modelDigest: result.modelDigest,
        } : {},
        generatedAt,
        generation: {
          requestedModel: config.model,
          attemptedAt: generatedAt,
        },
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
      manifest: buildRecommendationManifest(documents, {
        generatedAt,
        generation: {
          fallbackCode: error.code || "EMBEDDING_REQUEST_FAILED",
          requestedModel: config.model,
          attemptedAt: generatedAt,
        },
      }),
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
  requireEmbeddings = false,
  rulesOnly = false,
} = {}) {
  const before = await getRecommendationStatus({ repoRoot, env });
  if (!force && before.available && !before.stale && !before.degraded) {
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
    requireEmbeddings,
    rulesOnly,
  });
  const attempt = {
    attemptedAt: result.manifest.generatedAt,
    mode: result.summary.mode,
    fallbackCode: result.summary.fallbackCode || "",
    requestedModel: result.summary.model || String(env.XGIF_EMBEDDING_MODEL || "").trim(),
    preservedLastGood: false,
  };
  if (
    before.available
    && before.mode === "hybrid"
    && result.summary.mode === "rules"
    && result.summary.fallbackCode
    && !rulesOnly
  ) {
    attempt.preservedLastGood = true;
    await writeRecommendationAttempt(repoRoot, attempt);
    return {
      unchanged: true,
      preservedLastGood: true,
      summary: result.summary,
      status: await getRecommendationStatus({ repoRoot, env }),
    };
  }
  await writeRecommendationManifest(repoRoot, result.manifest);
  await writeRecommendationAttempt(repoRoot, attempt);
  return {
    unchanged: false,
    summary: result.summary,
    status: await getRecommendationStatus({ repoRoot, env }),
  };
}
