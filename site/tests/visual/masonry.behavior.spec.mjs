import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const headers = await readFile(new URL("../../public/_headers", import.meta.url), "utf8");
const policy = headers.match(/Content-Security-Policy: (.+)/u)[1];
const origin = "https://masonry-fixture.example";

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.cspViolations.push(event.effectiveDirective);
    });
  });
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await page.request.get(new URL(url.pathname + url.search, baseURL).href);
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
  await page.route("https://img.xgif.cn/**", (route) => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"/>',
  }));
  await page.route("https://images.unsplash.com/**", (route) => route.abort());
});

async function expectPacked(grid) {
  // Replay shortest-column placement from actual heights, checking gaps and overlap.
  await expect.poll(() => grid.evaluate((element) => {
    const style = getComputedStyle(element);
    const columns = style.gridTemplateColumns.split(/\s+/u).length;
    const gap = Number.parseFloat(style.columnGap);
    const bounds = element.getBoundingClientRect();
    const width = (bounds.width - (columns - 1) * gap) / columns;
    const ends = Array(columns).fill(bounds.top);
    let error = 0;
    for (const item of element.children) {
      if (item.hidden) continue;
      const box = item.getBoundingClientRect();
      const column = ends.indexOf(Math.min(...ends));
      error = Math.max(error, Math.abs(box.top - ends[column]), Math.abs(box.left - bounds.left - column * (width + gap)));
      ends[column] += columns > 1 ? Math.ceil(box.height + gap) : box.height + gap;
    }
    return error;
  })).toBeLessThan(1.1);
  expect(await grid.page().evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test("feeds fill the shortest column under CSP and repack after filtering and resizing", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/`);
  const feed = page.locator(".home-feed");
  const order = await feed.locator(".home-feed-item").evaluateAll((items) => items.map((item) => item.textContent));
  await expectPacked(feed);
  await page.getByRole("button", { name: /图片 \/ GIF/ }).click();
  await expect(feed.locator('[data-home-section="articles"]:visible')).toHaveCount(0);
  await expectPacked(feed);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expectPacked(feed);
  expect(await feed.locator(".home-feed-item").evaluateAll((items) => items.map((item) => item.textContent))).toEqual(order);

  await page.goto(`${origin}/tags/${encodeURIComponent("幽默")}`);
  const articles = page.locator(".article-grid");
  await expectPacked(articles);
  await expect(articles.locator('[data-inline-content-id="20260721-nzrl"] .article-inline-text')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("masonry-tags.png"), fullPage: true });
  // Exercise both directions across the responsive breakpoint.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(articles).not.toHaveAttribute("data-masonry-ready");
  await expectPacked(articles);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(articles).toHaveAttribute("data-masonry-ready", "");
  await expectPacked(articles);

  await page.goto(`${origin}/articles`);
  await expectPacked(articles);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/u);
  await expectPacked(articles);
  await page.locator("[data-filter-input]").fill("不存在的瀑布流测试词");
  await expect(articles.locator(".article-card:visible")).toHaveCount(0);
  await page.locator("[data-filter-input]").fill("");
  await expect(articles.locator(".article-card:visible")).toHaveCount(12);
  await expectPacked(articles);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});
