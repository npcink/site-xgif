import { getPublicArticles } from "../lib/public-articles";
import { getPublicImages } from "../lib/public-images";
import { siteConfig } from "../config/site";
import { allTags, contentHref } from "../lib/content";
import { imageCollectionHref, imageCollections, isGalleryChild } from "../config/image-collection";

const entry = (path: string, lastmod?: Date) => `  <url>
    <loc>${new URL(path, siteConfig.url).href}</loc>${lastmod ? `
    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}
  </url>`;

export async function GET() {
  const articles = await getPublicArticles();
  const images = (await getPublicImages()).filter(({ data }) => !isGalleryChild(data.contentId));
  const tags = allTags(articles, images);
  const pages = [
    entry("/"),
    entry("/articles"),
    entry("/images"),
    ...imageCollections.map(({ slug }) => entry(imageCollectionHref(slug))),
    entry("/tags"),
    entry("/about"),
    entry("/rights"),
    entry("/privacy"),
    ...articles.map((article) => entry(contentHref(article), article.data.pubDate)),
    ...images.map((image) => entry(contentHref(image), image.data.pubDate)),
    ...tags.map((tag) => entry(`/tags/${encodeURIComponent(tag)}`)),
  ];

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.join("\n")}
</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
