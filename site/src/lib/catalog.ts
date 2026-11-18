import { createHash } from "node:crypto";
import { getCollection } from "astro:content";
import { sortByDate } from "./content";
import { mediaFilterValues } from "./image-media.mjs";

export const catalogSizes = { articles: 12, images: 24 } as const;
export type CatalogKind = keyof typeof catalogSizes;
let snapshot: ReturnType<typeof buildCatalog> | undefined;

async function buildCatalog() {
  const articles = sortByDate((await getCollection("articles")).filter(entry => !entry.data.draft && !entry.data.publicationHold));
  const images = sortByDate((await getCollection("images")).filter(entry => !entry.data.draft && entry.data.public));
  const sources = [...articles, ...images].map(entry => ({ id: entry.data.contentId, data: entry.data, body: entry.body }));
  const revision = createHash("sha256").update(JSON.stringify({ format: 1, sources })).digest("hex").slice(0, 20);
  const records = {
    articles: articles.map((entry, index) => ({ id: entry.data.contentId, title: entry.data.title, source: entry.data.source.toLowerCase(), tags: entry.data.tags, page: Math.floor(index / catalogSizes.articles) + 1 })),
    images: images.map((entry, index) => ({ id: entry.data.contentId, title: entry.data.title, source: entry.data.source.toLowerCase(), tags: entry.data.tags, mediaTypes: mediaFilterValues(entry.data), page: Math.floor(index / catalogSizes.images) + 1 })),
  };
  const search = {
    articles: articles.map(entry => ({ id: entry.data.contentId, text: `${entry.body || ""} ${entry.data.title} ${entry.data.summary} ${entry.data.source} ${entry.data.tags.join(" ")}`.toLowerCase() })),
    images: images.map(entry => ({ id: entry.data.contentId, text: `${entry.data.title} ${entry.data.description} ${entry.data.source} ${entry.data.tags.join(" ")} ${entry.data.mood.join(" ")} ${entry.data.scenes.join(" ")}`.toLowerCase() })),
  };
  return { revision, base: `/catalog/${revision}`, articles, images, records, search };
}

// One public-only snapshot per build; no filesystem writes or private ledger reads.
export function getCatalog() {
  return import.meta.env.DEV ? buildCatalog() : snapshot ??= buildCatalog();
}
