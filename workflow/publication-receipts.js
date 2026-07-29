import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeProcessError } from "./safe-process-error.js";

function normalizedFile(value) {
  return String(value || "").replaceAll("\\", "/").trim();
}

function parsedLines(value) {
  return String(value || "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        const invalid = new Error(`发布回执第 ${index + 1} 行损坏，已停止推断发布状态。`);
        invalid.cause = error;
        invalid.statusCode = 500;
        throw invalid;
      }
    });
}

export function publicationReceiptState(receipt = {}) {
  if (receipt.state) return String(receipt.state);
  return receipt.pushOk ? "push_succeeded" : "push_failed";
}

export function contentSha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function assertExpectedContentVersion(expected, actual) {
  const normalizedExpected = String(expected || "").trim();
  if (!normalizedExpected || normalizedExpected === actual) return;
  const error = new Error("内容已在其他页面或操作中发生变化，请重新打开后再保存。");
  error.statusCode = 409;
  error.detail = "为避免覆盖较新的 Markdown，当前修改没有写入。";
  throw error;
}

export async function assertFileContentVersion(filePath, expectedContentSha256) {
  const actualContentSha256 = contentSha256(await readFile(filePath, "utf8"));
  assertExpectedContentVersion(expectedContentSha256, actualContentSha256);
  return actualContentSha256;
}

export class PublicationReceiptStore {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async list() {
    try {
      return parsedLines(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async latestByFileAndHash(items = []) {
    const wanted = new Map(
      items.map((item) => [
        normalizedFile(item.file),
        String(item.contentSha256 || ""),
      ]),
    );
    const latest = new Map();
    for (const receipt of await this.list()) {
      const file = normalizedFile(receipt.file);
      if (!wanted.has(file) || wanted.get(file) !== receipt.contentSha256) continue;
      latest.set(file, receipt);
    }
    return latest;
  }

  async batchForReceipt(receipt) {
    if (!receipt) return [];
    const records = await this.list();
    const matching = receipt.batchId
      ? records.filter((item) => item.batchId === receipt.batchId)
      : records.filter((item) => (
        item.recordedAt === receipt.recordedAt
        && item.branch === receipt.branch
        && item.commitSha === receipt.commitSha
        && item.pushOk === receipt.pushOk
      ));
    const latestByFile = new Map();
    for (const item of matching) latestByFile.set(normalizedFile(item.file), item);
    return [...latestByFile.values()];
  }

  async appendBatch({
    action,
    branch,
    commitSha,
    push,
    items,
    state = push?.ok ? "push_succeeded" : "push_failed",
    batchId = randomUUID(),
  }) {
    const recordedAt = new Date().toISOString();
    const records = items.map((item) => ({
      schemaVersion: 1,
      receiptId: randomUUID(),
      batchId,
      action,
      state,
      recordedAt,
      file: normalizedFile(item.file),
      contentId: String(item.contentId || ""),
      contentSha256: String(item.contentSha256 || ""),
      branch: String(branch || ""),
      commitSha: String(commitSha || ""),
      pushOk: Boolean(push?.ok),
      pushError: push?.ok || state === "prepared"
        ? ""
        : safeProcessError(push?.error, { fallback: "推送失败。" }),
    }));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(this.filePath, "utf8");
      parsedLines(existing);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    try {
      await writeFile(
        temporaryPath,
        `${existing}${separator}${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    return records;
  }
}
