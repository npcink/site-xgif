import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");

test("initial archives contain one page, search starts empty, and deferred cards have no active image sources", async () => {
  for (const [name, count] of [["articles", 12], ["images", 24], ["search", 0]]) {
    const html = await read(`${name}/index.html`);
    assert.equal((html.match(/data-search-item/g) || []).length, count, name);
    const base = html.match(/data-catalog-base="([^"]+)"/)[1].slice(1);
    for (const kind of ["articles", "images"]) {
      const metadata = JSON.parse(await read(`${base}/${kind}.json`));
      const search = JSON.parse(await read(`${base}/search-${kind}.json`));
      assert.equal(metadata.revision, search.revision);
      assert.deepEqual(metadata.items.map(item => item.id), search.items.map(item => item.id));
      assert.equal(new Set(metadata.items.map(item => item.id)).size, metadata.items.length);
    }
    const fragment = await read(`${base}/cards/images/2/index.html`);
    assert.equal((fragment.match(/data-catalog-id=/g) || []).length, 24);
    assert.doesNotMatch(fragment, /<img\b[^>]*\s(?:src|srcset)=/u);
    assert.match(fragment, /data-card-src=/u);
  }
});

test("article cards do not duplicate the searchable text from the index", async () => {
  const articleTags = html => html.match(/<article\b[^>]*\bclass="article-card\b[^>]*>/gu) || [];
  const archive = await read("articles/index.html");
  const base = archive.match(/data-catalog-base="([^"]+)"/u)[1].slice(1);
  for (const name of ["index.html", "articles/index.html", "tags/哲学/index.html",
    "browse/articles/2/index.html", `${base}/cards/articles/2/index.html`]) {
    const tags = articleTags(await read(name));
    assert.ok(tags.length > 0, name);
    assert.ok(tags.every(tag => !/\sdata-search=/u.test(tag)), name);
  }
});
