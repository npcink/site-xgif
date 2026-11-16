import { galleryImages } from "./image-gallery.mjs";

/** Intrinsic member metadata, independent of filename extension and AI tags. */
export function imageMediaType(data) {
  const images = galleryImages(data);
  if (!images.length || images.some(image => typeof image.animated !== "boolean")) return "unknown";
  const moving = images.filter(image => image.animated).length;
  return moving === 0 ? "static" : moving === images.length ? "animated" : "mixed";
}

export function mediaFilterValues(data) {
  const type = imageMediaType(data);
  return type === "mixed" ? "static animated" : type;
}
