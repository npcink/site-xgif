import assert from "node:assert/strict";
import test from "node:test";
import {
  FAVORITES_KEY,
  FavoritesImportError,
  createFavoritesDocument,
  favoriteKey,
  importFavoritesText,
  readFavorites,
  serializeFavorites,
  toggleFavorite,
  writeFavorites,
} from "../public/scripts/favorites-store.js";

const NOW = Date.parse("2026-07-24T08:00:00.000Z");
const article = {
  contentId: "20260724-ab12",
  kind: "article",
  title: "值得收藏的文章",
  href: "javascript:alert(1)",
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

test("toggle uses kind and contentId identity and derives a safe canonical href", () => {
  const added = toggleFavorite(createFavoritesDocument(NOW), article, NOW);
  assert.equal(added.items.length, 1);
  assert.equal(added.items[0].href, "/20260724-ab12");

  const removed = toggleFavorite(added, article, NOW + 1000);
  assert.deepEqual(removed.items, []);
});

test("read and write keep malformed storage recoverable without clearing it", () => {
  const storage = memoryStorage({ [FAVORITES_KEY]: "{bad json" });
  const read = readFavorites(storage, NOW);
  assert.equal(read.favorites.items.length, 0);
  assert.match(read.error, /格式异常|未允许读取/);
  assert.equal(storage.value(FAVORITES_KEY), "{bad json");

  const written = writeFavorites(toggleFavorite(read.favorites, article, NOW), storage, NOW);
  assert.equal(written.ok, true);
  assert.equal(JSON.parse(storage.value(FAVORITES_KEY)).items.length, 1);
});

test("merge import deduplicates items and preserves the earliest savedAt", () => {
  const current = toggleFavorite(createFavoritesDocument(NOW), article, NOW);
  const imported = {
    format: "xgif-favorites",
    version: 1,
    updatedAt: "2026-07-25T00:00:00.000Z",
    items: [
      { ...article, savedAt: "2026-07-23T00:00:00.000Z" },
      {
        contentId: "20260724-cd34",
        kind: "image",
        title: "一张图片",
        savedAt: "2026-07-24T00:00:00.000Z",
        extra: "ignored",
      },
      { contentId: "../../etc", kind: "article", title: "坏数据", savedAt: "today" },
    ],
  };
  const result = importFavoritesText(JSON.stringify(imported), current, {
    now: NOW,
    knownKeys: new Set(["article:20260724-ab12"]),
  });

  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.stats.invalid, 1);
  assert.equal(result.stats.unavailable, 1);
  assert.equal(result.favorites.items.length, 2);
  assert.equal(
    result.favorites.items.find((item) => favoriteKey(item) === favoriteKey(article)).savedAt,
    "2026-07-23T00:00:00.000Z",
  );
});

test("replace import discards current items only after successful validation", () => {
  const current = toggleFavorite(createFavoritesDocument(NOW), article, NOW);
  const replacement = {
    format: "xgif-favorites",
    version: 1,
    updatedAt: "2026-07-24T00:00:00.000Z",
    items: [{
      contentId: "20260724-zz99",
      kind: "image",
      title: "替换项",
      savedAt: "2026-07-24T00:00:00.000Z",
    }],
  };
  const result = importFavoritesText(JSON.stringify(replacement), current, { mode: "replace", now: NOW });
  assert.deepEqual(result.favorites.items.map(favoriteKey), ["image:20260724-zz99"]);
});

test("import rejects invalid JSON, foreign formats, future versions, and oversized files", () => {
  assert.throws(
    () => importFavoritesText("{", createFavoritesDocument(NOW)),
    (error) => error instanceof FavoritesImportError && error.code === "INVALID_JSON",
  );
  assert.throws(
    () => importFavoritesText('{"format":"other","version":1,"items":[]}', createFavoritesDocument(NOW)),
    (error) => error.code === "INVALID_FORMAT",
  );
  assert.throws(
    () => importFavoritesText('{"format":"xgif-favorites","version":2,"items":[]}', createFavoritesDocument(NOW)),
    (error) => error.code === "UNSUPPORTED_VERSION",
  );
  assert.throws(
    () => importFavoritesText("x".repeat(1024 * 1024 + 1), createFavoritesDocument(NOW)),
    (error) => error.code === "FILE_TOO_LARGE",
  );
});

test("serialized exports are versioned and omit untrusted href values", () => {
  const favorites = toggleFavorite(createFavoritesDocument(NOW), article, NOW);
  const exported = JSON.parse(serializeFavorites(favorites, NOW));
  assert.equal(exported.format, "xgif-favorites");
  assert.equal(exported.version, 1);
  assert.equal(exported.items[0].href, "/20260724-ab12");
});
