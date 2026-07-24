import type { CollectionEntry } from "astro:content";

export function sortByDate<T extends { data: { pubDate: Date } }>(items: T[]) {
  return [...items].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace("/", ".");
}

export function contentHref(entry: { data: { contentId: string } }) {
  return `/${entry.data.contentId}`;
}

function stableRecommendationRank(seed: string, value: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectArticleRecommendations(
  article: CollectionEntry<"articles">,
  articles: CollectionEntry<"articles">[],
  limit = 3,
) {
  const candidates = articles.filter(
    (candidate) => !candidate.data.draft && candidate.data.contentId !== article.data.contentId,
  );
  const sharedTagCount = (candidate: CollectionEntry<"articles">) =>
    candidate.data.tags.filter((tag) => article.data.tags.includes(tag)).length;
  const related = candidates
    .map((candidate) => ({ candidate, sharedTags: sharedTagCount(candidate) }))
    .filter(({ sharedTags }) => sharedTags > 0)
    .sort(
      (a, b) =>
        b.sharedTags - a.sharedTags ||
        b.candidate.data.pubDate.valueOf() - a.candidate.data.pubDate.valueOf() ||
        a.candidate.data.contentId.localeCompare(b.candidate.data.contentId),
    )
    .slice(0, Math.min(2, limit))
    .map(({ candidate }) => candidate);
  const selectedIds = new Set(related.map((candidate) => candidate.data.contentId));
  const byStableSurprise = (a: CollectionEntry<"articles">, b: CollectionEntry<"articles">) =>
    stableRecommendationRank(article.data.contentId, a.data.contentId) -
      stableRecommendationRank(article.data.contentId, b.data.contentId) ||
    a.data.contentId.localeCompare(b.data.contentId);
  const surprise = candidates
    .filter((candidate) => !selectedIds.has(candidate.data.contentId) && sharedTagCount(candidate) === 0)
    .sort(byStableSurprise);
  const fallback = candidates
    .filter((candidate) => !selectedIds.has(candidate.data.contentId) && sharedTagCount(candidate) > 0)
    .sort(byStableSurprise);

  return [...related, ...surprise, ...fallback].slice(0, limit);
}

const internalArticleNotePatterns = [
  /flomo\s*私人(?:笔记|收藏)?导入/i,
  /请在公开前复核/,
  /来源待确认/,
  /内部导入/,
];

export function publicArticleNote(article: { editorNote?: string; note?: string }) {
  const normalized = (article.editorNote || article.note)?.trim();
  if (!normalized) return "";
  return internalArticleNotePatterns.some((pattern) => pattern.test(normalized)) ? "" : normalized;
}

export function allTags(
  articles: CollectionEntry<"articles">[],
  images: CollectionEntry<"images">[],
) {
  return Array.from(
    new Set([
      ...articles.flatMap((entry) => entry.data.tags),
      ...images.flatMap((entry) => entry.data.tags),
    ]),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
