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
