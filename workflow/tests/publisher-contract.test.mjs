import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("publisher exposes local public URLs and keeps empty result panels hidden", async () => {
  const [server, envExample, html, app, css] = await Promise.all([
    read("server.js"),
    read(".env.example"),
    read("public/index.html"),
    read("public/app.js"),
    read("public/styles.css"),
  ]);

  assert.match(server, /function publicContentUrl/);
  assert.match(server, /publicUrl: publicContentUrl/);
  assert.match(server, /http:\/\/localhost:4321/);
  assert.doesNotMatch(server, /XGIF_SITE_URL/);
  assert.doesNotMatch(envExample, /XGIF_SITE_URL/);
  assert.match(html, /id="library-open"/);
  assert.match(html, /id="library-result" hidden/);
  assert.match(app, /window\.open\(activeContent\.publicUrl/);
  assert.match(css, /\.result\[hidden\]/);
});

test("publisher writes the metadata required by Astro collections", async () => {
  const [server, html, app] = await Promise.all([read("server.js"), read("public/index.html"), read("public/app.js")]);

  assert.match(server, /sourceKind/);
  assert.match(server, /licenseUrl/);
  assert.match(server, /function normalizeImageAttribution/);
  assert.match(server, /user_provided/);
  assert.match(html, /name="sourceKind"/);
  assert.match(html, /用户提供素材/);
  assert.match(html, /name="confirmedAt"/);
  assert.match(html, /name="licenseUrl"/);
  assert.match(server, /function inspectImageUpload/);
  assert.match(server, /PUBLISHER_MAX_IMAGE_BYTES/);
  assert.match(server, /图片文件重复/);
  assert.match(server, /409/);
  assert.match(html, /data-image-preview="detail"/);
  assert.match(app, /function imagePayload/);
  assert.match(app, /window\.confirm/);
  assert.match(server, /function recordUserProvidedAsset/);
  assert.match(server, /user-provided-assets\.jsonl/);
});

test("publisher imports flomo exports locally as deduplicated drafts", async () => {
  const [server, importer, html, app, css, readme] = await Promise.all([
    read("server.js"),
    read("flomo-import.js"),
    read("public/index.html"),
    read("public/app.js"),
    read("public/styles.css"),
    read("README.md"),
  ]);

  assert.match(html, /data-tab="import"/);
  assert.match(html, /id="flomo-file"/);
  assert.match(server, /\/api\/import\/flomo\/inspect/);
  assert.match(server, /\/api\/import\/flomo\/apply/);
  assert.match(server, /flomo-imports\.jsonl/);
  assert.match(server, /draft: true/);
  assert.match(importer, /normalizeImportText/);
  assert.match(importer, /inflateRawSync/);
  assert.match(html, /AI 整理选中项/);
  assert.match(app, /aiOrganizeSelectedImports/);
  assert.match(css, /\.import-list/);
  assert.match(readme, /原始 ZIP 不会保存到仓库/);
});
