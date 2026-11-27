import { expect, test } from "@playwright/test";
import { imageArchiveFor, waitForCatalog } from "./archive-helpers.mjs";

async function expectCompactRecommendations(section, columns) {
  expect(await section.locator(".image-recommendation-grid").evaluate(grid =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").length)).toBe(columns);
  const cards = section.locator(".image-card:visible");
  await expect(cards).toHaveCount(columns * 2);
  await expect(cards.locator(".image-copy, .open-mark")).toHaveCount(0);
  const boxes = await cards.evaluateAll(links => links.map(link => {
    const frame = link.querySelector(".image-recommendation-media");
    const image = frame.querySelector("img");
    return {
      card: link.getBoundingClientRect().toJSON(),
      frame: frame.getBoundingClientRect().toJSON(),
      image: image.getBoundingClientRect().toJSON(),
      width: Number(image.getAttribute("width")),
      height: Number(image.getAttribute("height")),
      overflow: link.scrollWidth - link.clientWidth,
      border: getComputedStyle(link).borderTopWidth,
    };
  }));
  expect(boxes[columns].card.top).toBeGreaterThan(boxes[0].card.bottom);
  expect(boxes[columns].card.left).toBeCloseTo(boxes[0].card.left);
  for (let index = 0; index < boxes.length; index += 1) {
    const { card, frame, image, width, height, overflow, border } = boxes[index];
    expect(card.top).toBeCloseTo(boxes[index - index % columns].card.top);
    expect(card.width).toBeLessThanOrEqual(248);
    expect(card.height).toBeCloseTo(frame.height);
    expect(border).toBe("0px");
    expect(overflow).toBeLessThanOrEqual(1);
    expect(frame.width).toBeCloseTo(frame.height);
    const scale = Math.min(1, frame.width / width, frame.height / height);
    expect(Math.abs(image.width - scale * width)).toBeLessThanOrEqual(1);
    expect(Math.abs(image.height - scale * height)).toBeLessThanOrEqual(1);
    expect(Math.abs((image.left - frame.left) * 2 + image.width - frame.width)).toBeLessThanOrEqual(1);
    expect(Math.abs((image.top - frame.top) * 2 + image.height - frame.height)).toBeLessThanOrEqual(1);
  }
}

test("image archive cards match tags without a visible tag line, and open by keyboard", async ({ page }) => {
  const id = "20261103-wkfq";
  await page.goto("/images");
  await waitForCatalog(page);
  await page.getByRole("textbox", { name: "筛选图片" }).fill("社会观察");
  await expect(page).toHaveURL(/[?&]q=/u);
  const card = page.locator(`main a.image-card[href="/${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByText(/#社会观察|#幽默/u)).toHaveCount(0);
  await expect(card.locator(".image-copy, .open-mark")).toHaveCount(0);
  await expect(card).toHaveCSS("border-top-width", "0px");
  await expect(card).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await card.press("Enter");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(new RegExp(`/${id}$`, "u"));
});

test("image recommendations use two compact rows without enlarging source images", async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  const columns = testInfo.project.name === "mobile" ? 2 : 4;
  const id = "20261117-cfys";
  await page.goto(`/${id}`);
  const section = page.locator("main .related-section");
  const check = async (related, screenshot) => {
    await expectCompactRecommendations(related, columns);
    await expect(related.getByRole("link", { name: "更多图片" })).toHaveAttribute("href", "/images");
    const { images, articles } = await related.evaluate(section => ({
      images: section.querySelector(".content-title").getBoundingClientRect().toJSON(),
      articles: section.parentElement.querySelector(".article-recommendations-heading").getBoundingClientRect().toJSON(),
    }));
    expect(images.left).toBeCloseTo(articles.left);
    expect(images.right).toBeCloseTo(articles.right);
    for (const image of await related.locator(".image-card:visible img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    }
    await related.screenshot({ path: testInfo.outputPath(screenshot), animations: "disabled" });
    const more = related.getByRole("link", { name: "更多图片" });
    await more.press("Tab");
    const first = related.locator(".image-card:visible").first();
    await expect(first).toBeFocused();
    await expect(first).toHaveCSS("outline-style", "solid");
    await page.setViewportSize({ ...viewport, width: 768 });
    await expectCompactRecommendations(related, 3);
    await page.setViewportSize(viewport);
  };
  await check(section, "image-recommendations-detail.png");
  const moving = section.getByRole("link", { name: /，动图$/u, includeHidden: true }).first();
  await expect(moving.locator(".image-recommendation-kind")).toHaveText("动图");

  await imageArchiveFor(page, id);
  const archiveCard = page.locator(`main a.image-card[href="/${id}"]`);
  await expect(archiveCard.locator(".image-count")).toHaveText("图集 · 2 张");
  await expect(archiveCard).toHaveCSS("border-top-width", "0px");
  await expect(archiveCard.locator(".open-mark")).toHaveCount(0);
  await archiveCard.click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog).toHaveClass(/is-ready/u);
  await dialog.evaluate(async root => {
    await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
  });
  await check(dialog.locator(".related-section"), "image-recommendations-dialog.png");
});

test("reported image dialog fills from reserves without repeating viewed images", async ({ page }, testInfo) => {
  const id = "20261123-qc0v";
  const columns = testInfo.project.name === "mobile" ? 2 : 4;
  const limit = columns * 2;
  await imageArchiveFor(page, id);
  const card = page.locator(`main a.image-card[href="/${id}"]`);
  await card.click();
  const dialog = page.locator("[data-detail-dialog]");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await expect(dialog).toHaveClass(/is-ready/u);
  const section = dialog.locator(".related-section");
  const ids = cards => cards.evaluateAll(links => links.map(link => link.dataset.recommendationId));
  const candidates = await ids(section.locator("[data-recommendation-id]"));
  expect(candidates).toHaveLength(12);
  const visible = section.locator(".image-card:visible");
  await expect(visible).toHaveCount(limit);
  expect(await ids(visible)).toEqual(candidates.slice(0, limit));
  await visible.last().click();
  await expect(page).toHaveURL(new RegExp(`/${candidates[limit - 1]}$`, "u"));
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", candidates[limit - 1]);
  await page.goBack();
  await expect(dialog).toHaveClass(/is-ready/u);
  await expect(dialog.locator("[data-detail-content]")).toHaveAttribute("data-content-id", id);
  await expect(visible).toHaveCount(limit);
  expect(await ids(visible)).toEqual([...candidates.slice(0, limit - 1), candidates[limit]]);
});

test("article image recommendations refill from unseen matches without adding a third row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const url = "/20260722-9c7n";
  await page.goto(url);
  const section = page.locator("main .related-section");
  const all = await section.locator("[data-recommendation-id]").evaluateAll(cards => cards.map(card => card.dataset.recommendationId));
  expect(all.length).toBeGreaterThanOrEqual(6);
  const selected = section.locator(".image-card:visible");
  const seedHistory = ids => page.evaluate(entries => sessionStorage.setItem("xgif:seen:v1", JSON.stringify(entries)), ids);
  await seedHistory(all.slice(0, 2));
  await page.reload();
  await expectCompactRecommendations(section, 2);
  expect(await selected.evaluateAll(cards => cards.map(card => card.dataset.recommendationId))).toEqual(all.slice(2, 6));
  await seedHistory(all.slice(0, -2));
  await page.reload();
  await expect(selected).toHaveCount(2);
  await seedHistory(all);
  await page.reload();
  await expect(selected).toHaveCount(0);
  await expect(section.locator("[data-recommendations-empty]")).toBeVisible();
});

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
    const controls = box(root.querySelector(".gallery-controls"));
    return {
      gallery: box(root.querySelector(".public-image-gallery")), stage: box(stage), image: box(image),
      native: [Number(image.getAttribute("width")), Number(image.getAttribute("height"))],
      controlsOffset: controls.y - box(stage).y,
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
  const [width, height] = geometry.native;
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  const scale = Math.min(1, geometry.stage.width / width, geometry.stage.height / height);
  expect(Math.abs(geometry.image.width - width * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.image.height - height * scale)).toBeLessThanOrEqual(1);
  for (const [axis, size] of [["x", "width"], ["y", "height"]]) {
    expect(Math.abs(geometry.image[axis] + geometry.image[size] / 2 - geometry.stage[axis] - geometry.stage[size] / 2)).toBeLessThanOrEqual(1);
  }
  expect(geometry.fit).toBe("contain");
  expect(geometry.position).toBe("50% 50%");
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const { link, image } of geometry.thumbnails) {
    expect(image.width).toBeLessThanOrEqual(link.width);
    expect(image.height).toBeLessThanOrEqual(link.height);
  }
  return [geometry.stage.width, geometry.stage.height, geometry.controlsOffset];
}

test("portrait, landscape and square gallery slides fit a stable stage in routes and dialogs", async ({ page }, testInfo) => {
  const widths = testInfo.project.name === "desktop" ? [1440, 1024, 901] : [900, 768, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/20261112-8jzn");
    const direct = page.locator("main [data-image-gallery]");
    const checkSlides = async (gallery) => {
      let initial;
      for (let index = 0; index < 3; index += 1) {
        await gallery.locator(`[data-gallery-index="${index}"]`).click();
        const stage = await expectGalleryLayout(gallery);
        initial ??= stage;
        expect(stage).toEqual(initial);
      }
    };
    await checkSlides(direct);
    await imageArchiveFor(page, "20261112-8jzn");
    await page.locator('main a.image-card[href="/20261112-8jzn"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toHaveClass(/is-ready/);
    await dialog.evaluate(async root => {
      await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
    });
    const gallery = dialog.locator("[data-image-gallery]");
    await checkSlides(gallery);
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
  await gallery.locator('[data-gallery-index="1"]').click();
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
  const next = gallery.getByRole("link", { name: "第 2 张", exact: true });
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

async function expectImageActions(copy, mediaLabel) {
  await expect(copy.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(copy.locator(".section-kicker")).toHaveText(mediaLabel);
  await expect(copy.getByRole("button", { name: "收藏", exact: true })).toBeVisible();
  await expect(copy.getByRole("link", { name: "查看原图" })).toHaveAttribute("target", "_blank");
  await expect(copy.getByRole("button", { name: "复制链接", exact: true })).toBeVisible();
  const geometry = await copy.evaluate(root => {
    const box = selector => root.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      title: box("h1"), label: box(".section-kicker"), primary: box(".image-original-link"), actions: box(".image-detail-actions"),
      favorite: box(".favorite-toggle"), copy: box(".copy-link-button"), meta: box(".image-detail-meta"),
      source: box(".image-source"), overflow: root.scrollWidth - root.clientWidth,
    };
  });
  expect(geometry.title.height).toBeGreaterThan(20);
  expect(geometry.label.top).toBeGreaterThan(geometry.title.bottom);
  expect(geometry.primary.top).toBeGreaterThan(geometry.label.bottom);
  if (geometry.actions.width >= geometry.favorite.width + geometry.copy.width + 8) {
    expect(geometry.favorite.top).toBeCloseTo(geometry.copy.top);
    expect(geometry.favorite.left).toBeLessThan(geometry.copy.left);
  } else {
    expect(geometry.copy.top).toBeGreaterThanOrEqual(geometry.favorite.bottom);
  }
  expect(geometry.primary.top).toBeLessThanOrEqual(geometry.favorite.top);
  for (const action of [geometry.primary, geometry.favorite, geometry.copy]) expect(action.height).toBeGreaterThanOrEqual(43.5);
  expect(geometry.meta.top).toBeGreaterThan(geometry.actions.bottom);
  expect(geometry.source.top).toBeGreaterThan(geometry.meta.bottom);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
}

test("the reported animated image stays at native size in routes and dialogs", async ({ page }, testInfo) => {
  for (const width of testInfo.project.name === "desktop" ? [1440, 1024] : [390, 230]) {
    await page.setViewportSize({ width, height: 900 });
    const checkSize = async (detail) => {
      const image = detail.locator(".single-image-media img");
      await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
      const geometry = await detail.evaluate(root => {
        const box = selector => root.querySelector(selector).getBoundingClientRect().toJSON();
        const layout = root.querySelector(".single-image-layout");
        const css = getComputedStyle(layout);
        const availableWidth = layout.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
        return { image: box(".single-image-media img"), frame: box(".single-image-media"), copy: box(".image-detail-copy"), availableWidth };
      });
      expect(geometry.image.width).toBeCloseTo(Math.min(200, geometry.availableWidth), 0);
      expect(geometry.image.height).toBeCloseTo(geometry.image.width);
      expect(geometry.frame.width).toBeCloseTo(geometry.image.width);
      if (width > 900) {
        expect(geometry.copy.left - geometry.image.right).toBeGreaterThan(0);
        expect(geometry.copy.left - geometry.image.right).toBeLessThanOrEqual(44);
      }
      if (width === 230) expect(geometry.image.width).toBeLessThan(200);
    };
    await page.goto("/20261123-knt5");
    const detail = page.locator("main .image-detail");
    const copy = detail.locator(".image-detail-copy");
    await expect(detail.locator("[data-image-gallery], .gallery-thumbnails")).toHaveCount(0);
    await expect(copy.getByRole("link", { name: "查看原图" })).toHaveAttribute("href", /\.gif$/u);
    await expect(copy.getByRole("link", { name: "权利人投诉与下架" })).toBeVisible();
    await expectImageActions(copy, "动图详情");
    await checkSize(detail);
    await imageArchiveFor(page, "20261123-knt5");
    await page.locator('main a.image-card[href="/20261123-knt5"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toHaveClass(/is-ready/u);
    await dialog.evaluate(async (root) => {
      await new Promise(requestAnimationFrame);
      await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
    });
    await checkSize(dialog.locator(".image-detail"));
    await expectImageActions(dialog.locator(".image-detail-copy"), "动图详情");
  }
});

test("the audited standalone image displays its existing title and keeps the original action", async ({ page }) => {
  await page.goto("/20261124-1mr5");
  const copy = page.locator(".image-detail-copy");
  const h1 = copy.getByRole("heading", { name: "你来的正是时候", level: 1 });
  expect((await h1.boundingBox()).height).toBeGreaterThan(20);
  await expect(copy.getByText("此图为 Lanczos 放大版。", { exact: true })).toBeVisible();
  await expect(copy.getByRole("link", { name: "查看放大版" })).toHaveAttribute("target", "_blank");
});

test("image information has compact spacing, aligned continuation headers and plain text tags", async ({ page }, testInfo) => {
  const widths = testInfo.project.name === "desktop" ? [1440, 901] : [768, 553, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await imageArchiveFor(page, "20261116-rhoh");
    await page.locator('main a.image-card[href="/20261116-rhoh"]').click();
    const dialog = page.locator("[data-detail-dialog]");
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog).toHaveClass(/is-ready/u);
    await dialog.evaluate(async (root) => {
      await new Promise(requestAnimationFrame);
      await Promise.allSettled(root.getAnimations().map(animation => animation.finished));
    });
    await dialog.locator(".image-detail-copy").scrollIntoViewIfNeeded();
    await expectImageActions(dialog.locator(".image-detail-copy"), "图片详情");
    await expect(dialog.getByText("场景：日常分享", { exact: true })).toBeVisible();
    const layout = await dialog.evaluate(root => {
      const box = selector => root.querySelector(selector).getBoundingClientRect().toJSON();
      const copy = root.querySelector(".image-detail-copy");
      return {
        media: box(".image-detail-grid > figure"), copy: box(".image-detail-copy"),
        title: box(".image-detail-heading h1"),
        heading: box(".related-section h2"), more: box(".related-section .content-title > a"),
        sourcePadding: parseFloat(getComputedStyle(copy.querySelector(".image-source")).paddingTop),
        contentLeft: copy.getBoundingClientRect().left + parseFloat(getComputedStyle(copy).paddingLeft),
        overflow: root.querySelector("[data-detail-shell]").scrollWidth - root.querySelector("[data-detail-shell]").clientWidth,
      };
    });
    expect(layout.sourcePadding).toBeLessThanOrEqual(16);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    if (width <= 900) {
      expect(layout.title.top - layout.media.bottom).toBeLessThanOrEqual(24);
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
