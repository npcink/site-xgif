import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadPublicRecommendationContent, readRecommendationManifest, recommendationSourceHash, MULTIMODAL_INPUT_VERSION } from "./recommendation-engine.js";
import { bindOfflineImageFingerprints, verifyRecommendationPublication } from "./recommendation-verify.js";
import { publicationEvidenceHash } from "./recommendation-publication.js";
import { withToolLock } from "./tool-lock.js";
const hash = value => createHash("sha256").update(value).digest("hex");

/** Named consumer export. Never generates vectors or sends source material to a service. */
export async function exportRecommendationQuality(repoRoot) {
  await verifyRecommendationPublication(repoRoot);
  const manifest = await readRecommendationManifest(repoRoot);
  if (manifest.mode !== "hybrid" || manifest.embedding.provider !== "ollama" || manifest.embedding.inputVersion !== MULTIMODAL_INPUT_VERSION) throw new Error("评测需要当前版本的本地多模态清单与匹配缓存");
  const docs = bindOfflineImageFingerprints(await loadPublicRecommendationContent(repoRoot), manifest);
  if (recommendationSourceHash(docs) !== manifest.sourceHash || publicationEvidenceHash(docs) !== manifest.publication.sourceHash) throw new Error("导出过程中原始依据变化");
  const eligible = docs.filter(doc => !doc.excludedUpscale);
  const db = new DatabaseSync(path.join(repoRoot, "workflow/.runtime/xgif.sqlite3"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT content_id, content_sha256, vector_json FROM recommendation_embeddings WHERE model = ?").all(manifest.embedding.model);
    const documents = eligible.map(doc => {
      const row = rows.find(row => row.content_id === doc.id);
      const expected = hash(`ollama:${manifest.embedding.modelDigest}:${doc.contentSha256}`);
      if (!row || row.content_sha256 !== expected) throw new Error(`缺少匹配原始依据的缓存：${doc.id}`);
      const vector = JSON.parse(row.vector_json);
      if (vector.length !== manifest.embedding.dimensions || !vector.every(Number.isFinite) || !vector.some(value => value !== 0)) throw new Error(`缓存向量无效：${doc.id}`);
      return { id: doc.id, type: doc.type, group: doc.publicationEvidence[3], sourceHash: hash(JSON.stringify(doc.publicationEvidence)), evidence: doc.publicationEvidence,
        body: doc.entry.body, images: doc.type === "image" ? doc.publicationEvidence[2] : [], vector };
    });
    const sourceHash = recommendationSourceHash(eligible);
    const evaluationManifest = {
      ...manifest,
      sourceHash,
      publication: { ...manifest.publication, sourceHash: publicationEvidenceHash(eligible) },
      recommendations: Object.fromEntries(eligible.map(doc => [doc.id, manifest.recommendations[doc.id]])),
    };
    return { schemaVersion: "xgif.recommendation-input.v1", identity: manifest.embedding, sourceHash, manifest: evaluationManifest, documents };
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: "string" }, output: { type: "string" } } });
    const repoRoot = path.resolve(values.root || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
    const output = path.resolve(values.output || path.join(repoRoot, "workflow/.runtime/recommendation-quality/input.json"));
    if (!output.startsWith(path.join(repoRoot, "workflow/.runtime") + path.sep)) throw new Error("包含原文与向量的导出仅允许写入内容库 workflow/.runtime 内");
    await withToolLock(path.join(repoRoot, "workflow"), async () => {
      const input = await exportRecommendationQuality(repoRoot); await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      const runtime = path.join(await realpath(repoRoot), "workflow/.runtime");
      const directory = await realpath(path.dirname(output));
      if (await realpath(runtime) !== runtime || !(directory === runtime || directory.startsWith(runtime + path.sep))) throw new Error("拒绝通过符号链接导出私有原文");
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(input) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temporary, output);
      } finally { await rm(temporary, { force: true }); }
      console.log(JSON.stringify({ ok: true, publicCount: input.documents.length, output, embeddingCalls: 0 }));
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
