import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foodStallGallery, isGalleryChild } from "../src/config/image-collection.ts";
import { isPublicImage } from "../src/lib/image-visibility.mjs";

const read = file => readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");

test("draft and non-public images are independently excluded from public reads", () => {
  for (const [draft, isPublic, expected] of [
    [false, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, false],
  ]) {
    assert.equal(isPublicImage({ data: { draft, public: isPublic } }), expected);
  }
});

test("public gallery children render in their gallery but not as separate public entries", async () => {
  const { cover, members } = foodStallGallery;
  const [archive, favoriteJson, sitemap, detail] = await Promise.all([
    read("images/index.html"), read("favorite-catalog.json"), read("sitemap.xml"), read(`${cover}/index.html`),
  ]);
  const base = archive.match(/data-catalog-base="([^"]+)"/u)[1].slice(1);
  const [metadata, search] = await Promise.all([read(`${base}/images.json`), read(`${base}/search-images.json`)]);
  const catalogIds = new Set(JSON.parse(metadata).items.map(item => item.id));
  const searchIds = new Set(JSON.parse(search).items.map(item => item.id));
  const favorites = JSON.parse(favoriteJson);

  assert.equal((detail.match(/\bdata-gallery-slide(?=\s|>)/gu) || []).length, members.length);
  assert.equal(favorites[cover], "image");
  for (const id of members) {
    const standalone = !isGalleryChild(id);
    assert.equal(catalogIds.has(id), standalone, `catalog: ${id}`);
    assert.equal(searchIds.has(id), standalone, `search: ${id}`);
    assert.equal(Object.hasOwn(favorites, id), standalone, `favorites: ${id}`);
    assert.equal(sitemap.includes(`/${id}</loc>`), standalone, `sitemap: ${id}`);
    if (!standalone) await assert.rejects(read(`${id}/index.html`), { code: "ENOENT" });
  }
});
