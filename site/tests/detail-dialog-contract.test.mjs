import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "astro/markdown";
import { UNPUBLISHED_ARTICLE_IDS } from "../scripts/lib/release-acceptance-contract.mjs";

const readOutput = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");

async function detailOutputs(kind) {
  const root = new URL("../dist/", import.meta.url);
  const entries = await readdir(root, { withFileTypes: true });
  const outputs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d{8}-[a-z0-9]{4}$/u.test(entry.name))
      .map(async (entry) => {
        try {
          return await readOutput(`${entry.name}/index.html`);
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
      }),
  );
  return outputs.filter((output) => output?.includes(`data-detail-kind="${kind}"`));
}

test("home renders progressive detail links and a shared dialog", async () => {
  const home = await readOutput("index.html");

  assert.match(home, /data-detail-link/);
  assert.match(home, /data-detail-dialog/);
  assert.match(home, /\/scripts\/detail-dialog\.js/);
  assert.doesNotMatch(
    home,
    /href="\/(?!")[^"#?]+\/"/u,
    "公开页面链接不得带尾斜杠",
  );
});

test("article and image routes expose extractable detail content", async () => {
  const [articles, images] = await Promise.all([
    detailOutputs("article"),
    detailOutputs("image"),
  ]);
  const article = articles[0];
  const image = images[0];

  assert.ok(article, "构建结果至少应包含一篇公开文章");
  assert.ok(image, "构建结果至少应包含一张公开图片");
  assert.match(article, /data-detail-content/);
  assert.match(article, /data-detail-kind="article"/);
  assert.match(article, /class="article-recommendations"/);
  assert.equal(
    (article.match(/class="article-recommendation"[^>]*data-recommendation-id="[^"]+"(?! hidden)[^>]*>/g) || []).length,
    3,
    "公开文章末尾应提供三篇继续阅读内容",
  );
  assert.match(article, /class="article-recommendation"[^>]*data-detail-link/);
  assert.match(image, /data-detail-content/);
  assert.match(image, /data-detail-kind="image"/);
  assert.match(image, /接着看图片/);
});

test("unknown-source images expose a direct rights and takedown route", async () => {
  const page = await readFile(
    new URL("../src/components/ImageDetailPage.astro", import.meta.url),
    "utf8",
  );
  const rights = await readFile(new URL("../src/pages/rights.astro", import.meta.url), "utf8");

  assert.match(page, /sourceKind === "unknown"/);
  assert.match(page, /权利人投诉与下架/);
  assert.match(page, /href="\/rights"/);
  assert.match(rights, /1355471563@qq\.com/);
  assert.match(rights, /微信群或 QQ 群转存/);
});

test("dialog controller owns history navigation and failure fallback", async () => {
  const controller = await readFile(
    new URL("../public/scripts/detail-dialog.js", import.meta.url),
    "utf8",
  );

  assert.match(controller, /history\.pushState/);
  assert.match(controller, /popstate/);
  assert.match(controller, /detailDialogDepth/);
  assert.match(controller, /history\.go\(-detailDepth\)/);
  assert.match(controller, /window\.location\.assign/);
  assert.ok(controller.includes("const detailPath = /^\\/\\d{8}-[a-z0-9]{4}$/;"));
});

test("sitemap exposes public content and legal pages", async () => {
  const sitemap = await readOutput("sitemap.xml");

  assert.match(sitemap, /https:\/\/www\.xgif\.cn\/\d{8}-[a-z0-9]{4}<\/loc>/);
  assert.doesNotMatch(sitemap, /https:\/\/www\.xgif\.cn\/(?:articles|images)\/\d{8}-[a-z0-9]{4}/);
  assert.match(sitemap, /https:\/\/www\.xgif\.cn\/rights<\/loc>/);
});

test("legacy typed detail routes are not emitted", async () => {
  await Promise.all([
    assert.rejects(() => readOutput("articles/20260710-vfks/index.html"), /ENOENT/),
    assert.rejects(() => readOutput("images/20260707-6s1n/index.html"), /ENOENT/),
  ]);
});

test("article details publish structured data and honest source labels", async () => {
  const [articles, component] = await Promise.all([
    detailOutputs("article"),
    readFile(new URL("../src/components/ArticleDetailPage.astro", import.meta.url), "utf8"),
  ]);

  assert.ok(articles.some((article) => /application\/ld\+json/.test(article)));
  assert.ok(articles.some((article) => /访问来源站/.test(article)));
  assert.match(component, /publication:\s*"访问来源站"/);
  assert.match(component, /editorial:\s*"访问来源站"/);
  assert.match(component, /sourcePending/);
  assert.match(component, /暂未找到可核验的原始来源/);
  assert.match(component, /补充来源线索 \/ 版权反馈/);
});

test("production output excludes draft previews and unpublished content IDs", async () => {
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  const [drafts, privateImages, output] = await Promise.all([
    unpublishedIds("articles", (data) => data.draft === true || data.publicationHold === true),
    unpublishedIds("images", (data) => data.draft === true || data.public === false),
    readdir(root, { recursive: true, withFileTypes: true }),
  ]);
  const hidden = new Set([...drafts, ...privateImages, ...UNPUBLISHED_ARTICLE_IDS]);
  const assertNoHiddenIds = (text, file) => {
    for (const [id] of text.matchAll(/\b\d{8}-[a-z0-9]{4}\b/gu)) {
      assert.ok(!hidden.has(id), `${file} must not expose unpublished content ID ${id}`);
    }
  };

  for (const entry of output) {
    const file = join(entry.parentPath, entry.name);
    const name = relative(root, file).split(sep).join("/");
    assert.doesNotMatch(name, /^preview\/articles(?:[/.]|$)/u);
    assertNoHiddenIds(name, name);
    if (entry.isFile() && (/\.(?:html|json|xml|css)$/u.test(name) || name === "_redirects")) {
      assertNoHiddenIds(await readFile(file, "utf8"), name);
    }
  }
});

async function unpublishedIds(kind, isUnpublished) {
  const root = fileURLToPath(new URL(`../src/content/${kind}/`, import.meta.url));
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const ids = [];
  for (const entry of files) {
    if (!entry.isFile() || !/\.mdx?$/u.test(entry.name)) continue;
    const { frontmatter } = parseFrontmatter(await readFile(join(entry.parentPath, entry.name), "utf8"));
    if (isUnpublished(frontmatter)) ids.push(frontmatter.contentId);
  }
  return ids;
}
