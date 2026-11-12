import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDataStore } from "./local-data-store.js";
import { loadLocalEnv } from "./local-env.js";
import {
  refreshRecommendationManifest,
  recommendationManifestPath,
} from "./recommendation-engine.js";
import { withToolLock } from "./tool-lock.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(workflowRoot);
const outputPath = recommendationManifestPath(repoRoot);
const flags = new Set(process.argv.slice(2));
await loadLocalEnv(workflowRoot);
const store = new LocalDataStore({ repoRoot, workflowRoot });

try {
  const result = await withToolLock(workflowRoot, async () => {
    await store.initialize();
    return refreshRecommendationManifest({
      repoRoot,
      store,
      force: true,
      requireEmbeddings: flags.has("--require-embeddings"),
      rulesOnly: flags.has("--rules-only"),
    });
  });
  console.log(JSON.stringify({
    ok: !result.preservedLastGood,
    preservedLastGood: Boolean(result.preservedLastGood),
    output: path.relative(repoRoot, outputPath),
    ...result.summary,
  }));
  if (result.preservedLastGood) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || "RECOMMENDATION_BUILD_FAILED",
    message: String(error?.message || error),
  }));
  process.exitCode = 1;
} finally {
  store.close();
}
