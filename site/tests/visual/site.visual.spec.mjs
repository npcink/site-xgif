import { expect, test } from "@playwright/test";

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

async function waitForImages(page) {
  await page.waitForFunction(() => Array.from(document.images)
    .filter((image) => {
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    })
    .every((image) => image.complete && image.naturalWidth > 0));
}

async function openConfusedImageDialog(page) {
  await page.goto("/images/", { waitUntil: "networkidle" });
  await waitForImages(page);
  await page.locator('a[href="/images/20260707-6s1n/"][data-detail-link]').click();
  await expect(page.getByRole("dialog", { name: "这就给我整不会了" })).toBeVisible();
}

async function openSearchState(page, query) {
  await page.goto(`/search/?q=${encodeURIComponent(query)}`, { waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.locator("[data-filter-input]")).toHaveValue(query);
  await page.locator("[data-filter-input]").blur();
}

test("homepage matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await waitForImages(page);

  await expect(page).toHaveScreenshot(`home-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("image dialog matches the approved visual baseline", async ({ page }, testInfo) => {
  await openConfusedImageDialog(page);

  await expect(page).toHaveScreenshot(`image-dialog-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("image library matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/images/", { waitUntil: "networkidle" });
  await waitForImages(page);

  await expect(page).toHaveScreenshot(`image-library-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("image library filtered state matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/images/", { waitUntil: "networkidle" });
  await waitForImages(page);
  await page.getByRole("button", { name: "无语" }).click();
  await expect(page.getByRole("button", { name: "无语" })).toHaveClass(/active/);
  await expect(page.locator("[data-visible-count]")).toHaveText("4");

  await expect(page).toHaveScreenshot(`image-library-filtered-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("search results match the approved visual baseline", async ({ page }, testInfo) => {
  await openSearchState(page, "打工");
  await expect(page.locator("[data-empty]")).toBeHidden();

  await expect(page).toHaveScreenshot(`search-results-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("search empty state matches the approved visual baseline", async ({ page }, testInfo) => {
  await openSearchState(page, "不存在内容");
  await expect(page.getByRole("heading", { name: "这次真的什么都没搜到" })).toBeVisible();

  await expect(page).toHaveScreenshot(`search-empty-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("article detail matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/articles/20260710-vfks/", { waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.getByRole("heading", { name: "海边旧事与父亲的记忆" })).toBeVisible();

  await expect(page).toHaveScreenshot(`article-detail-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("tag index matches the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/tags/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /从一个词/ })).toBeVisible();

  await expect(page).toHaveScreenshot(`tag-index-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("tag results match the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/tags/AI/", { waitUntil: "networkidle" });
  await waitForImages(page);
  await expect(page.getByRole("heading", { name: "#AI" })).toBeVisible();

  await expect(page).toHaveScreenshot(`tag-results-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});

test("tag related images match the approved visual baseline", async ({ page }, testInfo) => {
  await page.goto("/tags/AI/", { waitUntil: "networkidle" });
  const relatedImages = page.getByRole("heading", { name: "相关图片" });
  await relatedImages.scrollIntoViewIfNeeded();
  await waitForImages(page);
  await expect(relatedImages).toBeVisible();

  await expect(page).toHaveScreenshot(`tag-related-images-${testInfo.project.name}.png`, {
    animations: "disabled",
    fullPage: false,
  });
});
