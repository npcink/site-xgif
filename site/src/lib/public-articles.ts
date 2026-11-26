import { getCollection } from "astro:content";
import { isPublicArticle } from "./article-visibility.mjs";

export function getPublicArticles() {
  return getCollection("articles", isPublicArticle);
}
