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

test("external articles retain source URLs and do not duplicate the same titled entry", async () => {
  const articles = await frontmatter("articles");
  const external = articles
    .filter(({ text }) => ["publication", "editorial"].includes(field(text, "sourceKind")))
    .map(({ file, text }) => ({
      file,
      sourceUrl: field(text, "sourceUrl"),
      title: field(text, "title"),
    }));
  const entries = external.map(({ sourceUrl, title }) => `${sourceUrl}\n${title}`);

  assert.ok(external.every(({ sourceUrl }) => sourceUrl), "外部来源文章必须保留 sourceUrl");
  assert.equal(new Set(entries).size, entries.length, "同一来源不能发布同标题的重复条目");
});

test("images include attribution and license metadata", async () => {
  const images = await frontmatter("images");
  const required = ["sourceUrl", "author", "license", "licenseUrl"];

  for (const image of images) {
    const sourceKind = field(image.text, "sourceKind");
    if (sourceKind === "user_provided") {
      assert.equal(field(image.text, "source"), "用户提供", `${path.basename(image.file)} 必须如实标记为用户提供`);
      assert.equal(field(image.text, "license"), "用户确认可发布", `${path.basename(image.file)} 必须记录用户确认的发布授权`);
      continue;
    }
    if (sourceKind === "unknown") {
      assert.equal(field(image.text, "source"), "群聊转存（来源待核实）", `${path.basename(image.file)} 必须明确标记来源待核实`);
      continue;
    }
    for (const name of required) {
      assert.ok(field(image.text, name), `${path.basename(image.file)} 缺少 ${name}`);
    }
  }
});
