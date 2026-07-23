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

export function contentHref(
  kind: "articles" | "images",
  entry: { data: { contentId: string } },
) {
  return `/${kind}/${entry.data.contentId}/`;
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
