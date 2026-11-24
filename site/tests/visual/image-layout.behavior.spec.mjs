import { expect, test } from "@playwright/test";
import { imageArchiveFor } from "./archive-helpers.mjs";

test("tall image cards fit within a square on multi-column archives without cropping", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await imageArchiveFor(page, "20261123-kxrp");
  const image = page.locator('main .image-card[href="/20261123-kxrp"] img');
  await expect(image).toHaveCSS("object-fit", "contain");
  const measure = () => image.evaluate(img => {
    const { width, height } = img.getBoundingClientRect();
    return { ratio: height / width, original: Number(img.getAttribute("height")) / Number(img.getAttribute("width")) };
  });
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => (await measure()).ratio).toBeCloseTo(1, 2);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const { ratio, original } = await measure();
    return Math.abs(ratio - original);
  }).toBeLessThan(0.01);
  expect((await measure()).original).toBeGreaterThan(1.5);
});

async function expectGalleryLayout(gallery) {
  const image = gallery.locator("[data-gallery-slide]:visible img");
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  const geometry = await gallery.evaluate(root => {
    const box = el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const stage = root.querySelector("[data-gallery-stage]");
    const image = stage.querySelector("[data-gallery-slide]:not([hidden]) img");
    return {
      gallery: box(root), stage: box(stage), image: box(image),
      fit: getComputedStyle(image).objectFit,
      position: getComputedStyle(image).objectPosition,
      overflow: root.scrollWidth - root.clientWidth,
      thumbnails: [...root.querySelectorAll(".gallery-thumbnails a")].map(link => ({
        link: box(link), image: box(link.querySelector("img")),
      })),
    };
  });
  // A centered image inside a shrunken, left-aligned stage is still off center.
  expect(Math.abs(geometry.stage.width - geometry.gallery.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.stage.x - geometry.gallery.x)).toBeLessThanOrEqual(1);
  for (const dimension of ["x", "y", "width", "height"]) {
    expect(Math.abs(geometry.image[dimension] - geometry.stage[dimension]), dimension).toBeLessThanOrEqual(1);
  }
  expect(geometry.fit).toBe("contain");
  expect(geometry.position).toBe("50% 50%");
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const { link, image } of geometry.thumbnails) {
    expect(image.width).toBeLessThanOrEqual(link.width);
    expect(image.height).toBeLessThanOrEqual(link.height);
  }
}

