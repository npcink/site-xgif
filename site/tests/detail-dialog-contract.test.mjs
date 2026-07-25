import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

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
    (article.match(/class="article-recommendation"/g) || []).length,
    3,
    "公开文章末尾应提供三篇继续阅读内容",
  );
  assert.match(article, /class="article-recommendation"[^>]*data-detail-link/);
  assert.match(image, /data-detail-content/);
  assert.match(image, /data-detail-kind="image"/);
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

test("production build excludes local draft preview routes", async () => {
  await assert.rejects(
    () => readOutput("preview/articles/ai-uses-computer/index.html"),
    /ENOENT/,
  );
});
