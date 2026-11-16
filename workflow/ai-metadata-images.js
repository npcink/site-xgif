import sharp from "sharp";
import { verifiedImageBytes } from "./recommendation-images.js";
import { hash, requireCondition } from "./ai-metadata-contract.js";

export const VISUAL_VERSION = "metadata-ordered-frames-v1";
export async function metadataImages(repoRoot, kind, data, { frames = 12 } = {}) {
  requireCondition(Number.isInteger(frames) && frames >= 2 && frames <= 24, "Animation frame budget must be 2–24");
  if (kind === "article" && !data.coverImage) return [];
  const assets = await verifiedImageBytes(repoRoot, kind === "article" ? { image: data.coverImage } : data);
  const images = []; let totalBytes = 0;
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index]; const totalFrames = asset.metadata.pages || 1;
    const count = Math.min(totalFrames, frames);
    const pages = [...new Set(Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (totalFrames - 1) / (count - 1))))];
    for (const frame of pages) {
      const bytes = await sharp(asset.buffer, { page: frame, pages: 1, limitInputPixels: 36_000_000 }).rotate()
        .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      totalBytes += bytes.length;
      requireCondition(totalBytes <= 24 * 1024 * 1024, "Visual input exceeds 24 MB; reduce frame budget explicitly");
      images.push({ sourceIndex: index, source: asset.src, sourceHash: asset.sha256, frame, totalFrames,
        sha256: hash(bytes), base64: bytes.toString("base64") });
    }
  }
  return images;
}
