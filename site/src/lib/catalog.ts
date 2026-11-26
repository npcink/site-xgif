import { getPublicArticles } from "./public-articles";
import { createHash } from "node:crypto";
import { getCollection } from "astro:content";
import { sortByDate } from "./content";
import { mediaFilterValues } from "./image-media.mjs";
import { foodStallGallery, isGalleryChild } from "../config/image-collection";

export const catalogSizes = { articles: 12, images: 24 } as const;
export type CatalogKind = keyof typeof catalogSizes;
let snapshot: ReturnType<typeof buildCatalog> | undefined;

async function buildCatalog() {
  const articles = sortByDate(await getPublicArticles());
  const publicImages = (await getCollection("images")).filter(entry => !entry.data.draft && entry.data.public);
  const images = sortByDate(publicImages.filter(({ data }) => !isGalleryChild(data.contentId)));
  const sources = [...articles, ...sortByDate(publicImages)].map(entry => ({ id: entry.data.contentId, data: entry.data, body: entry.body }));
  const revision = createHash("sha256").update(JSON.stringify({ format: 1, sources, foodStallGallery })).digest("hex").slice(0, 20);
  const imageSearchText = ({ data }: typeof publicImages[number]) => `${data.title} ${data.description} ${data.source} ${data.tags.join(" ")} ${data.mood.join(" ")} ${data.scenes.join(" ")}`.toLowerCase();
  const gallerySearchText = [foodStallGallery.title, ...publicImages.filter(({ data }) => foodStallGallery.members.some(id => id === data.contentId)).map(imageSearchText)].join(" ");
  const records = {
    articles: articles.map((entry, index) => ({ id: entry.data.contentId, title: entry.data.title, source: entry.data.source.toLowerCase(), tags: entry.data.tags, page: Math.floor(index / catalogSizes.articles) + 1 })),
    images: images.map((entry, index) => ({ id: entry.data.contentId, title: entry.data.contentId === foodStallGallery.cover ? foodStallGallery.title : entry.data.title, source: entry.data.source.toLowerCase(), tags: entry.data.tags, mediaTypes: mediaFilterValues(entry.data), page: Math.floor(index / catalogSizes.images) + 1 })),
  };
  const search = {
    articles: articles.map(entry => ({ id: entry.data.contentId, text: `${entry.body || ""} ${entry.data.title} ${entry.data.summary} ${entry.data.source} ${entry.data.tags.join(" ")}`.toLowerCase() })),
    images: images.map(entry => ({ id: entry.data.contentId, text: entry.data.contentId === foodStallGallery.cover ? gallerySearchText : imageSearchText(entry) })),
  };
  return { revision, base: `/catalog/${revision}`, articles, images, records, search };
}

// One public-only snapshot per build; no filesystem writes or private ledger reads.
export function getCatalog() {
  return import.meta.env.DEV ? buildCatalog() : snapshot ??= buildCatalog();
}
