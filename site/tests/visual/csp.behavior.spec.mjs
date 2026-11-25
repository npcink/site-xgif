import { imageArchiveFor } from "./archive-helpers.mjs";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const headers = await readFile(new URL("../../public/_headers", import.meta.url), "utf8");
const policy = headers.match(/Content-Security-Policy: (.+)/u)[1];
const origin = "https://csp-fixture.example";

test.afterEach(async ({ page }) => {
  // Assertions are complete; late virtual-host responses may be cancelled at teardown.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.beforeEach(async ({ page, baseURL }) => {
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
});

test("image dimensions work under production CSP on direct pages and dialogs", async ({ page }) => {
  async function checkRatio(article) {
    const layout = article.locator('[data-image-ratio="648x486"]');
    await expect(layout).toHaveCSS("--image-native-width", "648px");
    await expect(layout).toHaveCSS("--image-aspect-ratio", "648 / 486");
    const image = layout.locator("figure img");
    await expect(image).toHaveCSS("aspect-ratio", "648 / 486");
    await expect(image).toHaveCSS("object-fit", "contain");
    await expect(layout).not.toHaveAttribute("style", /./u);
    const { width, height } = await image.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(width).toBeLessThanOrEqual(648);
    expect(height).toBeLessThanOrEqual(486);
    expect(width / height).toBeCloseTo(648 / 486);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
  await page.goto(`${origin}/20261112-6ix8`);
  await checkRatio(page.locator("main .image-detail"));
  await imageArchiveFor(page, "20261112-6ix8", `${origin}/images`);
  await page.locator('a[data-detail-link][href="/20261112-6ix8"]').first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await checkRatio(dialog.locator(".image-detail"));
});

test("all editorial galleries keep their stage and switch images under production CSP", async ({ page }) => {
  for (const [slug, count] of [
    ["costume-dialogue", 3],
    ["white-horned-mask", 2],
    ["lopital", 2],
  ]) {
    await page.goto(`${origin}/images/collections/${slug}`);
    const gallery = page.locator("[data-collection-gallery]");
    const stage = gallery.locator("[data-gallery-stage]");
    const thumbnails = gallery.locator("[data-gallery-index]");
    await expect(thumbnails).toHaveCount(count);
    const before = await stage.boundingBox();
    expect(before.height).toBeGreaterThan(200);
    expect(before.width).toBeLessThanOrEqual(page.viewportSize().width);
    await thumbnails.nth(1).click();
    await expect(thumbnails.nth(1)).toHaveAttribute("aria-current", "true");
    const image = gallery.locator("[data-gallery-slide]:visible img");
    await expect(image).toHaveCSS("object-fit", "contain");
    await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
    const after = await stage.boundingBox();
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
});

async function expectThumbnailPlacement(gallery, { stacked, count }) {
  const strip = gallery.getByRole("navigation", { name: "选择图集图片" });
  await expect(strip).toHaveCount(1);
  await expect(strip.getByRole("link")).toHaveCount(count);
  await expect(strip.locator('[aria-current="true"]')).toHaveCount(1);
  const counter = gallery.locator("[data-gallery-counter]");
  await expect(counter).toHaveCount(1);
  await expect(counter).toBeVisible();
  for (const step of [-1, 1]) {
    const button = gallery.locator(`[data-gallery-step="${step}"]`);
    if (stacked) await expect(button).toBeVisible();
    else await expect(button).toBeHidden();
  }
  const { stage, media, controls, thumbs, copy, source, overflow } = await gallery.evaluate(element => {
    const box = selector => element.querySelector(selector).getBoundingClientRect().toJSON();
    const strip = element.querySelector(".gallery-thumbnails");
    return {
      stage: box(".gallery-stage"), media: box(".public-image-gallery"),
      controls: box(".gallery-controls"), thumbs: box(".gallery-thumbnails"),
      copy: box(".image-detail-copy"), source: box(".image-source"),
      overflow: [strip.scrollWidth - strip.clientWidth, strip.scrollHeight - strip.clientHeight],
    };
  });
  expect(overflow).toEqual([0, 0]);
  expect(stage.bottom).toBeCloseTo(media.bottom);
  if (stacked) {
    expect(controls.top).toBeCloseTo(stage.bottom);
    expect(thumbs.top).toBeCloseTo(controls.bottom);
    expect(thumbs.left).toBeCloseTo(controls.left);
    expect(thumbs.width).toBeCloseTo(controls.width);
    expect(thumbs.bottom).toBeLessThanOrEqual(copy.top + 1);
  } else {
    expect(thumbs.left).toBeGreaterThanOrEqual(stage.right - 1);
    expect(thumbs.left).toBeCloseTo(source.left);
    expect(thumbs.top).toBeGreaterThan(source.bottom);
    expect(controls.left).toBeGreaterThanOrEqual(thumbs.right);
    expect(controls.top + controls.height / 2).toBeCloseTo(thumbs.top + thumbs.height / 2);
  }
}

test("ordinary gallery thumbnails move to the side without duplicating the controls under production CSP", async ({ page }, testInfo) => {
  const id = "20261117-cfys";
  const path = `/${id}`;
  const viewport = page.viewportSize();
  const stacked = testInfo.project.name === "mobile";
  const check = async (root) => {
    const gallery = root.locator("[data-image-gallery]");
    await expect(gallery).toHaveCount(1);
    await expect(gallery.locator(".section-kicker")).toHaveText("图集 · 2 张");
    await expectThumbnailPlacement(gallery, { stacked, count: 2 });
    // Verify the layout switches at the same breakpoint in a route and a dialog.
    await page.setViewportSize({ ...viewport, width: stacked ? 901 : 900 });
    await expectThumbnailPlacement(gallery, { stacked: !stacked, count: 2 });
    await page.setViewportSize(viewport);
    await expectThumbnailPlacement(gallery, { stacked, count: 2 });
    const stage = gallery.locator("[data-gallery-stage]");
    const before = await stage.boundingBox();
    const next = gallery.getByRole("link", { name: "第 2 张", exact: true });
    await next.click();
    await expect(next).toHaveAttribute("aria-current", "true");
    await expect(gallery.locator("[data-gallery-original]")).toHaveAttribute("href", await next.getAttribute("href"));
    await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 2");
    const after = await stage.boundingBox();
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
    await expect(page).toHaveURL(`${origin}${path}`);
    await next.press("ArrowLeft");
    await expect(gallery.locator("[data-gallery-counter]")).toHaveText("1 / 2");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  };
  await page.goto(`${origin}${path}`);
  await check(page.locator("main"));
  await page.locator("main [data-image-gallery]").screenshot({ path: testInfo.outputPath("ordinary-gallery-detail.png"), animations: "disabled" });
  await imageArchiveFor(page, id, `${origin}/images`);
  await page.locator(`a.image-card[href="${path}"]`).first().click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveClass(/is-ready/u);
  await dialog.evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  });
  await check(dialog);
  await dialog.screenshot({ path: testInfo.outputPath("ordinary-gallery-dialog.png"), animations: "disabled" });
});

