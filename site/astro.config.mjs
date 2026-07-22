import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://www.xgif.cn",
  output: "static",
  trailingSlash: "always",
  adapter: cloudflare(),
});