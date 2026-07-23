import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseContentDocument } from "./content-audit.js";

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

  return {
    ok: !referencedWithoutLedger.length && !ledgerWithoutReference.length && !invalidLedgerLines.length,
    counts: {
      references: references.length,
      ledgerRows: validLedger.length,
      referencedWithoutLedger: referencedWithoutLedger.length,
      ledgerWithoutReference: ledgerWithoutReference.length,
      duplicateLedgerUrls: duplicateLedgerUrls.length,
      invalidLedgerLines: invalidLedgerLines.length,
    },
    referencedWithoutLedger,
    ledgerWithoutReference,
    duplicateLedgerUrls,
    invalidLedgerLines,
    note: "只读对账不会删除 R2 对象；不一致项需要人工确认后处理。",
  };
}
