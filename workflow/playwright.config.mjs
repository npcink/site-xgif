import { defineConfig } from "@playwright/test";

const port = 8791;

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 20_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `env PORT=${port} XGIF_PUBLISHER_TEST_MODE=true XGIF_LOCAL_DATABASE_PATH=.runtime/e2e.sqlite3 XGIF_AI_API_KEY= XGIF_AI_MODEL= node --disable-warning=ExperimentalWarning server.js`,
    cwd: new URL(".", import.meta.url).pathname,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
