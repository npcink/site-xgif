import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("runtime metadata and navigation share the centralized site configuration", async () => {
  const [astroConfig, wranglerConfig, header, footer, layout, sitemap, robots, rss] = await Promise.all([
    read("astro.config.mjs"),
    read("wrangler.jsonc"),
    read("src/components/Header.astro"),
    read("src/components/Footer.astro"),
    read("src/layouts/BaseLayout.astro"),
    read("src/pages/sitemap.xml.ts"),
    read("src/pages/robots.txt.ts"),
    read("src/pages/rss.xml.ts"),
  ]);

  for (const source of [astroConfig, header, footer, layout, sitemap, robots, rss]) {
    assert.match(source, /siteConfig/u);
    assert.doesNotMatch(source, /https:\/\/www\.xgif\.cn/u);
  }
  assert.match(astroConfig, /trailingSlash:\s*"never"/u);
  assert.match(wranglerConfig, /"html_handling":\s*"drop-trailing-slash"/u);
});
