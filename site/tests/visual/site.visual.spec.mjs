import { expect, test } from "@playwright/test";
import { imageArchiveFor, catalogItems, waitForCatalog } from "./archive-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("https://img.xgif.cn/**", async (route) => {
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        referer: "https://www.xgif.cn/",
      },
    });
    await route.fulfill({ response });
  });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("key pages satisfy the basic accessibility contract", async ({ page }) => {
  const routes = ["/", "/articles", "/20260710-vfks", "/images", "/search", "/rights"];
  for (const route of routes) {
    await page.goto(route, { waitUntil: "networkidle" });
    const issues = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      };
      const accessibleName = (element) => (
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.textContent
        || element.querySelector("img")?.getAttribute("alt")
        || ""
      ).trim();
      const duplicateIds = [...document.querySelectorAll("[id]")]
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index);
      return {
        main: document.querySelectorAll("main").length,
        visibleH1: [...document.querySelectorAll("h1")].filter(visible).length,
        unnamedControls: [...document.querySelectorAll("a, button, summary")]
          .filter(visible)
          .filter((element) => !accessibleName(element))
          .map((element) => element.outerHTML.slice(0, 120)),
        unlabeledInputs: [...document.querySelectorAll("input, select, textarea")]
          .filter(visible)
          .filter((element) => {
            const id = element.getAttribute("id");
            return !element.getAttribute("aria-label")
              && !element.getAttribute("aria-labelledby")
              && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
              && !element.closest("label");
          })
          .map((element) => element.outerHTML.slice(0, 120)),
        emptyAlt: [...document.querySelectorAll("img")].filter((image) => !image.getAttribute("alt")?.trim()).length,
        duplicateIds: [...new Set(duplicateIds)],
      };
    });
    expect(issues, `${route} 基础可访问性问题`).toEqual({
      main: 1,
      visibleH1: 1,
      unnamedControls: [],
      unlabeledInputs: [],
      emptyAlt: 0,
      duplicateIds: [],
    });
  }
});

test("homepage search opens the full catalog", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
  await page.getByRole("link", { name: "搜一搜", exact: true }).click();
  await expect(page).toHaveURL(/\/search\/?$/);
  await waitForCatalog(page);
  await page.locator("[data-filter-input]").fill("AI");
  await expect(page).toHaveURL(/\/search\?q=AI$/);
  await expect(page.locator("[data-filter-input]")).toHaveValue("AI");
  await expect(page.locator("html")).not.toHaveAttribute("data-filter-pending");
  const articleMatches = (await catalogItems(page, "articles", true)).filter(item => item.text.includes("ai")).length;
  const imageMatches = (await catalogItems(page, "images", true)).filter(item => item.text.includes("ai")).length;
  const searchMatches = articleMatches + imageMatches;
  expect(searchMatches).toBeGreaterThan(0);
  await expect(page.locator("[data-visible-count]")).toHaveText(String(searchMatches));
  const visibleMatches = Math.min(24, articleMatches) + Math.min(24, imageMatches);
  await expect(page.locator("[data-search-item]:visible")).toHaveCount(visibleMatches);
});

async function waitForImages(page) {
  await page.waitForFunction(() => Array.from(document.images)
    .filter((image) => {
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    })
    .every((image) => image.complete && image.naturalWidth > 0));
}

