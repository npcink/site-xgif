import { siteConfig } from "../config/site";

export function GET() {
  return new Response([
    "User-agent: *",
    "Allow: /",
    "Disallow: /catalog/",
    `Sitemap: ${new URL("/sitemap.xml", siteConfig.url).href}`,
    "",
  ].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
