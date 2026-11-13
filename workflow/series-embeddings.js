import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { galleryImages } from "../site/src/lib/image-gallery.mjs";
import { parseContentDocument } from "./content-audit.js";
import { getEmbeddingConfig, requestEmbeddings, DEFAULT_MULTIMODAL_MODEL } from "./recommendation-engine.js";
import { recommendationImages } from "./recommendation-images.js";
import { cosineSimilarity, SERIES_MIN_EMBEDDING_SIMILARITY } from "./series-candidates.js";
import { withEmbeddingConnection } from "./embedding-connection.js";

export const SERIES_INPUT_VERSION = "qwen3-vl-series-pixels-v1";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const validVector = vector => Array.isArray(vector) && vector.length > 0
  && vector.every(Number.isFinite) && vector.some(value => value !== 0);
const statusResult = (status, reason) => ({ status, reason, matches: [] });

async function saveCache(file, cache) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(cache) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

/**
 * Match current gallery members using verified source pixels. Recommendation
 * vectors pool entire galleries and may predate a new upload, so they cannot
 * serve as the member index. Only derived image vectors are cached here.
 */
export async function findSemanticSeriesMatches({
  repoRoot,
  buffer,
  env = process.env,
  excludeFile = "",
  excludeImageHashes = [],
  fetchImpl = globalThis.fetch,
  minimumSimilarity = SERIES_MIN_EMBEDDING_SIMILARITY,
} = {}) {
  if (String(env.XGIF_SERIES_EMBEDDINGS || "auto").toLowerCase() === "off") return statusResult("disabled", "");
  let config;
  try { config = getEmbeddingConfig(env); }
  catch (error) { return statusResult("unavailable", error.code || "EMBEDDING_CONFIG_INVALID"); }
  if (!config.available) return statusResult("unavailable", "EMBEDDING_CONFIG_UNAVAILABLE");
  if (config.provider !== "ollama") return statusResult("unavailable", "EMBEDDING_PROVIDER_UNSUPPORTED");

  try {
    return await withEmbeddingConnection(config, env, async () => {
      const response = await fetchImpl(config.endpoint.replace(/\/api\/embed$/u, "/api/tags"), {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) throw Object.assign(new Error(), { code: "EMBEDDING_REQUEST_FAILED" });
      const registry = await response.json();
      const model = registry?.models?.find(item => item.name === config.model || item.name === `${config.model}:latest`);
      if (!/^[a-f0-9]{64}$/u.test(model?.digest || "") || !model?.capabilities?.includes("embedding") || !model?.capabilities?.includes("vision")) {
        return statusResult("unavailable", "EMBEDDING_MODEL_INVALID");
      }
      const identity = { version: 1, inputVersion: SERIES_INPUT_VERSION, model: config.model, modelDigest: model.digest };
      const cacheFile = path.join(repoRoot, "workflow/.runtime/series-image-embeddings-v1.json");
      let cached;
      try { cached = JSON.parse(await readFile(cacheFile, "utf8")); } catch { /* Disposable derived cache. */ }
      const vectors = new Map();
      if (Object.entries(identity).every(([key, value]) => cached?.[key] === value)) {
        for (const [hash, vector] of Object.entries(cached?.vectors || {})) {
          if (/^[a-f0-9]{64}$/u.test(hash) && validVector(vector)
            && (config.model !== DEFAULT_MULTIMODAL_MODEL || vector.length === 2048)) vectors.set(hash, vector);
        }
      }
      let cacheHits = 0;
      let generated = 0;
      let dimensions;
      const used = new Map();
      const encode = async (hash, image) => {
        let vector = vectors.get(hash);
        if (vector) cacheHits++;
        else {
          vector = (await requestEmbeddings([{ text: "", image }], config, fetchImpl))[0];
          vectors.set(hash, vector);
          generated++;
        }
        if (dimensions !== undefined && dimensions !== vector.length) throw Object.assign(new Error(), { code: "EMBEDDING_RESPONSE_INVALID" });
        dimensions = vector.length;
        used.set(hash, vector);
        return vector;
      };
      const queryHash = digest(buffer);
      const excluded = new Set([...excludeImageHashes, queryHash]);
      const png = await sharp(buffer, { pages: 1, limitInputPixels: 36_000_000 })
        .rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      const query = await encode(queryHash, png.toString("base64"));
      const directory = path.join(repoRoot, "site/src/content/images");
      const files = await readdir(directory).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
      const matches = [];
      let checkedMembers = 0;
      let checkedContents = 0;
      let unavailableContents = 0;
      for (const name of files.filter(name => /\.md$/iu.test(name)).sort()) {
        const file = `site/src/content/images/${name}`;
        if (file === excludeFile) continue;
        let data;
        let images;
        try {
          data = parseContentDocument(await readFile(path.join(directory, name), "utf8")).data;
          if (data.draft || data.public === false) continue;
          images = await recommendationImages(repoRoot, data);
        } catch { unavailableContents++; continue; }
        checkedContents++;
        for (const [memberIndex, image] of images.entries()) {
          // Exact bytes are handled by duplicate checking, never as semantic proof.
          if (excluded.has(image.sha256)) continue;
          const vector = await encode(image.sha256, image.image);
          checkedMembers++;
          const score = cosineSimilarity(query, vector);
          if (score < minimumSimilarity) continue;
          matches.push({
            file, contentId: String(data.contentId || ""), title: String(data.title || "未命名图片"),
            image: galleryImages(data)[memberIndex].src, memberIndex, memberCount: images.length,
            kind: "semantic", embeddingSimilarity: score,
          });
        }
      }
      let cacheSaved = true;
      try { await saveCache(cacheFile, { ...identity, vectors: Object.fromEntries(used) }); }
      catch { cacheSaved = false; }
      return {
        status: unavailableContents ? "partial" : "ready",
        ...(unavailableContents ? { reason: "IMAGE_BYTES_UNAVAILABLE" } : {}),
        model: config.model, modelDigest: model.digest, inputVersion: SERIES_INPUT_VERSION,
        minimumSimilarity, dimensions, checkedContents, checkedMembers, unavailableContents,
        cacheHits, generated, cacheSaved,
        matches: matches.sort((a, b) => b.embeddingSimilarity - a.embeddingSimilarity || a.file.localeCompare(b.file)),
      };
    });
  } catch (error) {
    return statusResult("unavailable", error.code || "EMBEDDING_REQUEST_FAILED");
  }
}