async function openImageDialog(page) {
  // Offscreen CDN requests do not determine whether this dialog is ready.
  await imageArchiveFor(page, "20260723-z4xw");
  await waitForImages(page);
  await page.locator('a[href="/20260723-z4xw"][data-detail-link]').click();
  const dialog = page.getByRole("dialog", { name: "去摧毁金融区吧" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog.getByRole("heading", { level: 1, name: "去摧毁金融区吧", exact: true })).toBeVisible();
  await waitForImages(page);
}

async function openSearchState(page, query) {
  await page.goto(`/search?q=${encodeURIComponent(query)}`, { waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.locator("[data-filter-input]")).toHaveValue(query);
  await page.locator("[data-filter-input]").blur();
}

async function useReferenceFallbackFonts(page) {
  // These references captured font-display: optional's cold fallback state.
  // Network timing must not switch the reference capture to the warm font face.
  // Delayed and warm custom fonts have separate behavior coverage.
  await page.route("**/*.woff2", route => route.abort());
}

test("homepage matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await waitForImages(page);

  // Content publication must not require new UI baselines. Keep the page shell
  // and geometry under visual review while masking data-owned cards and counts.
  await expect(page).toHaveScreenshot(`home-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [page.locator(".home-feed-item")],
  });
});

test("image dialog matches the approved visual baseline", async ({ page }, testInfo) => {
  await openImageDialog(page);

  // Capture the dialog itself: the blurred archive outside it changes whenever
  // content is published. Recommendation cards are data-owned and masked too.
  await expect(page.getByRole("dialog", { name: "去摧毁金融区吧" })).toHaveScreenshot(`image-dialog-${testInfo.project.name}.png`, {
    animations: "disabled",
    maskColor: "#d9d4ca",
    mask: [page.locator(".detail-dialog-body .related-section")],
  });
});

test("image library matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/images", { waitUntil: "networkidle" });
  await waitForImages(page);

  await expect(page).toHaveScreenshot(`image-library-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [
      page.locator(".masonry-grid"),
      page.locator(".filter-count"),
    ],
  });
});

test("image library filtered state matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/images", { waitUntil: "networkidle" });
  await waitForImages(page);
  const moodMatches = (await catalogItems(page, "images", true)).filter(item => item.text.includes("无语")).length;
  expect(moodMatches).toBeGreaterThan(0);
  const input = page.getByRole("textbox", { name: "筛选图片" });
  await input.fill("无语");
  await input.blur();
  await expect(page.locator("[data-visible-count]")).toHaveText(String(moodMatches));
  await expect(page.locator(".masonry-grid .image-card:visible")).toHaveCount(Math.min(24, moodMatches));

  await expect(page).toHaveScreenshot(`image-library-filtered-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [
      page.locator(".masonry-grid"),
      page.locator(".filter-count"),
    ],
  });
});

test("search results match the approved visual baseline", async ({ page }, testInfo) => {
  await useReferenceFallbackFonts(page);
  await openSearchState(page, "海边");
  await expect(page.locator("[data-empty]")).toBeHidden();

  await expect(page).toHaveScreenshot(`search-results-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [
      page.locator(".search-page [data-search-item]"),
      page.locator(".search-page [data-group-count]"),
    ],
  });
});

test("search empty state matches the approved visual baseline", async ({ page }, testInfo) => {
  await useReferenceFallbackFonts(page);
  await openSearchState(page, "不存在内容");
  await expect(page.getByRole("heading", { name: "没有找到相关内容" })).toBeVisible();

  await expect(page).toHaveScreenshot(`search-empty-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("article detail matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/20260710-vfks", { waitUntil: "networkidle" });
  // Optional fonts may remain on the fallback face for a cold document. Warm the
  // actual fonts before the reference capture; cold-load CLS is tested separately.
  await page.evaluate(() => document.fonts.ready);
  await page.reload({ waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.getByRole("heading", { level: 1, name: "我总想用海边那天，盖过父亲后来病痛中的模样" })).toBeVisible();

  await expect(page).toHaveScreenshot(`article-detail-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("tag index matches the approved visual baseline", async ({ page }, testInfo) => {
  await useReferenceFallbackFonts(page);
  await page.goto("/tags", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /从一个词/ })).toBeVisible();

  await expect(page).toHaveScreenshot(`tag-index-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [page.locator(".tag-index")],
  });
});

test("tag results match the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/tags/反转", { waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.getByRole("heading", { name: "#反转" })).toBeVisible();

  await expect(page).toHaveScreenshot(`tag-results-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [
      page.locator(".tag-jump-links"),
      page.locator(".tag-results"),
    ],
  });
});

test("tag related images match the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/tags/反转", { waitUntil: "networkidle" });
  const relatedImages = page.getByRole("region", { name: "相关图片" });
  await relatedImages.evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await waitForImages(page);
  await expect(relatedImages.locator(".image-card").first()).toBeInViewport();

  await expect(page).toHaveScreenshot(`tag-related-images-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
    maskColor: "#d9d4ca",
    mask: [
      page.locator(".tag-jump-links"),
      page.locator(".tag-results"),
    ],
  });
});
