import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import imageService from "../src/lib/display-image-service.mjs";

const dist = new URL("../dist/", import.meta.url);

test("gallery uses real WebP assets and defers other slides while preserving original links", async () => {
  const html = await readFile(new URL("20261113-ghi5/index.html", dist), "utf8");
  const gallery = html.match(/<section[^>]*data-image-gallery[\s\S]*?<\/section>/u)?.[0];
  assert.ok(gallery);
  const slides = [...gallery.matchAll(/<a\b[^>]*data-gallery-slide[^>]*>([\s\S]*?)<\/a>/gu)];
  assert.equal(slides.length, 8);
  for (const [index, match] of slides.entries()) {
    assert.match(match[0], /href="https:\/\/img\.xgif\.cn\/memes\//u);
    assert.match(match[1], /(?:src|data-gallery-src)="\/_astro\/[^" ]+\.webp"/u);
    if (index) assert.doesNotMatch(match[1], /\ssrc=/u);
  }
  const thumbs = gallery.match(/<nav[\s\S]*<\/nav>/u)?.[0];
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
});
