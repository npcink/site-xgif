import { getPublicArticles } from "../lib/public-articles";
import { getCollection } from "astro:content";
import { isGalleryChild } from "../config/image-collection";

export async function GET() {
  const [articles, images] = await Promise.all([getPublicArticles(), getCollection("images")]);
  const published = [
    ...articles.map(item => [item.data.contentId, "article"]),
    ...images.filter(({ data }) => !data.draft && data.public && !isGalleryChild(data.contentId)).map(item => [item.data.contentId, "image"]),
  ];
  return Response.json(Object.fromEntries(published));
}
