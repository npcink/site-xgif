import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { galleryImages } from "../site/src/lib/image-gallery.mjs";
import { inspectR2PrivateBackup } from "./r2-private-backup.js";

const MAX_BYTES = 8 * 1024 * 1024;

/** Read verified local bytes only; recommendation generation never fetches image URLs. */
export async function recommendationImages(repoRoot, data) {
  const images = galleryImages(data);
  if (!images.length || images.length > 12) throw new Error("推荐图片必须包含 1–12 张可核验的图片。");
  let ledger;
  const result = [];
  for (const image of images) {
    let file;
    let expectedHash;
    if (image.src.startsWith("/") && !image.src.startsWith("//")) {
      const root = await realpath(path.join(repoRoot, "site/public"));
      file = await realpath(path.resolve(root, `.${image.src}`));
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error("推荐图片必须位于公开资源目录内。");
    } else {
      ledger ||= (await readFile(path.join(repoRoot, "workflow/records/r2-assets.jsonl"), "utf8"))
        .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
      const row = ledger.find((item) => item.publicUrl === image.src);
      if (!row) throw new Error("推荐图片缺少 R2 台账与可核验的本地字节。");
      const backup = await inspectR2PrivateBackup({ row, directory: path.join(repoRoot, "workflow/private-sources/r2-assets") });
      if (!backup.ok) throw new Error("推荐图片本地备份缺失或哈希不符。");
      file = backup.filePath;
      expectedHash = row.sha256;
    }
    const size = (await stat(file)).size;
    if (!size || size > MAX_BYTES) throw new Error("推荐图片必须大于 0 且不超过 8 MB。");
    const buffer = await readFile(file);
    if (buffer.length > MAX_BYTES) throw new Error("推荐图片超过 8 MB。");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (expectedHash && sha256 !== expectedHash) throw new Error("推荐图片字节在读取时发生变化。");
    const metadata = await sharp(buffer, { limitInputPixels: 36_000_000 }).metadata();
    if (!["jpeg", "png", "webp", "gif"].includes(metadata.format)) throw new Error("推荐图片格式不受支持。");
    // Animated images use their first displayed frame; source bytes are never rewritten.
    const png = await sharp(buffer, { pages: 1, limitInputPixels: 36_000_000 }).rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    result.push({ sha256, image: png.toString("base64"), altText: String(image.altText || "") });
  }
  return result;
}
