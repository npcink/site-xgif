import path from "node:path";
import { fileURLToPath } from "node:url";
import { migratePublishedContentDebt } from "./content-debt-migration.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const result = await migratePublishedContentDebt({
  repoRoot,
  apply: process.argv.includes("--apply"),
});

console.log(JSON.stringify(result, null, 2));
