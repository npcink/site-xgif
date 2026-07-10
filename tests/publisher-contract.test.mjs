import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("publisher exposes public URLs and keeps empty result panels hidden", async () => {
  const [server, html, app, css] = await Promise.all([
    read("workflow/server.js"),
    read("workflow/public/index.html"),
    read("workflow/public/app.js"),
    read("workflow/public/styles.css"),
  ]);

  assert.match(server, /function publicContentUrl/);
  assert.match(server, /publicUrl: publicContentUrl/);
  assert.match(html, /id="library-open"/);
  assert.match(html, /id="library-result" hidden/);
  assert.match(app, /window\.open\(activeContent\.publicUrl/);
  assert.match(css, /\.result\[hidden\]/);
});

test("publisher writes the metadata required by Astro collections", async () => {
  const [server, html] = await Promise.all([read("workflow/server.js"), read("workflow/public/index.html")]);

  assert.match(server, /sourceKind/);
  assert.match(server, /licenseUrl/);
  assert.match(server, /validateRequired\(payload, \["title", "description", "sourceUrl", "author", "license", "licenseUrl"\]\)/);
  assert.match(html, /name="sourceKind"/);
  assert.match(html, /name="licenseUrl"/);
});
