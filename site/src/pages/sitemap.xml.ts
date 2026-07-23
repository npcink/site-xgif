import { getCollection } from "astro:content";
import { allTags, contentHref } from "../lib/content";

const site = "https://www.xgif.cn";

const entry = (path: string, lastmod?: Date) => `  <url>
    <loc>${new URL(path, site).href}</loc>${lastmod ? `
    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}
  </url>`;

export async function GET() {
  const articles = (await getCollection("articles")).filter((item) => !item.data.draft);
  const images = (await getCollection("images")).filter((item) => !item.data.draft && item.data.public);
  const tags = allTags(articles, images);
  const pages = [
    entry("/"),
    entry("/articles/"),
    entry("/images/"),
    entry("/tags/"),
    entry("/about/"),
    entry("/rights/"),
    entry("/privacy/"),
    ...articles.map((article) => entry(contentHref("articles", article), article.data.pubDate)),
    ...images.map((image) => entry(contentHref("images", image), image.data.pubDate)),
    ...tags.map((tag) => entry(`/tags/${encodeURIComponent(tag)}/`)),
  ];

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.join("\n")}
</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
