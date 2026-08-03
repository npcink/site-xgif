import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditContentLibrary,
  contentAuditSummary,
  renderContentAuditMarkdown,
} from "./content-audit.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const writeReports = process.argv.includes("--write");
const report = await auditContentLibrary({ repoRoot });

console.log(contentAuditSummary(report));

if (writeReports) {
  const outputRoot = path.join(workflowRoot, "records");
  const jsonPath = path.join(outputRoot, "content-audit-latest.json");
  const markdownPath = path.join(outputRoot, "content-audit-latest.md");
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderContentAuditMarkdown(report), "utf8"),
  ]);
  console.log(`已写入 ${path.relative(repoRoot, markdownPath)} 与 ${path.relative(repoRoot, jsonPath)}。`);
}
