import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { galleryReviewDigest } from "./gallery-ai.js";

const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

// Private receipts bind the preview to the final editable payload. The caller owns
// content serialization; AI never creates a receipt or decides to publish.
export class GalleryReviews {
  constructor(directory) { this.directory = directory; }
  async write(receipt) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(receipt.id);
    await writeFile(`${file}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  file(id) {
    if (!/^[a-f0-9-]{36}$/u.test(String(id))) throw conflict("发布预览凭据无效，请重新预览。");
    return path.join(this.directory, `${id}.json`);
  }
  async create(data, { job = null, file = "", version = "", contentId = "", markdownHash = "", warnings = [], assetHashes = [] } = {}) {
    const receipt = { id: randomUUID(), digest: galleryReviewDigest(data), jobId: job?.id || "", jobRevision: job?.revision ?? null,
      file, version, contentId, markdownHash, warnings, assetHashes, createdAt: new Date().toISOString(), result: null };
    await this.write(receipt);
    return receipt;
  }
  async read(id) {
    try { return JSON.parse(await readFile(this.file(id), "utf8")); }
    catch { throw conflict("发布预览已失效，请重新预览确认。图片与资料已保留。"); }
  }
  async authorize(data, { file = "", version = "", job = null } = {}) {
    const receipt = await this.read(data.galleryReviewId);
    if (receipt.digest !== galleryReviewDigest(data) || receipt.file !== file || receipt.version !== version
      || receipt.jobId !== (data.galleryAiJobId || "")) {
      throw conflict("图片、资料或编辑版本已改变，请重新预览确认。");
    }
    // A repeated successful request returns its receipt even after the AI progressed.
    if (receipt.result) return receipt;
    if (receipt.jobId && (!job || receipt.jobId !== job.id || receipt.jobRevision !== job.revision)) {
      throw conflict("AI 整理结果已更新，请重新预览确认。");
    }
    if (receipt.warnings.length && data.galleryWarningsConfirmed !== true) {
      throw conflict("请在发布预览中确认待检查项目。");
    }
    return receipt;
  }
  async complete(receipt, result) {
    receipt.result = result;
    await this.write(receipt);
    return result;
  }
}
