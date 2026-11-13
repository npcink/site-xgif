import { defineConfig } from "astro/config";
import { siteConfig } from "./src/config/site.ts";

export default defineConfig({
  site: siteConfig.url,
  output: "static",
  trailingSlash: "never",
  redirects: { "/20261113-gw54": { destination: "/20261112-8jzn", status: 301 } },
});
