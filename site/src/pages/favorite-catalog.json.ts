import { getPublicArticles } from "../lib/public-articles";
import { getPublicImages } from "../lib/public-images";
import { isGalleryChild } from "../config/image-collection";

export async function GET() {
  const [articles, images] = await Promise.all([getPublicArticles(), getPublicImages()]);
  const published = [
    ...articles.map(item => [item.data.contentId, "article"]),
    ...images.filter(({ data }) => !isGalleryChild(data.contentId)).map(item => [item.data.contentId, "image"]),
  ];
  return Response.json(Object.fromEntries(published));
}