test("the food stall gallery plays all three images without leaving the detail under production CSP", async ({ page }, testInfo) => {
  const path = "/20261123-4qiu";
  const originals = [
    /59dddf482ecf2b6c7c951dcf85e12c4b4bd7d8744a0cb2d2a90fad85e55c9b5a\.gif$/u,
    /2c20af4cac6f5c55ae32ce995daba60cf43e15c75aec10aaee6caa5243c795b0\.gif$/u,
    /4194c0dae3e586b2652fe069e97f2f9c7c872f69b31ab98444a60b9e3ff57fba\.gif$/u,
  ];
  await page.goto(`${origin}${path}`);
  await expect(page.getByRole("heading", { name: "粉发小人的小吃摊日常" })).toBeVisible();
  const gallery = page.locator("[data-image-gallery]");
  const stage = gallery.locator("[data-gallery-stage]");
  async function checkFrame(root, index) {
    await expect(root.locator("[data-gallery-counter]")).toHaveText(`${index + 1} / 3`);
    await expect(root.locator("[data-gallery-original]")).toHaveAttribute("href", originals[index]);
    await expect(root.locator("[data-gallery-slide]:visible")).toHaveCount(1);
    const image = root.locator("[data-gallery-slide]:visible img");
    await expect(image).toHaveCSS("object-fit", "contain");
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  }
  async function checkLayout(root, mobile) {
    const gallery = root.locator("[data-image-gallery]");
    await expectThumbnailPlacement(gallery, { stacked: mobile, count: 3 });
    for (const action of [gallery.getByRole("button", { name: "收藏图集" }), gallery.getByRole("button", { name: "复制图集链接" }), gallery.getByRole("link", { name: "查看原图" })]) {
      await expect(action).toBeVisible();
      expect(await action.evaluate((element) => element.offsetHeight)).toBeGreaterThanOrEqual(44);
    }
    const { title, label, favorite, copy, actions, source } = await gallery.evaluate((element) => {
      const box = (selector) => element.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        title: box(".gallery-title"), label: box(".section-kicker"),
        favorite: box("[data-favorite-toggle]"), copy: box("[data-copy-url]"), actions: box(".image-detail-actions"),
        source: box(".image-source"),
      };
    });
    expect(copy.y).toBeCloseTo(favorite.y);
    expect(label.y).toBeGreaterThan(title.bottom);
    expect(actions.y).toBeGreaterThan(label.bottom);
    expect(source.y).toBeGreaterThan(actions.bottom);
  }
  await expect(gallery.locator("[data-gallery-slide]")).toHaveCount(3);
  await checkFrame(page, 0);
  const mobile = testInfo.project.name === "mobile";
  await checkLayout(page, mobile);
  const stageBox = await stage.boundingBox();
  if (mobile) {
    // Use trusted browser touch input rather than calling the JS event handler directly.
    const client = await page.context().newCDPSession(page);
    for (const [start, end, index] of [[0.8, 0.2, 1], [0.2, 0.8, 0]]) {
      const { x, y, width, height } = await stage.boundingBox();
      const point = (fraction) => ({ x: x + fraction * width, y: y + height / 2 });
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(start)] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point((start + end) / 2)] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(end)] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await checkFrame(page, index);
    }
    await client.detach();
    await gallery.getByRole("button", { name: "下一张图片" }).click();
  } else {
    await gallery.focus();
    await page.keyboard.press("ArrowRight");
  }
  await checkFrame(page, 1);
  if (mobile) await gallery.getByRole("button", { name: "下一张图片" }).click();
  else await gallery.locator('[data-gallery-index="2"]').click();
  await checkFrame(page, 2);
  expect((await stage.boundingBox()).height).toBeCloseTo(stageBox.height);
  await expect(gallery.locator('[data-gallery-step="1"]')).toBeDisabled();
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator(".collection-members")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("food-stall-detail.png") });
  if (!mobile) {
    const viewport = page.viewportSize();
    await page.setViewportSize({ ...viewport, width: 1024 });
    await checkLayout(page, false);
    await page.setViewportSize(viewport);
  }

  await imageArchiveFor(page, path.slice(1), `${origin}/images`);
  const card = page.locator(`a.image-card[href="${path}"]`).first();
  await expect(card.locator(".image-count")).toHaveText("图集 · 3 张 · 含动图");
  await card.click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveClass(/is-ready/u);
  await checkLayout(dialog, mobile);
  await checkFrame(dialog, 0);
  if (mobile) await dialog.getByRole("button", { name: "下一张图片" }).click();
  else await dialog.locator('[data-gallery-index="1"]').click();
  await checkFrame(dialog, 1);
  await page.screenshot({ path: testInfo.outputPath("food-stall-dialog.png"), animations: "disabled" });
  await expect(page).toHaveURL(`${origin}${path}`);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});
