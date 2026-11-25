import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const readPage = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");
const readTagPage = (tag) => readPage(`tags/${encodeURIComponent(tag)}/index.html`);

function readMetadata(html) {
  const head = html.split("</head>", 1)[0];
  const title = head.match(/<title>([^<]+)<\/title>/u)?.[1];
  const description = head.match(/<meta name="description" content="([^"]+)"/u)?.[1];
  assert.ok(title);
  assert.ok(description);
  for (const [attribute, value] of [["og:title", title], ["og:description", description]]) {
    assert.ok(head.includes(`<meta property="${attribute}" content="${value}"`), attribute);
  }
  return { title, description };
}

test("entry pages describe GIFs and article topics", async () => {
  const home = readMetadata(await readPage("index.html"));
  assert.match(home.title, /GIF 动图、表情包与文章选读/u);
  assert.match(home.description, /情绪和场景/u);

  const articles = readMetadata(await readPage("articles/index.html"));
  assert.match(articles.title, /文章选读：生活故事与随笔/u);
  assert.match(articles.description, /日常生活、人际关系与成长/u);
  assert.match(articles.description, /来源/u);
});

test("tag metadata describes the content sections actually rendered", async () => {
  const directories = await readdir(new URL("../dist/tags/", import.meta.url), { withFileTypes: true });
  const kindsSeen = new Set();
  for (const { name: tag } of directories.filter((entry) => entry.isDirectory())) {
    const page = await readTagPage(tag);
    const kinds = [];
    if (page.includes('id="tag-articles"')) kinds.push("文章");
    if (page.includes('id="tag-images"')) kinds.push("图片");
    assert.ok(kinds.length, tag);
    const contentKinds = kinds.join("与");
    kindsSeen.add(contentKinds);
    assert.equal(readMetadata(page).description, `浏览「${tag}」标签下的${contentKinds}。`, tag);
  }
  assert.deepEqual(kindsSeen, new Set(["文章", "图片", "文章与图片"]));
});
