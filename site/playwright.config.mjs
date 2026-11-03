import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.XGIF_SITE_TEST_PORT || (process.env.XGIF_GALLERY_FIXTURE === "true" ? 14322 : 4322));

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    colorScheme: "light",
    locale: "zh-CN",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.XGIF_SITE_TEST_PORT && process.env.XGIF_GALLERY_FIXTURE !== "true",
  },
});
