import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileR2Assets } from "./r2-reconciliation.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const report = await reconcileR2Assets({
  repoRoot,
  verifyRemote: true,
  verifyPrivateBackups: true,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
