const DAY_MS = 86_400_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedDateValue(value) {
  const timestamp = value instanceof Date ? value.valueOf() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function stableRank(seed, value) {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function textTokens(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) || []);
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (sequence.length === 1) {
      tokens.add(sequence);
      continue;
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }
  return tokens;
}

function cosineSetSimilarity(left, right) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const token of smaller) {
    if (larger.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(left.size * right.size);
}

export function recommendationDocument(entry) {
  const data = entry?.data || entry || {};
  const tags = asArray(data.tags).map(String).filter(Boolean);
  const mood = asArray(data.mood).map(String).filter(Boolean);
  const scenes = asArray(data.scenes).map(String).filter(Boolean);
  const category = String(data.category || "").trim();
  const title = String(data.title || "").trim();
  const summary = String(data.summary || data.description || "").trim();
  const semanticText = [
    title,
    summary,
    tags.join(" "),
    category,
    mood.join(" "),
    scenes.join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    entry,
    id: String(data.contentId || entry?.id || "").trim(),
    title,
    summary,
    tags,
    category,
    mood,
    scenes,
    semanticText,
    semanticTokens: textTokens(semanticText),
    pubDate: normalizedDateValue(data.pubDate),
    isDraft: Boolean(data.draft),
    isPublic: data.public !== false,
  };
}

function tagWeights(documents) {
  const frequencies = new Map();
  for (const document of documents) {
    for (const tag of new Set(document.tags)) {
      frequencies.set(tag, (frequencies.get(tag) || 0) + 1);
    }
  }
  const population = Math.max(documents.length, 1);
  return new Map(
    [...frequencies].map(([tag, frequency]) => [
      tag,
      1 + Math.log((population + 1) / (frequency + 1)),
    ]),
  );
}

function weightedTagSimilarity(source, candidate, weights) {
  if (!source.tags.length || !candidate.tags.length) return 0;
  const sourceTags = new Set(source.tags);
  const candidateTags = new Set(candidate.tags);
  const union = new Set([...sourceTags, ...candidateTags]);
  let sharedWeight = 0;
  let unionWeight = 0;
  for (const tag of union) {
    const weight = weights.get(tag) || 1;
    unionWeight += weight;
    if (sourceTags.has(tag) && candidateTags.has(tag)) sharedWeight += weight;
  }
  return unionWeight ? sharedWeight / unionWeight : 0;
}

function freshnessScore(candidate, newestDate) {
  if (!candidate.pubDate || !newestDate) return 0;
  const ageDays = Math.max(0, newestDate - candidate.pubDate) / DAY_MS;
  return 1 / (1 + ageDays / 365);
}

export function rankRecommendationCandidates(sourceEntry, candidateEntries) {
  const source = recommendationDocument(sourceEntry);
  const seenCandidateIds = new Set();
  const candidates = candidateEntries
    .map(recommendationDocument)
    .filter((candidate) => {
      if (
        !candidate.id ||
        candidate.id === source.id ||
        candidate.isDraft ||
        !candidate.isPublic ||
        seenCandidateIds.has(candidate.id)
      ) {
        return false;
      }
      seenCandidateIds.add(candidate.id);
      return true;
    });
  const weights = tagWeights([source, ...candidates]);
  const newestDate = Math.max(source.pubDate, ...candidates.map((candidate) => candidate.pubDate));

  return candidates
    .map((candidate) => {
      const tag = weightedTagSimilarity(source, candidate, weights);
      const lexical = cosineSetSimilarity(source.semanticTokens, candidate.semanticTokens);
      const freshness = freshnessScore(candidate, newestDate);
      const relevance = tag * 0.62 + lexical * 0.28;
      return {
        entry: candidate.entry,
        id: candidate.id,
        tag,
        lexical,
        freshness,
        relevance,
        score: relevance + freshness * 0.1,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.relevance - left.relevance ||
        recommendationDocument(right.entry).pubDate - recommendationDocument(left.entry).pubDate ||
        left.id.localeCompare(right.id),
    );
}

function preferredEntries(candidateEntries, preferredIds, sourceId) {
  const candidatesById = new Map(
    candidateEntries
      .map((entry) => [recommendationDocument(entry).id, entry])
      .filter(
        ([id, entry]) =>
          id &&
          id !== sourceId &&
          !recommendationDocument(entry).isDraft &&
          recommendationDocument(entry).isPublic,
      ),
  );
  const seen = new Set();
  return asArray(preferredIds).flatMap((id) => {
    const normalizedId = String(id || "");
    const entry = candidatesById.get(normalizedId);
    if (!entry || seen.has(normalizedId)) return [];
    seen.add(normalizedId);
    return [entry];
  });
}

/**
 * @param {unknown} sourceEntry
 * @param {unknown[]} candidateEntries
 * @param {{
 *   limit?: number,
 *   relatedSlots?: number,
 *   allowSurprise?: boolean,
 *   preferredIds?: string[],
 * }} [options]
 */
export function selectContentRecommendations(
  sourceEntry,
  candidateEntries,
  {
    limit = 3,
    relatedSlots = Math.min(2, limit),
    allowSurprise = true,
    preferredIds = [],
  } = {},
) {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const sourceId = recommendationDocument(sourceEntry).id;
  const preferred = preferredEntries(candidateEntries, preferredIds, sourceId).slice(0, limit);
  const selectedIds = new Set(preferred.map((entry) => recommendationDocument(entry).id));
  if (preferred.length >= limit) return preferred;

  const ranked = rankRecommendationCandidates(sourceEntry, candidateEntries).filter(
    (candidate) => !selectedIds.has(candidate.id),
  );
  const related = ranked
    .filter((candidate) => candidate.relevance >= 0.045)
    .slice(0, Math.max(0, Math.min(relatedSlots, limit - preferred.length)));
  for (const candidate of related) selectedIds.add(candidate.id);

  const selected = [...preferred, ...related.map((candidate) => candidate.entry)];
  if (allowSurprise && selected.length < limit) {
    const surprise = ranked
      .filter((candidate) => !selectedIds.has(candidate.id))
      .sort(
        (left, right) =>
          stableRank(sourceId, left.id) - stableRank(sourceId, right.id) ||
          left.id.localeCompare(right.id),
      )[0];
    if (surprise) {
      selected.push(surprise.entry);
      selectedIds.add(surprise.id);
    }
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate.entry);
    selectedIds.add(candidate.id);
  }
  return selected.slice(0, limit);
}
