import type { CollectionEntry } from "astro:content";
import { selectContentRecommendations } from "./recommendations.mjs";

export function sortByDate<T extends { data: { pubDate: Date; contentId: string } }>(items: T[]) {
  return [...items].sort(({ data: a }, { data: b }) => {
    const byDate = b.pubDate.valueOf() - a.pubDate.valueOf();
    if (byDate) return byDate;
    return a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0;
  });
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

export function selectArticleRecommendations(
  article: CollectionEntry<"articles">,
  articles: CollectionEntry<"articles">[],
  limit = 3,
  preferredIds: string[] = [],
) {
  return selectContentRecommendations(article, articles, {
    limit,
    relatedSlots: Math.min(2, limit),
    allowSurprise: true,
    preferredIds,
  }) as CollectionEntry<"articles">[];
}

export { selectContentRecommendations };

export { publicArticleNote } from "./article-visibility.mjs";

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
