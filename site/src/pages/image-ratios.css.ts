import type { APIRoute } from "astro";
import { getPublicImages } from "../lib/public-images";
import { galleryImages } from "../lib/image-gallery.mjs";

export const GET: APIRoute = async () => {
  const images = await getPublicImages();
  const rules = new Set(images
    .flatMap(({ data }) => [{ width: data.width, height: data.height }, ...galleryImages(data)])
    .filter(({ width, height }) => width && height)
    .map(({ width, height }) => `[data-image-ratio="${width}x${height}"] { --image-native-width: ${width}px; --image-aspect-ratio: ${width} / ${height}; }`));
  return new Response([...rules].sort().join("\n") + "\n", {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
};
