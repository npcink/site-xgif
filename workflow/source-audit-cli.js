import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditArticleMarkdown } from "./article-source-audit.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const articleRoot = path.join(repoRoot, "site", "src", "content", "articles");
const flomoLedger = path.join(workflowRoot, "records", "flomo-imports.jsonl");
const apply = process.argv.includes("--apply");

const files = (await readdir(articleRoot)).filter((file) => /\.(?:md|mdx)$/iu.test(file)).sort();
const report = [];
const importTagsByFile = new Map();

for (const file of files) {
  const filePath = path.join(articleRoot, file);
  const markdown = await readFile(filePath, "utf8");
  const result = auditArticleMarkdown(markdown);
  if (!result.changed && result.issues.length === 0) continue;
  if (apply && result.changed) await writeFile(filePath, result.markdown, "utf8");
  if (result.importTags.length) importTagsByFile.set(path.relative(repoRoot, filePath), result.importTags);
  report.push({
    file: path.relative(repoRoot, filePath),
    changed: result.changed,
    applied: apply && result.changed,
    actions: result.actions,
    issues: result.issues,
  });
}

let updatedLedgerRecords = 0;
if (apply && importTagsByFile.size) {
  const records = (await readFile(flomoLedger, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const record of records) {
    const importTags = importTagsByFile.get(String(record.contentFile || ""));
    if (!importTags?.length) continue;
    record.importTags = [...new Set([...(record.importTags || []), ...importTags])];
    updatedLedgerRecords += 1;
  }
  await writeFile(flomoLedger, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

const changed = report.filter((item) => item.changed).length;
const needsReview = report.filter((item) => item.issues.length).length;
console.log(`${apply ? "已应用" : "可应用"} ${changed} 条安全修复；${needsReview} 条仍需人工确认。`);
if (updatedLedgerRecords) console.log(`已把内部导入分组写回 ${updatedLedgerRecords} 条 flomo 台账记录。`);
for (const item of report) {
  console.log(`\n${item.file}`);
  for (const action of item.actions) console.log(`  - ${action}${item.applied ? "（已应用）" : ""}`);
  for (const issue of item.issues) console.log(`  - 待确认：${issue}`);
}
