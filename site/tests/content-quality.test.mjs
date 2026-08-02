import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const legacyDisclosure = [
  "> 本页只提供编辑摘要，不转载来源站全文。",
  "",
  "请通过页面中的“查看原始来源”链接阅读完整内容。",
].join("\n");

const rawArticleHtml = /<(?!https?:\/\/)\s*(?:\/?\s*[A-Za-z][^>]*|!--[\s\S]*?--)>/iu;

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

test("all content uses unique stable IDs that match the Markdown filename", async () => {
  const entries = [
    ...(await frontmatter("articles")).map((entry) => ({ ...entry, type: "articles" })),
    ...(await frontmatter("images")).map((entry) => ({ ...entry, type: "images" })),
  ];
  const ids = entries.map(({ file, text }) => {
    const contentId = field(text, "contentId");
    assert.match(contentId || "", /^\d{8}-[a-z0-9]{4}$/, `${file} 缺少有效 contentId`);
    assert.equal(path.basename(file, path.extname(file)), contentId, `${file} 文件名必须与 contentId 一致`);
    return contentId;
  });

  assert.equal(new Set(ids).size, ids.length, "文章和图片的 contentId 必须全局唯一");
});

test("published external articles expose a full body instead of the legacy disclosure", async () => {
  const articles = await frontmatter("articles");
  for (const article of articles) {
    const body = article.text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u)?.[1] || "";
    if (
      field(article.text, "draft") === "true"
      || !["publication", "editorial"].includes(field(article.text, "sourceKind"))
    ) continue;
    assert.notEqual(body.trim(), legacyDisclosure, `${article.file} 仍是旧摘要占位`);
    const bodyLength = body.trim().length;
    if (bodyLength < 80) {
      assert.equal(
        field(article.text, "shortFormReviewed"),
        "true",
        `${article.file} 的短正文尚未明确确认完整`,
      );
      assert.ok(bodyLength >= 20, `${article.file} 的短正文内容不足`);
    }
  }
});

test("public articles contain no raw HTML from imports", async () => {
  const articles = await frontmatter("articles");
  for (const article of articles) {
    const body = article.text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u)?.[1] || "";
    if (field(article.text, "draft") === "true") continue;
    assert.doesNotMatch(body, rawArticleHtml, `${article.file} 包含原始 HTML`);
  }
});