test("portrait, landscape and square gallery slides fill a centered stage in routes and dialogs", async ({ page }, testInfo) => {
  const widths = testInfo.project.name === "desktop" ? [1440, 1024, 901] : [900, 768, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/20261112-8jzn");
    const direct = page.locator("main [data-image-gallery]");
    for (let index = 0; index < 3; index += 1) {
      await direct.locator(`[data-gallery-index="${index}"]`).click();
      await expectGalleryLayout(direct);
    }
    await imageArchiveFor(page, "20261112-8jzn");
    await page.locator('main a.image-card[href="/20261112-8jzn"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toHaveClass(/is-ready/);
    await dialog.evaluate(async root => {
      await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
    });
    const gallery = dialog.locator("[data-image-gallery]");
    for (let index = 0; index < 3; index += 1) {
      await gallery.locator(`[data-gallery-index="${index}"]`).click();
      await expectGalleryLayout(gallery);
    }
    const shell = dialog.locator("[data-detail-shell]");
    expect(await shell.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test("reported portrait gallery stays centered after selecting its deferred second image", async ({ page }, testInfo) => {
  await imageArchiveFor(page, "20261117-mpyo");
  await page.locator('main a.image-card[href="/20261117-mpyo"]').click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  const gallery = dialog.locator("[data-image-gallery]");
  await gallery.getByRole("button", { name: "下一张图片" }).click();
  await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 2");
  await expectGalleryLayout(gallery);
  await dialog.screenshot({
    path: testInfo.outputPath(`portrait-gallery-${testInfo.project.name}.png`),
    animations: "disabled",
    mask: [dialog.locator(".related-section"), dialog.locator(".article-recommendations")],
  });
});

test("a deferred gallery slide reports loading without moving its stage", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/20261117-mpyo");
  const gallery = page.locator("main [data-image-gallery]");
  const stage = gallery.locator("[data-gallery-stage]");
  const loading = gallery.locator("[data-gallery-loading]");
  const deferred = gallery.locator("[data-gallery-slide]").nth(1).locator("img");
  const sources = await deferred.evaluate(img => [img.dataset.gallerySrc, ...(img.dataset.gallerySrcset || "").split(",").map(entry => entry.trim().split(/\s/u)[0])]
    .filter(Boolean).map(src => new URL(src, location.href).href));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route(url => sources.includes(url.href), async route => {
    await pending;
    await route.continue();
  });
  const next = gallery.getByRole("button", { name: "下一张图片" });
  await next.scrollIntoViewIfNeeded();
  const height = await stage.evaluate(el => el.clientHeight);
  try {
    await next.click();
    await expect(loading).toBeVisible();
    await expect(gallery.locator("[data-gallery-counter]")).toHaveText("2 / 2");
    expect(await stage.evaluate(el => el.clientHeight)).toBe(height);
  } finally { release(); }
  await expect(loading).toBeHidden();
  await expect.poll(() => deferred.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  expect(await stage.evaluate(el => el.clientHeight)).toBe(height);
});

test("image information has compact spacing, aligned continuation headers and plain text tags", async ({ page }, testInfo) => {
  const widths = testInfo.project.name === "desktop" ? [1440, 901] : [768, 553, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await imageArchiveFor(page, "20261116-rhoh");
    await page.locator('main a.image-card[href="/20261116-rhoh"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await dialog.locator(".image-detail-copy").scrollIntoViewIfNeeded();
    const layout = await dialog.evaluate(root => {
      const box = selector => root.querySelector(selector).getBoundingClientRect().toJSON();
      const copy = root.querySelector(".image-detail-copy");
      return {
        media: box(".image-detail-grid > figure"), copy: box(".image-detail-copy"),
        kicker: box(".section-kicker"), title: box(".image-detail-heading h1"), tags: box(".card-tags"),
        actions: box(".image-detail-actions"), original: box(".image-original-link"),
        hint: box(".image-save-hint"), source: box(".image-source"),
        heading: box(".related-section h2"), more: box(".related-section .content-title > a"),
        sourcePadding: parseFloat(getComputedStyle(copy.querySelector(".image-source")).paddingTop),
        contentLeft: copy.getBoundingClientRect().left + parseFloat(getComputedStyle(copy).paddingLeft),
        overflow: root.querySelector("[data-detail-shell]").scrollWidth - root.querySelector("[data-detail-shell]").clientWidth,
      };
    });
    expect(layout.title.height).toBeGreaterThan(20);
    expect(layout.actions.top - layout.title.bottom).toBeLessThanOrEqual(16);
    expect(layout.original.left).toBe(layout.actions.left);
    expect(layout.original.height).toBeGreaterThanOrEqual(44);
    expect(layout.tags.top).toBeGreaterThan(layout.hint.bottom);
    expect(layout.source.top).toBeGreaterThan(layout.tags.bottom);
    expect(layout.sourcePadding).toBeLessThanOrEqual(16);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    if (width <= 900) {
      expect(layout.kicker.top - layout.media.bottom).toBeLessThanOrEqual(24);
      expect(Math.abs(layout.heading.left - layout.contentLeft)).toBeLessThanOrEqual(1);
      expect(layout.more.bottom).toBeLessThanOrEqual(layout.heading.bottom + 2);
    }
    const tag = dialog.getByRole("link", { name: "#可爱", exact: true });
    await expect(tag).toHaveCSS("border-top-width", "0px");
    await expect(tag).toHaveCSS("border-radius", "0px");
    await tag.focus();
    await expect(tag).toBeFocused();
    if (width === 553) {
      await dialog.screenshot({ path: testInfo.outputPath("image-information.png"), animations: "disabled" });
    }
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).not.toBeVisible();
  }

  for (const route of ["/20261116-rhoh", "/articles", "/20260710-vfks"]) {
    await page.goto(route);
    const tags = page.locator("main .card-tags a, main .card-tags button");
    expect(await tags.count()).toBeGreaterThan(0);
    for (const tag of await tags.all()) {
      await expect(tag).toHaveCSS("border-top-width", "0px");
      await expect(tag).toHaveCSS("border-radius", "0px");
    }
  }
});
