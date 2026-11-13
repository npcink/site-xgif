import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ImageSimilarityIndex } from "./image-similarity.js";
import { findSemanticSeriesMatches } from "./series-embeddings.js";
import { loadLocalEnv } from "./local-env.js";
import { ensureR2Asset, getR2StorageConfig, r2ObjectKey, r2PublicUrl } from "./r2-storage.js";
import { saveR2PrivateBackup } from "./r2-private-backup.js";
import { safeProcessError } from "./safe-process-error.js";
import { withToolLock } from "./tool-lock.js";

export async function inspectImageFile(file) {
  const size = (await stat(file)).size;
  if (!size || size > 8 * 1024 * 1024) throw new Error("图片必须大于 0 且不超过 8 MB。");
  const buffer = await readFile(file);
  const metadata = await sharp(buffer, { limitInputPixels: 36_000_000 }).metadata();
  const extension = { jpeg: ".jpg", png: ".png", gif: ".gif", webp: ".webp" }[metadata.format];
  if (!extension) throw new Error("仅支持 JPEG、PNG、GIF 和 WebP。");
  const { width, height } = metadata.autoOrient;
  if (width < 160 || height < 160 || width > 6000 || height > 6000) throw new Error("图片单边必须在 160–6000 像素之间。");
  return { buffer, width, height, extension, mime: `image/${metadata.format}`, byteLength: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex") };
}

export async function runImageTool({ repoRoot, file, upload = false, apply = false, reviewedSha256 = "", env = process.env, storeAsset = ensureR2Asset, fetchImpl = globalThis.fetch }) {
  const workflowRoot = path.join(repoRoot, "workflow");
  await loadLocalEnv(workflowRoot, { env });
  return withToolLock(workflowRoot, async () => {
    const asset = await inspectImageFile(file);
    const { buffer, ...metadata } = asset;
    const semanticSeries = await findSemanticSeriesMatches({ repoRoot, buffer, env, fetchImpl });
    const { matches: semanticMatches, ...seriesEmbedding } = semanticSeries;
    const similarity = await new ImageSimilarityIndex({ repoRoot }).check({ buffer, seriesMatches: semanticMatches });
    similarity.seriesEmbedding = seriesEmbedding;
    try {
      await appendFile(path.join(workflowRoot, ".runtime/image-checks.jsonl"), JSON.stringify({
        schemaVersion: 1, checkedAt: new Date().toISOString(),
        requestedAction: upload && apply ? "upload" : "check",
        reviewed: reviewedSha256 === asset.sha256, ...metadata, similarity,
      }) + "\n", { mode: 0o600 });
      similarity.checkRecordSaved = true;
    } catch { similarity.checkRecordSaved = false; }
    if (!upload || !apply) return { ok: true, mode: "dry-run", ...metadata, similarity };
    const requiresSeriesReview = similarity.seriesCandidates.some((candidate) => candidate.requiresReview);
    if ((similarity.matches.some((match) => match.kind === "similar") || requiresSeriesReview || similarity.unavailable || semanticSeries.status === "partial")
      && reviewedSha256 !== asset.sha256) throw new Error("请先对照相似候选和未检查项，再传入 --reviewed-sha256 <本次图片哈希>。");
    const siteRoot = path.join(repoRoot, "site");
    const config = getR2StorageConfig({ siteRoot, env });
    if (!config.enabled) throw new Error("请先在 workflow/.env 启用并配置 R2。");
    const objectKey = r2ObjectKey(asset);
    const ledgerPath = path.join(workflowRoot, "records/r2-assets.jsonl");
    const ledgerText = await readFile(ledgerPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const rows = ledgerText.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    const existing = rows.find((row) => row.sha256 === asset.sha256 && row.bucket === config.bucket && row.objectKey === objectKey);
    // Preserve source bytes before uploading; a failed upload can be retried safely.
    await saveR2PrivateBackup({ asset, objectKey, directory: path.join(workflowRoot, "private-sources/r2-assets") });
    if (existing && existing.publicUrl === r2PublicUrl(config, objectKey)) {
      return { ok: true, reused: true, ...metadata, publicUrl: existing.publicUrl, objectKey, similarity };
    }
    const stored = await storeAsset({ asset, config, siteRoot });
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const row = { schemaVersion: 1, storage: "cloudflare-r2", bucket: config.bucket, objectKey: stored.objectKey, publicUrl: stored.publicUrl,
      sha256: asset.sha256, mime: asset.mime, byteLength: asset.byteLength, uploadedAt: new Date().toISOString(), contentFile: "" };
    await appendFile(ledgerPath, `${ledgerText && !ledgerText.endsWith("\n") ? "\n" : ""}${JSON.stringify(row)}\n`);
    return { ok: true, ...metadata, ...stored, similarity };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file, ...args] = process.argv.slice(2);
  if (command === "--help" || file === "--help") {
    console.log("image:check -- <图片路径>\nimage:upload -- <图片路径> [--apply] [--reviewed-sha256 <图片哈希>]\n默认只检查；结果中的 seriesCandidates 只生成系列候选，不会自动合并。上传返回可复用 URL，不创建内容、不推测来源和授权。");
  } else {
    try {
      const reviewedIndex = args.indexOf("--reviewed-sha256");
      if (reviewedIndex >= 0 && !/^[a-f0-9]{64}$/u.test(args[reviewedIndex + 1] || "")) throw new Error("请提供完整图片 SHA-256。");
      if (!["check", "upload"].includes(command) || !file || args.some((arg, index) => arg !== "--apply" && !(reviewedIndex >= 0 && (index === reviewedIndex || index === reviewedIndex + 1)))) throw new Error("参数无效，请使用 --help。");
      const result = await runImageTool({ repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
        file: path.resolve(file), upload: command === "upload", apply: args.includes("--apply"),
        reviewedSha256: reviewedIndex >= 0 ? args[reviewedIndex + 1] : "" });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(safeProcessError(error));
      process.exitCode = 1;
    }
  }
}
