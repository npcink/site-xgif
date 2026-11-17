import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import { siteConfig } from "./src/config/site.ts";
import staticAssetVersions from "./src/lib/version-static-assets.mjs";

export default defineConfig({
  site: siteConfig.url,
  output: "static",
  trailingSlash: "never",
  integrations: [staticAssetVersions()],
  image: {
    service: { entrypoint: "./src/lib/display-image-service.mjs" },
    remotePatterns: [{ protocol: "https", hostname: "img.xgif.cn", pathname: "/memes/**" }],
  },
  markdown: { processor: satteri({ features: { smartPunctuation: false } }) },
  redirects: { "/20261113-gw54": { destination: "/20261112-8jzn", status: 301 } },
});
