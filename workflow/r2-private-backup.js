import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([".jpg", ".png", ".gif", ".webp"]);

function backupFilePath(directory, sha256, objectKey) {
  const hash = String(sha256 || "").toLowerCase();
  const extension = path.extname(String(objectKey || "")).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash) || !supportedExtensions.has(extension)) {
    throw new Error("R2 私有备份缺少有效的哈希或扩展名。");
  }
  return path.join(directory, `${hash}${extension}`);
}

async function writeBufferAtomic(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, buffer);
  await rename(temporaryPath, filePath);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function saveR2PrivateBackup({ asset, objectKey, directory }) {
  const filePath = backupFilePath(directory, asset.sha256, objectKey);
  try {
    const existing = await readFile(filePath);
    if (sha256(existing) !== asset.sha256) {
      throw new Error(`R2 私有备份哈希冲突：${path.basename(filePath)}`);
    }
    return { filePath, created: false };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeBufferAtomic(filePath, asset.buffer);
  return { filePath, created: true };
}

export async function inspectR2PrivateBackup({ row, directory }) {
  try {
    const filePath = backupFilePath(directory, row.sha256, row.objectKey);
    const buffer = await readFile(filePath);
    const actualHash = sha256(buffer);
    return actualHash === row.sha256
      ? { ok: true, filePath, byteLength: buffer.length }
      : { ok: false, filePath, error: "hash-mismatch" };
  } catch (error) {
    return {
      ok: false,
      filePath: "",
      error: error?.code === "ENOENT" ? "missing" : String(error.message || error),
    };
  }
}

export async function backupR2LedgerAssets({
  rows,
  directory,
  fetchImpl = fetch,
  maxBytes = 10 * 1024 * 1024,
}) {
  const results = [];
  for (const row of rows) {
    const current = await inspectR2PrivateBackup({ row, directory });
    if (current.ok) {
      results.push({ ...current, publicUrl: row.publicUrl, created: false });
      continue;
    }
    const response = await fetchImpl(row.publicUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { referer: "https://www.xgif.cn/" },
    });
    if (!response.ok) throw new Error(`R2 私有备份下载失败：${row.publicUrl}（HTTP ${response.status}）`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`R2 私有备份对象超过 ${maxBytes} 字节限制。`);
    if (row.byteLength && Number(row.byteLength) !== buffer.length) {
      throw new Error(`R2 私有备份大小不一致：${row.publicUrl}`);
    }
    if (sha256(buffer) !== row.sha256) throw new Error(`R2 私有备份哈希不一致：${row.publicUrl}`);
    const saved = await saveR2PrivateBackup({
      asset: { sha256: row.sha256, buffer },
      objectKey: row.objectKey,
      directory,
    });
    results.push({
      ok: true,
      filePath: saved.filePath,
      byteLength: buffer.length,
      publicUrl: row.publicUrl,
      created: saved.created,
    });
  }
  return results;
}
