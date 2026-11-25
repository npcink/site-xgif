import { expect, test } from "@playwright/test";

for (const { slug, title, ids, captions, upscale, excludedId } of [
  { slug: "costume-dialogue", title: "古装剧接话三连", ids: ["20261124-1mr5", "20261124-ba5f", "20261124-bcea"], captions: ["接话", "打趣", "吐槽"], upscale: true },
  { slug: "white-horned-mask", title: "白色长角面具", ids: ["20261123-aqco", "20261123-9t6t"], captions: ["暖色逆光", "蓝绿光与红披风"], excludedId: "20261123-4f7m" },
  { slug: "lopital", title: "洛必达两连", ids: ["20261123-coe2", "20261123-muyj"], captions: ["洛必达法则天下第一", "反复用洛必达"] },
]) {
  test(`${title} shows the approved members in order without navigating to each detail`, async ({ page }, testInfo) => {
    const collectionPath = `/images/collections/${slug}`;
    const originalUrls = [];
    for (const id of ids) {
      const response = await page.goto(`/${id}`);
      expect(response.status()).toBe(200);
      originalUrls.push(await page.locator("main [data-gallery-original]").getAttribute("href"));
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", collectionPath);
    }
    await page.goto(collectionPath);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const gallery = page.getByRole("region", { name: title });
    const links = gallery.locator(".gallery-thumbnails a");
    await expect(links).toHaveCount(ids.length);
    await expect(links.first()).toHaveAttribute("aria-current", "true");
    for (const [index, originalUrl] of originalUrls.entries()) {
      const link = links.nth(index);
      await expect(link).toHaveAttribute("href", originalUrl);
      if (index === 1 && testInfo.project.name === "mobile") {
        await gallery.locator("[data-gallery-stage]").evaluate(element => {
          const touch = clientX => new Touch({ identifier: 1, target: element, clientX, clientY: 200 });
          element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(300)] }));
          element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(100)] }));
        });
      } else if (index > 0) await link.click();
      await expect(link).toHaveAttribute("aria-current", "true");
      await expect(gallery.locator("[data-gallery-caption-output]")).toHaveText(captions[index]);
      if (upscale) await expect(gallery.locator("[data-gallery-attribution-output]")).toContainText("Lanczos 放大版");
      const image = gallery.locator("[data-gallery-slide]:visible img");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
      await expect(page).toHaveURL(new RegExp(`${collectionPath}$`));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await gallery.screenshot({ path: testInfo.outputPath(`${slug}.png`), animations: "disabled" });
    if (excludedId) {
      await page.goto(`/${excludedId}`);
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    }
  });
}

test.describe("food stall gallery without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("original images remain accessible and unrelated images stay separate", async ({ page }) => {
    await page.goto("/20261123-4qiu");
    const gallery = page.locator("[data-image-gallery]");
    await expect(gallery.locator("[data-gallery-slide]:visible")).toHaveCount(1);
    const thumbnails = gallery.getByRole("navigation", { name: "选择图集图片" });
    await expect(thumbnails.getByRole("link")).toHaveCount(3);
    await expect(thumbnails.getByRole("link", { name: "第 3 张" })).toHaveAttribute("href", /^https:\/\/img\.xgif\.cn\/memes\/.+\.gif$/u);

    for (const id of ["20261123-knt5", "20261123-9gow", "20261123-03ld"]) {
      await page.goto(`/${id}`);
      await expect(page).toHaveURL(new RegExp(`/${id}$`, "u"));
      await expect(page.locator("[data-image-gallery]")).toHaveCount(0);
      const link = page.locator(".image-detail-copy").getByRole("link", { name: "粉发小人的小吃摊日常" });
      await expect(link).toHaveCount(0);
    }
  });
});

test("old food stall pages return 404 and search only exposes the gallery", async ({ page, request }) => {
  const retired = ["/images/collections/pink-haired-food-stall", "/20261123-1iy9", "/20261123-qycb"];
  for (const path of retired) {
    for (const suffix of ["", "/"]) {
      expect((await request.get(path + suffix, { maxRedirects: 0 })).status()).toBe(404);
    }
  }
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/20261123-4qiu</loc>");
  for (const path of retired) expect(sitemap).not.toContain(path);
  await page.goto("/images");
  const search = page.getByRole("textbox", { name: "筛选图片" });
  await search.fill("自制芝士汉堡");
  await expect(page.locator("main a.image-card:visible")).toHaveCount(1);
  await expect(page.locator("main a.image-card:visible")).toHaveAttribute("href", "/20261123-4qiu");
});

test("retired member favorites stay in local storage but no longer link to a page", async ({ page, request }) => {
  const catalog = await (await request.get("/favorite-catalog.json")).json();
  expect(catalog["20261123-4qiu"]).toBe("image");
  expect(catalog["20261123-qycb"]).toBeUndefined();
  expect(catalog["20261123-1iy9"]).toBeUndefined();
  await page.addInitScript(() => {
    const savedAt = "2026-11-23T00:00:00.000Z";
    localStorage.setItem("xgif:favorites:v1", JSON.stringify({ format: "xgif-favorites", version: 1, updatedAt: savedAt, items: [
      { kind: "image", contentId: "20261123-qycb", title: "小吃摊后的粉发小人", savedAt },
    ] }));
  });
  await page.goto("/favorites");
  const row = page.locator("[data-favorite-unavailable]").filter({ hasText: "小吃摊后的粉发小人" });
  await expect(row).toBeVisible();
  await expect(row.locator("a[href]")).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("xgif:favorites:v1")));
  expect(saved.items[0].contentId).toBe("20261123-qycb");
});
