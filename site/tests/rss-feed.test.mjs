import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const contentRoot = new URL("../src/content/articles/", import.meta.url);
const feedUrl = new URL("../dist/rss.xml", import.meta.url);

function field(text, name) {
  return text.match(new RegExp(`^${name}:\\s*["']?([^\\n"']+)`, "m"))?.[1]?.trim();
}

test("RSS exposes a bounded, newest-first list of public articles", async () => {
  const feed = await readFile(feedUrl, "utf8");
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/gu)].map((match) => match[1]);
  const dates = items
    .map((item) => item.match(/<pubDate>([^<]+)<\/pubDate>/u)?.[1])
    .filter(Boolean)
    .map((value) => Date.parse(value));

  assert.match(feed, /<rss\b/u);
  assert.match(feed, /<language>zh-CN<\/language>/u);
  assert.ok(items.length > 0, "RSS 至少应包含一篇公开文章");
  assert.ok(items.length <= 50, "RSS 条目数必须保持有界");
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), "RSS 必须按发布日期倒序排列");
  assert.ok(
    items.every((item) => /https:\/\/www\.xgif\.cn\/\d{8}-[a-z0-9]{4}(?:<|&lt;)/u.test(item)),
    "RSS 条目必须使用稳定的正式文章 URL",
  );
  assert.doesNotMatch(
    feed,
    /https:\/\/www\.xgif\.cn\/\d{8}-[a-z0-9]{4}\//u,
    "RSS 文章 URL 不得带尾斜杠",
  );
  assert.ok(items.some((item) => /<source url=/u.test(item)), "外部文章应保留原始来源");
  assert.doesNotMatch(feed, /content:encoded/u, "RSS 第一版只发布摘要，不重发完整正文");
});

test("RSS never exposes draft article IDs", async () => {
  const feed = await readFile(feedUrl, "utf8");
  const files = (await readdir(contentRoot)).filter((file) => file.endsWith(".md"));
  const drafts = await Promise.all(
    files.map(async (file) => {
      const markdown = await readFile(new URL(file, contentRoot), "utf8");
      return field(markdown, "draft") === "true" ? field(markdown, "contentId") : null;
    }),
  );

  for (const contentId of drafts.filter(Boolean)) {
    assert.doesNotMatch(feed, new RegExp(`/${contentId}/`, "u"));
  }
});

test("public pages advertise the RSS feed and robots points to the canonical sitemap", async () => {
  const [home, robots] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/robots.txt", import.meta.url), "utf8"),
  ]);

  assert.match(
    home,
    /<link rel="alternate" type="application\/rss\+xml" title="xgif\.cn 文章" href="https:\/\/www\.xgif\.cn\/rss\.xml">/u,
  );
  assert.match(home, /<a href="\/rss\.xml">RSS<\/a>/u);
  assert.match(robots, /^User-agent: \*\nAllow: \/\nSitemap: https:\/\/www\.xgif\.cn\/sitemap\.xml\n$/u);
});
