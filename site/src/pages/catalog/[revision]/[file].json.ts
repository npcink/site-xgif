import type { APIRoute } from "astro";
import { getCatalog } from "../../../lib/catalog";

export async function getStaticPaths() {
  const catalog = await getCatalog();
  return ["articles", "images", "search-articles", "search-images"].map(file => ({ params: { revision: catalog.revision, file } }));
}

export const GET: APIRoute = async ({ params }) => {
  const catalog = await getCatalog();
  const search = params.file!.startsWith("search-");
  const kind = params.file!.replace("search-", "") as "articles" | "images";
  return Response.json({ format: 1, revision: catalog.revision, kind, items: (search ? catalog.search : catalog.records)[kind] });
};
