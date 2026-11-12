import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async () => {
  const images = await getCollection("images");
  const rules = new Set(images
    .filter(({ data }) => !data.draft && data.public && data.width && data.height)
    .map(({ data }) => `[data-image-ratio="${data.width}x${data.height}"] { --image-aspect-ratio: ${data.width} / ${data.height}; }`));
  return new Response([...rules].sort().join("\n") + "\n", {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
};
