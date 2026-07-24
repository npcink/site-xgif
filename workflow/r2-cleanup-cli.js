import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./local-env.js";
import { reconcileR2Assets } from "./r2-reconciliation.js";
import { updateOrphanObservations } from "./r2-orphan-policy.js";
import { getR2StorageConfig } from "./r2-storage.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const siteRoot = path.join(repoRoot, "site");
const runtimeDirectory = path.join(workflowRoot, ".runtime");
const observationPath = path.join(runtimeDirectory, "r2-orphan-observations.json");
const ledgerPath = path.join(workflowRoot, "records", "r2-assets.jsonl");
const deletionLedgerPath = path.join(workflowRoot, "records", "r2-deletions.jsonl");
const requestedKey = process.argv[2] === "--confirm-delete" ? String(process.argv[3] || "") : "";

await loadLocalEnv(workflowRoot);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: siteRoot }, (error, stdout, stderr) => {
      if (error) {
        error.message = String(stderr || stdout || error.message).trim();
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

const report = await reconcileR2Assets({
  repoRoot,
  verifyRemote: true,
  verifyPrivateBackups: true,
});
const previous = await readJson(observationPath, {});
const policy = updateOrphanObservations({
  current: previous,
  orphanRows: report.ledgerWithoutReference,
});
await mkdir(runtimeDirectory, { recursive: true });
await writeFile(observationPath, `${JSON.stringify(policy.observations, null, 2)}\n`, "utf8");

if (!requestedKey) {
  console.log(JSON.stringify({
    mode: "dry-run",
    orphanCount: report.ledgerWithoutReference.length,
    eligibleAfter30Days: policy.eligible,
    note: "默认只观察。仅可用 --confirm-delete <完整对象键> 删除已连续观察满 30 天的单个对象。",
  }, null, 2));
  process.exit(0);
}

if (!/^memes\/[a-f0-9]{64}\.(?:jpg|png|gif|webp)$/u.test(requestedKey)) {
  throw new Error("拒绝删除：必须提供完整、规范的单个 memes/<sha256>.<ext> 对象键。");
}
const eligible = policy.eligible.find((row) => row.objectKey === requestedKey);
if (!eligible) throw new Error("拒绝删除：该对象仍被引用、尚未连续观察满 30 天，或不在台账中。");
const row = report.ledgerWithoutReference.find((item) => item.objectKey === requestedKey);
if (!row) throw new Error("拒绝删除：对账报告中没有这个孤立对象。");
if (report.remoteUnavailable.some((item) => item.publicUrl === row.publicUrl)) {
  throw new Error("拒绝删除：远端对象状态异常，必须先人工核实。");
}
if (report.privateBackupIssues.some((item) => item.publicUrl === row.publicUrl)) {
  throw new Error("拒绝删除：私有原始字节备份不完整。");
}

const storage = getR2StorageConfig({ env: process.env, siteRoot });
if (!storage.enabled) throw new Error("拒绝删除：R2 配置未启用。");
await run(storage.wranglerBin, [
  "r2", "object", "delete", `${storage.bucket}/${requestedKey}`, "--remote", "--force",
]);

const ledgerRows = (await readFile(ledgerPath, "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => ({ line, data: JSON.parse(line) }));
const retained = ledgerRows.filter(({ data }) => data.objectKey !== requestedKey);
if (retained.length === ledgerRows.length) throw new Error("R2 已删除，但本地台账未找到对应行；请立即人工核实。");
const temporary = `${ledgerPath}.${process.pid}.tmp`;
await writeFile(temporary, `${retained.map(({ line }) => line).join("\n")}\n`, "utf8");
await rename(temporary, ledgerPath);
await appendFile(deletionLedgerPath, `${JSON.stringify({
  objectKey: requestedKey,
  publicUrl: row.publicUrl,
  deletedAt: new Date().toISOString(),
  reason: "unreferenced-for-at-least-30-days",
})}\n`, "utf8");
console.log(JSON.stringify({ ok: true, deleted: requestedKey }, null, 2));
