import { expect, test } from "@playwright/test";
import { waitForCatalog } from "./archive-helpers.mjs";

for (const route of ["/tags", "/search?q=海边"]) {
  test(`optional fonts preserve cold layout and render on warm navigation: ${route}`, async ({ page }) => {
    await page.addInitScript(() => {
      window.fontShifts = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.fontShifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: true });
    });
    const slowFont = async route => {
      // Exceed the optional font block period, independent of host/network speed.
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.continue();
    };
    await page.route("**/*.woff2", slowFont);
    await page.goto(route, { waitUntil: "networkidle" });
    if (route.startsWith("/search")) await waitForCatalog(page);

    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const renderedFonts = async () => {
      const { root } = await client.send("DOM.getDocument");
      const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".brand" });
      return (await client.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
    };
    // fonts.ready alone cannot reveal which face an optional font actually used.
    expect((await renderedFonts()).some(font => font.isCustomFont)).toBe(false);
    expect(await page.evaluate(() => window.fontShifts.reduce((sum, value) => sum + value, 0))).toBeLessThan(0.1);
    await expect(page.locator("main h1")).toBeVisible();

    await page.unroute("**/*.woff2", slowFont);
    await page.evaluate(() => document.fonts.load('900 30px "Geist Variable"'));
    await page.reload({ waitUntil: "networkidle" });
    if (route.startsWith("/search")) await waitForCatalog(page);
    expect((await renderedFonts()).some(font => font.isCustomFont && font.familyName === "Geist")).toBe(true);
    await expect(page.locator("main h1")).toBeVisible();
    const width = page.viewportSize().width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (route.startsWith("/search")) {
      await expect(page.locator("[data-filter-input]")).toHaveValue("海边");
      expect(await page.locator("main [data-search-item]").count()).toBeGreaterThan(0);
    }
  });
}
