import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseContentDocument } from "./content-audit.js";
import { inspectR2PrivateBackup } from "./r2-private-backup.js";

async function readJsonLines(filePath) {
  try {
    return (await readFile(filePath, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          return { invalid: true, line: index + 1 };
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function imageReferences({ repoRoot, imageDirectory, publicBaseUrl }) {
  const references = [];
  const files = (await readdir(imageDirectory))
    .filter((file) => /\.mdx?$/iu.test(file))
    .sort();
  for (const file of files) {
    const filePath = path.join(imageDirectory, file);
    const parsed = parseContentDocument(await readFile(filePath, "utf8"));
    const image = String(parsed?.data?.image || "");
    if (!image.startsWith(`${publicBaseUrl}/`)) continue;
    references.push({
      publicUrl: image,
      contentFile: path.relative(repoRoot, filePath).split(path.sep).join("/"),
    });
  }
  return references;
}

export async function reconcileR2Assets({
  repoRoot,
  imageDirectory = path.join(repoRoot, "site", "src", "content", "images"),
  ledgerPath = path.join(repoRoot, "workflow", "records", "r2-assets.jsonl"),
  publicBaseUrl = "https://img.xgif.cn",
  privateBackupDirectory = path.join(repoRoot, "workflow", "private-sources", "r2-assets"),
  verifyRemote = false,
  verifyPrivateBackups = false,
  fetchImpl = fetch,
} = {}) {
  const [references, ledger] = await Promise.all([
    imageReferences({ repoRoot, imageDirectory, publicBaseUrl }),
    readJsonLines(ledgerPath),
  ]);
  const validLedger = ledger.filter((row) => !row.invalid && row.publicUrl);
  const ledgerUrls = new Set(validLedger.map((row) => row.publicUrl));
  const referenceUrls = new Set(references.map((row) => row.publicUrl));
  const duplicateLedgerUrls = [...new Set(
    validLedger
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.publicUrl === row.publicUrl) !== index)
      .map((row) => row.publicUrl),
  )];

  const referencedWithoutLedger = references.filter((row) => !ledgerUrls.has(row.publicUrl));
  const ledgerWithoutReference = validLedger
    .filter((row) => !referenceUrls.has(row.publicUrl))
    .map((row) => ({
      publicUrl: row.publicUrl,
      objectKey: row.objectKey || "",
      contentFile: row.contentFile || "",
    }));
  const invalidLedgerLines = ledger.filter((row) => row.invalid).map((row) => row.line);
  const remoteUnavailable = [];
  const privateBackupIssues = [];

  if (verifyRemote) {
    for (const row of validLedger) {
      try {
        const response = await fetchImpl(row.publicUrl, {
          method: "HEAD",
          cache: "no-store",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000),
          headers: { referer: "https://www.xgif.cn/" },
        });
        if (!response.ok) remoteUnavailable.push({ publicUrl: row.publicUrl, status: response.status });
      } catch (error) {
        remoteUnavailable.push({ publicUrl: row.publicUrl, error: String(error.message || error) });
      }
    }
  }

  if (verifyPrivateBackups) {
    for (const row of validLedger) {
      const result = await inspectR2PrivateBackup({ row, directory: privateBackupDirectory });
      if (!result.ok) privateBackupIssues.push({ publicUrl: row.publicUrl, error: result.error });
    }
  }

  return {
    ok: !referencedWithoutLedger.length
      && !ledgerWithoutReference.length
      && !invalidLedgerLines.length
      && !remoteUnavailable.length
      && !privateBackupIssues.length,
    counts: {
      references: references.length,
      ledgerRows: validLedger.length,
      referencedWithoutLedger: referencedWithoutLedger.length,
      ledgerWithoutReference: ledgerWithoutReference.length,
      duplicateLedgerUrls: duplicateLedgerUrls.length,
      invalidLedgerLines: invalidLedgerLines.length,
      remoteUnavailable: remoteUnavailable.length,
      privateBackupIssues: privateBackupIssues.length,
    },
    referencedWithoutLedger,
    ledgerWithoutReference,
    duplicateLedgerUrls,
    invalidLedgerLines,
    remoteUnavailable,
    privateBackupIssues,
    note: "只读对账不会删除 R2 对象；远端存在性、私有备份和台账不一致项都需要人工确认后处理。",
  };
}
