import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPublicRecommendationContent, readRecommendationManifest, recommendationSourceHash, EVIDENCE_VERSION, MULTIMODAL_INPUT_VERSION } from "./recommendation-engine.js";
import { publicationEvidenceHash } from "./recommendation-publication.js";
import { createHash } from "node:crypto";

export function bindOfflineImageFingerprints(documents, manifest) {
  if (manifest.embedding?.inputVersion === MULTIMODAL_INPUT_VERSION) {
    for (const doc of documents.filter((doc) => doc.type === "image")) {
      doc.contentSha256 = createHash("sha256").update(JSON.stringify([MULTIMODAL_INPUT_VERSION, "image", doc.publicationEvidence[2].map((image) => image.sha256)])).digest("hex");
    }
  }
  return documents;
}

export async function verifyRecommendationPublication(repoRoot) {
  const manifest = await readRecommendationManifest(repoRoot);
  const documents = await loadPublicRecommendationContent(repoRoot);
  const fail = (reason) => { throw new Error(`推荐清单与发布快照不一致：${reason}。请针对 origin/main 加本批选中文件重建推荐清单；不要直接发布本机全库清单。`); };
  if (!manifest || manifest.schemaVersion !== 1 || !["rules", "hybrid"].includes(manifest.mode) || manifest.selection?.evidenceVersion !== EVIDENCE_VERSION || manifest.publication?.schemaVersion !== 1) fail("缺少当前版本的快照凭据");
  if (documents.some((doc) => doc.type === "image" && (!doc.publicationEvidence[2].length || doc.publicationEvidence[2].some((image) => !image.sha256)))) fail("图片无法离线核验，请使用本地图片或内容寻址的公开 R2 图片");
  if (manifest.publication.sourceHash !== publicationEvidenceHash(documents)) fail("正文、图片、日期、分组或公开集合已变化");
  bindOfflineImageFingerprints(documents, manifest);
  if (manifest.sourceHash !== recommendationSourceHash(documents)) fail("推荐输入哈希不匹配");
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  if (byId.size !== documents.length || JSON.stringify(Object.keys(manifest.recommendations).sort()) !== JSON.stringify([...byId.keys()].sort())) fail("缺少、多出或重复的公开内容 ID");
  for (const doc of documents) {
    for (const [kind, type] of [["articles", "article"], ["images", "image"]]) {
      const list = manifest.recommendations[doc.id]?.[kind];
      if (!Array.isArray(list) || new Set(list).size !== list.length) fail(`${doc.id}/${kind} 列表无效`);
      for (const id of list) {
        const target = byId.get(id);
        if (!target || target.type !== type || target.id === doc.id
          || target.publicationEvidence[3] !== doc.publicationEvidence[3]) fail(`${doc.id}/${kind} 引用了不允许的内容`);
      }
    }
  }
  return { ok: true, publicCount: documents.length, sourceHash: manifest.sourceHash, publicationHash: manifest.publication.sourceHash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyRecommendationPublication(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
