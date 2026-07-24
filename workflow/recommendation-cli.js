import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDataStore } from "./local-data-store.js";
import { loadLocalEnv } from "./local-env.js";
import {
  generateRecommendationManifest,
  recommendationManifestPath,
  writeRecommendationManifest,
} from "./recommendation-engine.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(workflowRoot);
const outputPath = recommendationManifestPath(repoRoot);
const flags = new Set(process.argv.slice(2));
await loadLocalEnv(workflowRoot);
const store = new LocalDataStore({ repoRoot, workflowRoot });

try {
  await store.initialize();
  const result = await generateRecommendationManifest({
    repoRoot,
    store,
    requireEmbeddings: flags.has("--require-embeddings"),
    rulesOnly: flags.has("--rules-only"),
  });
  await writeRecommendationManifest(repoRoot, result.manifest);
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(repoRoot, outputPath),
    ...result.summary,
  }));
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
