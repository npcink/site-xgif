import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://img.xgif.cn/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#bac7ae"/></svg>' }));
});

for (const failureStatus of [429, 503]) test(`successful local favorites survive reporting ${failureStatus}; only explicit add and remove actions are sent`, async ({ page }) => {
  const sent = [];
  await page.route("**/api/favorites/events", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: failureStatus });
  });
  await page.goto("/20261112-6ix8");
  // Exercise the production-only sender against a controlled failing endpoint.
  await page.locator('meta[name="xgif-favorite-metrics-origin"]').evaluate(meta => { meta.content = location.origin; });
  const favorite = page.locator("main [data-favorite-toggle]");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ contentId: "20261112-6ix8", kind: "image", action: "add" });
  await page.goto("/favorites");
  await page.locator('meta[name="xgif-favorite-metrics-origin"]').evaluate(meta => { meta.content = location.origin; });
  await expect(page.locator(".favorite-row")).toHaveCount(1);
  await page.locator("[data-favorite-remove]").click();
  await expect(page.locator(".favorite-row")).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ contentId: "20261112-6ix8", kind: "image", action: "remove" });
});

test("local navigation and failed storage never send favorite metrics", async ({ page }) => {
  const sent = [];
  page.on("request", request => { if (request.url().includes("/api/favorites/events")) sent.push(request.url()); });
  await page.goto("/20261112-6ix8");
  await page.locator("main [data-favorite-toggle]").click();
  await expect(page.locator("main [data-favorite-toggle]")).toHaveAttribute("aria-pressed", "true");
  expect(sent).toEqual([]);
  await page.locator('meta[name="xgif-favorite-metrics-origin"]').evaluate(meta => { meta.content = location.origin; });
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("denied"); }; });
  await page.locator("main [data-favorite-toggle]").click();
  await expect(page.locator("main [data-favorite-toggle]")).toHaveAttribute("aria-pressed", "true");
  expect(sent).toEqual([]);
});
