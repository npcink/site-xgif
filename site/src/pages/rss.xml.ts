import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "../config/site";
import { contentHref, sortByDate } from "../lib/content";

export async function GET(context: { site?: URL }) {
  const articles = sortByDate(
    (await getCollection("articles")).filter((article) => !article.data.draft),
  ).slice(0, siteConfig.rss.maxItems);

  return rss({
    title: siteConfig.rss.title,
    description: siteConfig.rss.description,
    site: context.site ?? new URL(siteConfig.url),
    trailingSlash: false,
    customData: `<language>${siteConfig.rss.language}</language>`,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.summary,
      pubDate: article.data.pubDate,
      link: contentHref(article),
      categories: article.data.tags,
      ...(article.data.sourceUrl
        ? { source: { url: article.data.sourceUrl, title: article.data.source } }
        : {}),
    })),
  });
}
