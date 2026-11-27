import { getCollection } from "astro:content";
import { isPublicImage } from "./image-visibility.mjs";

export function getPublicImages() {
  return getCollection("images", isPublicImage);
}
