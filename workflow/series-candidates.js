/**
 * Group image similarity hits by the existing content file they belong to.
 *
 * A hit is evidence for a candidate series, never permission to rewrite content.
 * The caller may add semantic (Qwen), OCR, and upload-batch signals; the
 * classifier keeps those signals explicit so a weak visual match cannot auto-merge.
 */
export const SERIES_CANDIDATE_VERSION = 4;
export const SERIES_MIN_EMBEDDING_SIMILARITY = 0.62;

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const rounded = (value) => Math.round(clamp(value) * 1000) / 1000;

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return clamp(dot / Math.sqrt(leftNorm * rightNorm), -1, 1);
}

/**
 * Classify a possible series relationship from independently verifiable signals.
 * Every candidate remains a manual review item, including high-confidence
 * same-batch matches; source conflicts always stop at a separate result.
 */
export function classifySeriesSignals({
  visualSimilarity = 0,
  embeddingSimilarity = 0,
  textOverlap = 0,
  batchMatch = false,
  sourceConflict = false,
  themeRelation = "",
} = {}) {
  const visual = clamp(visualSimilarity);
  const embedding = clamp(embeddingSimilarity);
  const text = clamp(textOverlap);
  const score = rounded(visual * 0.55 + embedding * 0.25 + text * 0.1 + (batchMatch ? 0.1 : 0));
  if (sourceConflict) return { decision: "separate", confidence: score, score, reasons: ["来源或授权信息冲突"] };
  const theme = ["same_series", "shared_template", "related_theme"].includes(themeRelation);
  if (score >= 0.3 || embedding >= SERIES_MIN_EMBEDDING_SIMILARITY || batchMatch || theme) {
    const reasons = [];
    if (visual >= 0.45) reasons.push("图片感知指纹相似");
    if (embedding >= SERIES_MIN_EMBEDDING_SIMILARITY) reasons.push("图文向量相似");
    if (text >= 0.5) reasons.push("文字或 OCR 重叠");
    if (batchMatch) reasons.push("同一上传批次");
    if (theme) reasons.push({ same_series: "视觉模型发现同系列证据，仍需人工确认", shared_template: "视觉模型发现共同梗模板，仍需人工确认", related_theme: "视觉模型发现主题关联，不等于同一系列，需人工确认" }[themeRelation]);
    if (batchMatch && score >= 0.9) reasons.push("高置信度仍需人工确认");
    return { decision: "review", confidence: score, score, reasons };
  }
  return { decision: "separate", confidence: score, score, reasons: ["系列证据不足"] };
}

function visualSimilarityFromMatch(match) {
  if (match?.kind === "exact") return 1;
  return match?.kind === "similar" && Number.isFinite(match.distance)
    ? clamp(1 - match.distance / 24) : 0;
}

/**
 * Turn member-level image matches into one batch-reviewable candidate per
 * existing content file. Exact matches are reported as duplicates and can
 * never be treated as a new gallery member.
 */
export function buildSeriesCandidates(matches = []) {
  const groups = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || !match.file) continue;
    if (match.kind === "theme" && (!["same_series", "shared_template", "related_theme"].includes(match.themeRelation)
      || !["high", "medium"].includes(match.themeConfidence) || !match.themeReason
      || !match.queryEvidence?.length || !match.candidateEvidence?.length)) continue;
    const group = groups.get(match.file) || {
      file: match.file,
      contentId: String(match.contentId || ""),
      title: String(match.title || "未命名图片"),
      memberCount: Number.isInteger(match.memberCount) ? match.memberCount : 1,
      members: [],
    };
    group.memberCount = Math.max(group.memberCount, Number.isInteger(match.memberCount) ? match.memberCount : 1);
    if (!group.contentId && match.contentId) group.contentId = String(match.contentId);
    group.members.push({
      index: Number.isInteger(match.memberIndex) ? match.memberIndex : null,
      image: String(match.image || ""),
      kind: ["exact", "similar", "semantic", "theme"].includes(match.kind) ? match.kind : "similar",
      distance: Number.isFinite(match.distance) ? match.distance : null,
      embeddingSimilarity: Number.isFinite(Number(match.embeddingSimilarity)) ? Number(match.embeddingSimilarity) : 0,
      textOverlap: Number.isFinite(Number(match.textOverlap)) ? Number(match.textOverlap) : 0,
      batchMatch: Boolean(match.batchMatch),
      sourceConflict: Boolean(match.sourceConflict),
      ...(match.kind === "theme" ? {
        themeRelation: match.themeRelation, themeConfidence: match.themeConfidence, themeReason: match.themeReason,
        queryEvidence: match.queryEvidence, candidateEvidence: match.candidateEvidence,
        querySha256: match.querySha256, candidateSha256: match.candidateSha256,
        reportedModel: match.reportedModel, inputVersion: match.inputVersion,
      } : {}),
    });
    groups.set(match.file, group);
  }

  return [...groups.values()].map((group) => {
    const exact = group.members.some((member) => member.kind === "exact");
    const best = group.members.reduce((current, member) => {
      const strength = item => Math.max(visualSimilarityFromMatch(item), item.embeddingSimilarity, item.textOverlap);
      return !current || strength(member) > strength(current) ? member : current;
    }, null);
    const signal = classifySeriesSignals({
      visualSimilarity: Math.max(...group.members.map(visualSimilarityFromMatch)),
      embeddingSimilarity: Math.max(...group.members.map(member => member.embeddingSimilarity)),
      textOverlap: Math.max(...group.members.map(member => member.textOverlap)),
      batchMatch: group.members.some(member => member.batchMatch),
      sourceConflict: group.members.some(member => member.sourceConflict),
      themeRelation: group.members.find(member => member.kind === "theme")?.themeRelation,
    });
    const reasons = exact
      ? ["图片字节完全一致，属于重复图片"]
      : [...signal.reasons, group.memberCount > 1 && Number.isInteger(best.index)
          ? `命中已有图集的第 ${best.index + 1} 张，共 ${group.memberCount} 张`
          : "命中已有单图内容"];
    return {
      version: SERIES_CANDIDATE_VERSION,
      file: group.file,
      contentId: group.contentId,
      title: group.title,
      memberCount: group.memberCount,
      matchedMembers: group.members.sort((left, right) => left.index - right.index),
      decision: exact ? "duplicate" : signal.decision,
      confidence: exact ? 1 : signal.confidence,
      score: exact ? 1 : signal.score,
      reasons,
      reviewPolicy: "manual-required",
      requiresReview: true,
    };
  }).sort((left, right) => right.confidence - left.confidence || left.file.localeCompare(right.file));
}
