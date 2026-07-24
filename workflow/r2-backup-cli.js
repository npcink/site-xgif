import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupR2LedgerAssets } from "./r2-private-backup.js";
import { LocalContentBackup } from "./local-content-backup.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const ledgerPath = path.join(workflowRoot, "records", "r2-assets.jsonl");
const rows = (await readFile(ledgerPath, "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const directory = path.join(workflowRoot, "private-sources", "r2-assets");
const results = await backupR2LedgerAssets({ rows, directory });
const contentBackup = new LocalContentBackup({ repoRoot, workflowRoot });
const offsite = await contentBackup.snapshot("Back up R2 source bytes");

console.log(JSON.stringify({
  ok: true,
  total: results.length,
  created: results.filter((item) => item.created).length,
  directory: path.relative(repoRoot, directory),
  offsite,
}, null, 2));
