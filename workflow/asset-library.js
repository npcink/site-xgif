import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseContentDocument } from "./content-audit.js";
import { inspectR2PrivateBackup } from "./r2-private-backup.js";

async function readJsonLines(filePath) {
  try {
    return (await readFile(filePath, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function localAssetDetails(repoRoot, image) {
  const filePath = path.join(repoRoot, "site", "public", image.replace(/^\/+/u, ""));
  try {
    await access(filePath);
    const [buffer, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
    return {
      storage: "local",
      sha256: createHash("sha256").update(buffer).digest("hex"),
      bytes: metadata.size,
      backup: { ok: true, label: "公开仓库文件可用" },
    };
  } catch {
    return {
      storage: "local",
      sha256: "",
      bytes: 0,
      backup: { ok: false, label: "本地文件缺失" },
    };
  }
}

async function remoteAssetDetails({ image, ledger, privateBackupDirectory }) {
  const row = ledger.find((entry) => entry.publicUrl === image);
  if (!row) {
    return {
      storage: "external",
      sha256: "",
      bytes: 0,
      backup: { ok: false, label: "外部地址或缺少 R2 台账" },
    };
  }
  const backup = await inspectR2PrivateBackup({ row, directory: privateBackupDirectory });
  return {
    storage: "r2",
    sha256: String(row.sha256 || ""),
    bytes: Number(row.byteLength || 0),
    objectKey: String(row.objectKey || ""),
    backup: { ok: backup.ok, label: backup.ok ? "私有原始字节已备份" : "私有原始字节待备份" },
  };
}

export async function listReusableAssets({
  repoRoot,
  imageDirectory = path.join(repoRoot, "site", "src", "content", "images"),
  ledgerPath = path.join(repoRoot, "workflow", "records", "r2-assets.jsonl"),
  privateBackupDirectory = path.join(repoRoot, "workflow", "private-sources", "r2-assets"),
} = {}) {
  const [files, ledger] = await Promise.all([
    readdir(imageDirectory).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error)),
    readJsonLines(ledgerPath),
  ]);
  const items = [];
  for (const file of files.filter((name) => /\.mdx?$/iu.test(name)).sort()) {
    const filePath = path.join(imageDirectory, file);
    const parsed = parseContentDocument(await readFile(filePath, "utf8"));
    if (!parsed) continue;
    const image = String(parsed.data.image || "");
    if (!image) continue;
    const details = image.startsWith("/")
      ? await localAssetDetails(repoRoot, image)
      : await remoteAssetDetails({ image, ledger, privateBackupDirectory });
    items.push({
      contentId: String(parsed.data.contentId || path.basename(file, path.extname(file))),
      title: String(parsed.data.title || "未命名素材"),
      description: String(parsed.data.description || ""),
      image,
      width: Number(parsed.data.width || 0),
      height: Number(parsed.data.height || 0),
      ratio: String(parsed.data.ratio || ""),
      source: String(parsed.data.source || ""),
      sourceKind: String(parsed.data.sourceKind || "unknown"),
      author: String(parsed.data.author || ""),
      license: String(parsed.data.license || ""),
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      draft: Boolean(parsed.data.draft) || parsed.data.public === false,
      file: path.relative(repoRoot, filePath).split(path.sep).join("/"),
      ...details,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      total: items.length,
      reusable: items.filter((item) => item.backup.ok && !item.draft).length,
      local: items.filter((item) => item.storage === "local").length,
      r2: items.filter((item) => item.storage === "r2").length,
      attention: items.filter((item) => !item.backup.ok || item.draft).length,
    },
    items: items.sort((left, right) => right.contentId.localeCompare(left.contentId)),
  };
}
