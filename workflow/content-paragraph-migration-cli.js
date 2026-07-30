import path from "node:path";
import { fileURLToPath } from "node:url";
import { migratePublishedArticleParagraphs } from "./content-paragraph-migration.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");

try {
  const result = await migratePublishedArticleParagraphs({
    repoRoot,
    apply: process.argv.includes("--apply"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    blocked: error.blocked || [],
  }, null, 2));
  process.exitCode = 1;
}
