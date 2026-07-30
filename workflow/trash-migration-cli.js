import path from "node:path";
import { fileURLToPath } from "node:url";
import { migratePublicationTrashSidecars } from "./publication-deletions.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const result = await migratePublicationTrashSidecars({
  trashRoot: path.join(workflowRoot, "trash", "content"),
  apply,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
