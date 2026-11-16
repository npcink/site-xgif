import { getCollection } from "astro:content";

export async function GET() {
  const [articles, images] = await Promise.all([getCollection("articles"), getCollection("images")]);
  const published = [
    ...articles.filter(item => !item.data.draft && !item.data.publicationHold).map(item => [item.data.contentId, "article"]),
    ...images.filter(item => !item.data.draft && item.data.public).map(item => [item.data.contentId, "image"]),
  ];
  return Response.json(Object.fromEntries(published));
}
