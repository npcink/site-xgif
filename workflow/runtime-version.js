import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function publisherSourceFiles(workflowRoot) {
  const files = readdirSync(workflowRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".js") || entry.name === "package.json"))
    .map((entry) => path.join(workflowRoot, entry.name));
  const migrationsDirectory = path.join(workflowRoot, "db", "migrations");
  try {
    files.push(
      ...readdirSync(migrationsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => path.join(migrationsDirectory, entry.name)),
    );
  } catch {
    // A checkout without migrations is still versionable.
  }
  return files.sort();
}

export function publisherSourceVersion(workflowRoot) {
  const hash = createHash("sha256");
  for (const file of publisherSourceFiles(workflowRoot)) {
    hash.update(path.relative(workflowRoot, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
