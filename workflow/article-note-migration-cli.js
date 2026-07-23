import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateArticleNote } from "./article-note-migration.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const articleRoot = path.resolve(workflowRoot, "..", "site", "src", "content", "articles");
const apply = process.argv.includes("--apply");
const files = (await readdir(articleRoot)).filter((file) => /\.mdx?$/iu.test(file)).sort();
const counts = { editorNote: 0, internalNote: 0 };

for (const file of files) {
  const filePath = path.join(articleRoot, file);
  const result = migrateArticleNote(await readFile(filePath, "utf8"));
  if (!result.changed) continue;
  counts[result.field] += 1;
  if (apply) await writeFile(filePath, result.markdown, "utf8");
}

console.log(`${apply ? "已迁移" : "可迁移"}公开编辑手记 ${counts.editorNote} 条、内部复核备注 ${counts.internalNote} 条。`);
