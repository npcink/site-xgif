import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readOutput = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");

test("home renders progressive detail links and a shared dialog", async () => {
  const home = await readOutput("index.html");

  assert.match(home, /data-detail-link/);
  assert.match(home, /data-detail-dialog/);
  assert.match(home, /\/scripts\/detail-dialog\.js/);
});

test("article and image routes expose extractable detail content", async () => {
  const [article, image] = await Promise.all([
    readOutput("articles/ai-uses-computer/index.html"),
    readOutput("images/still-working/index.html"),
  ]);

  assert.match(article, /data-detail-content/);
  assert.match(article, /data-detail-kind="article"/);
  assert.match(image, /data-detail-content/);
  assert.match(image, /data-detail-kind="image"/);
});

test("dialog controller owns history navigation and failure fallback", async () => {
  const controller = await readFile(
    new URL("../public/scripts/detail-dialog.js", import.meta.url),
    "utf8",
  );

  assert.match(controller, /history\.pushState/);
  assert.match(controller, /popstate/);
  assert.match(controller, /history\.back\(\)/);
  assert.match(controller, /window\.location\.assign/);
  assert.ok(controller.includes("const detailPath = /^\\/(articles|images)\\/.+\\/$/;"));
});

test("sitemap exposes public content and legal pages", async () => {
  const sitemap = await readOutput("sitemap.xml");

  assert.match(sitemap, /https:\/\/www\.xgif\.cn\/articles\/ai-uses-computer\//);
  assert.match(sitemap, /https:\/\/www\.xgif\.cn\/images\/still-working\//);
  assert.match(sitemap, /https:\/\/www\.xgif\.cn\/rights\//);
});

test("article details publish structured data and honest source labels", async () => {
  const [article, editorial] = await Promise.all([
    readOutput("articles/ai-uses-computer/index.html"),
    readOutput("articles/how-memes-speak/index.html"),
  ]);

  assert.match(article, /application\/ld\+json/);
  assert.match(article, /访问来源站/);
  assert.match(editorial, /查看编辑手记/);
});
