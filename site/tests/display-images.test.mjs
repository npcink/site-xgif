import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import imageService from "../src/lib/display-image-service.mjs";

const dist = new URL("../dist/", import.meta.url);

test("gallery uses real WebP assets and defers other slides while preserving original links", async () => {
  const html = await readFile(new URL("20261113-ghi5/index.html", dist), "utf8");
  const stage = html.match(/<figure\b[^>]*\sdata-gallery-stage\b[^>]*>[\s\S]*?<\/figure>/u)?.[0];
  assert.ok(stage);
  const slides = [...stage.matchAll(/<div\b[^>]*data-gallery-slide[^>]*>([\s\S]*?)<\/div>/gu)];
  assert.equal(slides.length, 8);
  for (const [index, match] of slides.entries()) {
    assert.match(match[1], /(?:src|data-gallery-src)="\/_astro\/[^" ]+\.webp"/u);
    if (index) assert.doesNotMatch(match[1], /\ssrc=/u);
  }
  const strips = [...html.matchAll(/<nav\b[^>]*class="gallery-thumbnails"[^>]*>[\s\S]*?<\/nav>/gu)];
  assert.equal(strips.length, 1);
  const [thumbs] = strips[0];
  assert.equal([...thumbs.matchAll(/href="https:\/\/img\.xgif\.cn\/memes\//gu)].length, 8);
  const urls = [...thumbs.matchAll(/\ssrc="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(urls.length, 8);
  for (const url of urls) {
    const bytes = await readFile(new URL(`.${url}`, dist));
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 120);
    assert.ok((await stat(new URL(`.${url}`, dist))).size < 20000);
  }
  assert.match(html, /data-gallery-original href="https:\/\/img\.xgif\.cn\/memes\/c3007c[^" ]+\.png"/u);
});

test("WebP encoder retains animation frames, timing, and finite loop count", async () => {
  const input = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]), {
    raw: { width: 2, height: 2, channels: 3, pageHeight: 1 },
  }).gif({ loop: 3, delay: [80, 140] }).toBuffer();
  const result = await imageService.transform(input, { src: "animation.gif", width: 2, format: "webp", quality: 82 }, {
    service: { config: {} },
  });
  const metadata = await sharp(result.data, { animated: true }).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [80, 140]);
  assert.equal(metadata.loop, 3);

  const poster = await imageService.transform(input, { src: "animation.gif", width: 2, format: "webp", quality: 82, firstFrame: true }, {
    service: { config: {} },
  });
  const still = await sharp(poster.data, { animated: true }).metadata();
  assert.equal(still.pages || 1, 1);
  assert.equal(still.height, 1);
  assert.ok((await sharp(poster.data).raw().toBuffer())[0] > 240);
});

test("animated list cards request static posters while detail retains animation", async () => {
  const list = await readFile(new URL("images/index.html", dist), "utf8");
  const base = list.match(/data-catalog-base="([^"]+)"/)[1];
  const catalog = JSON.parse(await readFile(new URL(`.${base}/images.json`, dist), "utf8"));
  const entry = catalog.items.find(item => item.mediaTypes === "animated");
  const fragment = await readFile(new URL(`.${base}/cards/images/${entry.page}/index.html`, dist), "utf8");
  const card = fragment.match(new RegExp(`<a\\b[^>]*data-catalog-id="${entry.id}"[\\s\\S]*?</a>`))[0];
  assert.match(card, /data-animation-poster/u);
  const poster = card.match(/data-card-src="([^"]+)"/)[1];
  const metadata = await sharp(await readFile(new URL(`.${poster}`, dist)), { animated: true }).metadata();
  assert.equal(metadata.pages || 1, 1);
  const detail = await readFile(new URL(`${entry.id}/index.html`, dist), "utf8");
  const main = detail.match(/<img\b[^>]*\ssrc="([^"]+)"/)[1];
  const moving = await sharp(await readFile(new URL(`.${main}`, dist)), { animated: true }).metadata();
  assert.ok(moving.pages > 1);
});

test("static thumbnails honor source EXIF orientation", async () => {
  const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const poster = await imageService.transform(input, { src: "portrait.jpg", format: "webp", firstFrame: true }, {
    service: { config: {} },
  });
  const metadata = await sharp(poster.data).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 3);
});
