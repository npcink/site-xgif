import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const headers = await readFile(new URL("../../public/_headers", import.meta.url), "utf8");
const policy = headers.match(/Content-Security-Policy: (.+)/u)[1];

test("image dimensions work under production CSP on direct pages and dialogs", async ({ page, baseURL }) => {
  const origin = "https://csp-fixture.example";
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  // A virtual HTTPS host enforces the exact production policy without sending analytics.
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await page.request.get(new URL(url.pathname + url.search, baseURL).href);
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
  await page.route("https://img.xgif.cn/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="648" height="486"/>',
  }));
  await page.route("https://images.unsplash.com/**", (route) => route.abort());

  async function checkRatio(article, expectedRatio) {
    const figure = article.locator("figure[data-image-ratio]").first();
    await expect(figure).toHaveCSS("--image-aspect-ratio", "648 / 486");
    await expect(figure).toHaveCSS("aspect-ratio", expectedRatio);
    await expect(figure.locator("img")).toHaveCSS("object-fit", "contain");
    await expect(figure).not.toHaveAttribute("style", /./u);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
  await page.goto(`${origin}/20261112-6ix8`);
  await checkRatio(page.locator("main .image-detail"), "648 / 486");
  await page.goto(`${origin}/images`);
  await page.locator('a[data-detail-link][href="/20261112-6ix8"]').first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  // Dialogs use a fixed container and contain the image without cropping it.
  await checkRatio(dialog.locator(".image-detail"), "auto");
});
