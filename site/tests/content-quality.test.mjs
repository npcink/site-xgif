import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const contentRoot = new URL("../src/content/", import.meta.url);

async function frontmatter(directory) {
  const files = (await readdir(new URL(directory, contentRoot))).filter((file) => file.endsWith(".md"));
  return Promise.all(files.map(async (file) => ({
    file,
    text: await readFile(new URL(`${directory}/${file}`, contentRoot), "utf8"),
  })));
}

function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*[\"']?([^\\n\"']+)`, "m"))?.[1]?.trim();
}

test("published articles do not reuse the same original source", async () => {
  const articles = await frontmatter("articles");
  const originals = articles
    .filter(({ text }) => field(text, "sourceKind") !== "publication" && field(text, "sourceKind") !== "editorial")
    .map(({ file, text }) => ({ file, sourceUrl: field(text, "sourceUrl") }));
  const urls = originals.map(({ sourceUrl }) => sourceUrl);

  assert.ok(urls.every(Boolean), "每篇原文必须保留 sourceUrl");
  assert.equal(new Set(urls).size, urls.length, "同一原文只能发布一次");
});

test("images include attribution and license metadata", async () => {
  const images = await frontmatter("images");
  const required = ["sourceUrl", "author", "license", "licenseUrl"];

  for (const image of images) {
    if (field(image.text, "sourceKind") === "user_provided") {
      assert.equal(field(image.text, "source"), "用户提供", `${path.basename(image.file)} 必须如实标记为用户提供`);
      assert.equal(field(image.text, "license"), "用户确认可发布", `${path.basename(image.file)} 必须记录用户确认的发布授权`);
      continue;
    }
    for (const name of required) {
      assert.ok(field(image.text, name), `${path.basename(image.file)} 缺少 ${name}`);
    }
  }
});
