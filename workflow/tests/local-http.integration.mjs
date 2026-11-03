import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { sampleImage } from "./fixtures/image-sample.mjs";

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const heldFixture = path.join(workflowRoot, "../site/src/content/articles/20990101-hold.md");
let fixtureCreated = false;
const galleryCleanup = [];
let imageFixtureCreated = false;
let assetFixtureCreated = false;
const imageFixture = path.join(workflowRoot, "../site/src/content/images/20990101-dupe.md");
const assetFixture = path.join(workflowRoot, "../site/public/images/xgif-duplicate-fixture.png");
const port = 18_000 + (process.pid % 10_000);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "xgif-http-integration-"));
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
  cwd: workflowRoot,
  env: {
    ...process.env,
    PORT: String(port),
    XGIF_PUBLISHER_TEST_MODE: "true",
    XGIF_LOCAL_DATABASE_PATH: path.join(temporaryDirectory, "xgif.sqlite3"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

function call({ method = "GET", pathname, headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          rawBody: Buffer.concat(chunks),
          body: text,
          json: () => JSON.parse(text),
        });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await call({ pathname: "/api/health" });
      if (response.status === 200) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`本地发布器集成测试启动超时。\n${output}`);
}

try {
  await waitUntilReady();
  const health = await call({ pathname: "/api/health" });
  assert.equal(health.status, 200);
  assert.equal(health.json().service, "xgif-local-publisher");

  const staticAsset = await call({
    pathname: "/app.js?v=integration",
    headers: { "accept-encoding": "br, gzip" },
  });
  assert.equal(staticAsset.status, 200);
  assert.equal(staticAsset.headers["content-encoding"], "br");
  assert.match(staticAsset.headers["cache-control"], /no-cache/);
  assert.ok(staticAsset.headers.etag);
  assert.ok(staticAsset.rawBody.byteLength > 0);
  const unchangedAsset = await call({
    pathname: "/app.js?v=integration",
    headers: { "if-none-match": staticAsset.headers.etag },
  });
  assert.equal(unchangedAsset.status, 304);

  const hostileHost = await call({
    pathname: "/api/health",
    headers: { host: "attacker.example" },
  });
  assert.equal(hostileHost.status, 403);

  const hostileOrigin = await call({
    pathname: "/api/status",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(hostileOrigin.status, 403);

  const missingCsrf = await call({
    method: "POST",
    pathname: "/api/not-a-route",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(missingCsrf.status, 403);

  const session = await call({ pathname: "/api/session" });
  const csrf = session.json().csrfToken;
  assert.ok(csrf);
  const initialStatus = await call({ pathname: "/api/status" });
  assert.equal(initialStatus.status, 200);
  assert.equal(initialStatus.json().statusMeta.stale, false);
  assert.ok(initialStatus.json().statusMeta.checkedAt);
  const cachedStatus = await call({ pathname: "/api/status" });
  assert.equal(cachedStatus.status, 200);
  assert.equal(
    cachedStatus.json().statusMeta.checkedAt,
    initialStatus.json().statusMeta.checkedAt,
  );
  const refreshedStatus = await call({ pathname: "/api/status?refresh=remote" });
  assert.equal(refreshedStatus.status, 200);
  assert.equal(refreshedStatus.json().statusMeta.stale, false);
  const validCsrf = await call({
    method: "POST",
    pathname: "/api/not-a-route",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: "{}",
  });
  assert.equal(validCsrf.status, 404);

  const malformedJson = await call({
    method: "POST",
    pathname: "/api/ai/article-title-suggestions",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: "{broken",
  });
  assert.equal(malformedJson.status, 400);
  assert.match(malformedJson.json().error, /有效的 JSON/u);

  const emptyTitleSuggestions = await call({
    method: "POST",
    pathname: "/api/ai/article-title-suggestions",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: "{}",
  });
  assert.equal(emptyTitleSuggestions.status, 400);
  assert.match(emptyTitleSuggestions.json().error, /正文、摘要或来源链接/);

  const overlongParagraph = await call({
    method: "POST",
    pathname: "/api/quality/article",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      title: "长段落测试",
      summary: "用于确认发布质量门槛会拦截未分段的长正文。",
      source: "原创内容",
      sourceKind: "original",
      tags: ["生活"],
      body: "需要分段的正文。".repeat(30),
    }),
  });
  assert.equal(overlongParagraph.status, 200);
  assert.equal(overlongParagraph.json().ok, false);
  assert.match(overlongParagraph.json().issues.map((item) => item.message).join(" "), /超过 180 字的长段落/);

  const placeholderTitle = await call({
    method: "POST",
    pathname: "/api/quality/article",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      title: "待整理 · 2026-01-10 · 15",
      summary: "用于确认占位标题不能进入正式发布流程。",
      source: "原创内容",
      sourceKind: "original",
      tags: ["生活"],
      body: "这是一段字段完整、长度适中的正文，唯一需要阻断的问题是标题仍然属于导入阶段产生的占位标题。",
    }),
  });
  assert.equal(placeholderTitle.status, 200);
  assert.equal(placeholderTitle.json().ok, false);
  assert.match(placeholderTitle.json().issues.map((item) => item.message).join(" "), /占位标题/);

  const missingSource = await call({
    method: "POST",
    pathname: "/api/quality/article",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      title: "缺少来源链接也可发布",
      summary: "用于确认来源待确认的文章不再被质量检查阻止。",
      source: "来源待确认",
      sourceKind: "unknown",
      tags: ["生活"],
      body: "这是一段已经完成整理的正文。虽然暂时找不到具体来源链接，但公开页面会如实说明来源待确认，并保留版权反馈入口。",
    }),
  });
  assert.equal(missingSource.status, 200);
  assert.equal(missingSource.json().ok, true);
  assert.match(missingSource.json().issues.map((item) => item.message).join(" "), /会明确显示“来源待确认”/);

  const genericSource = await call({
    method: "POST",
    pathname: "/api/quality/article",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      title: "网站首页不是具体来源",
      summary: "用于确认网站首页会得到直接处理提示，而不是被误认为系列文章。",
      source: "知乎",
      sourceKind: "publication",
      sourceUrl: "https://www.zhihu.com/",
      tags: ["生活"],
      body: "这是一段用于来源质量检查的正文。它会帮助确认网站首页不能冒充具体原文，也不会因为其他文章使用同一个首页而提示为系列内容。",
    }),
  });
  assert.equal(genericSource.status, 200);
  assert.equal(genericSource.json().ok, true);
  assert.match(genericSource.json().issues.map((item) => item.message).join(" "), /只指向网站首页/);
  assert.doesNotMatch(genericSource.json().issues.map((item) => item.message).join(" "), /同一原文拆分/);
  const post = (pathname, data) => call({
    method: "POST", pathname,
    headers: { "content-type": "application/json", "x-xgif-csrf": csrf },
    body: JSON.stringify(data),
  });
  const article = {
    title: "发布拦截测试", summary: "一段用于验证发布限制的普通摘要。",
    source: "原创内容", sourceKind: "original", tags: ["生活"],
    recommendationGroup: "general", body: "用于验证的普通正文。",
  };
  const processingReply = await post("/api/publish/article", {
    ...article, summary: "无法按原文整理。如需，我可以提供其他帮助。", draft: false,
  });
  assert.equal(processingReply.status, 422);
  assert.match(processingReply.json().error, /AI 处理回复/);
  const heldQuality = await post("/api/quality/article", { ...article, publicationHold: true });
  assert.equal(heldQuality.json().ok, false);
  assert.match(heldQuality.json().issues.map((item) => item.message).join(" "), /禁止公开发布/);

  await writeFile(heldFixture, `---
contentId: "20990101-hold"
title: "发布拦截测试"
summary: "普通摘要"
source: "原创内容"
sourceKind: "original"
tags: ["生活"]
pubDate: 2099-01-01
recommendationGroup: "general"
publicationHold: true
draft: true
---

用于验证的普通正文。
`, { flag: "wx" });
  fixtureCreated = true;
  const file = "site/src/content/articles/20990101-hold.md";
  const version = async () => createHash("sha256").update(await readFile(heldFixture)).digest("hex");
  for (const publicationHold of [undefined, false]) {
    const saved = await post("/api/content/update", {
      type: "article", file, expectedContentSha256: await version(),
      data: { ...article, draft: true, publicationHold },
    });
    assert.equal(saved.status, 200, saved.body);
    assert.match(await readFile(heldFixture, "utf8"), /publicationHold: true/);
  }
  const before = await readFile(heldFixture, "utf8");
  const publishHeld = await post("/api/content/update", {
    type: "article", file, expectedContentSha256: await version(),
    data: { ...article, draft: false, publicationHold: false },
  });
  assert.equal(publishHeld.status, 422);
  assert.match(publishHeld.json().error, /禁止公开发布/);
  const batchHeld = await post("/api/content/batch", {
    action: "publish", autoOrganizeParagraphs: true, confirmInternalReview: true,
    items: [{ type: "article", file, expectedContentSha256: await version(), recommendationGroup: "general" }],
  });
  assert.equal(batchHeld.status, 200, batchHeld.body);
  assert.equal(batchHeld.json().succeeded.length, 0);
  assert.equal(batchHeld.json().failed.length, 1);
  assert.match(JSON.stringify(batchHeld.json().failed), /禁止公开发布/);
  assert.equal(await readFile(heldFixture, "utf8"), before);
  // Gallery uploads are durable resources; a content entry appears only after every member is ready.
  const galleryImages = [];
  for (let i = 0; i < 12; i += 1) {
    const buffer = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: i * 17, g: 60, b: 255 - i * 17 } } }).png().toBuffer();
    const hash = createHash("sha256").update(buffer).digest("hex");
    galleryCleanup.push(path.join(workflowRoot, `../site/public/images/memes/${hash.slice(0, 24)}.png`));
    const upload = await post("/api/assets/upload", { purpose: "image-gallery", fileData: `data:image/png;base64,${buffer.toString("base64")}` });
    assert.equal(upload.status, 200, upload.body);
    galleryImages.push({ src: upload.json().url, width: 1, height: 1 });
  }
  const gallery = { title: "十二张图集集成验证", description: "图集展示验证", tags: ["生活"], sourceKind: "unknown", mood: "开心", scenes: "聊天", category: "表情包", images: galleryImages, draft: true, commit: false, push: false };
  const excess = await post("/api/publish/image", { ...gallery, images: [...galleryImages, galleryImages[0]] });
  assert.equal(excess.status, 422, excess.body);
  assert.match(excess.json().error, /1 至 12/);
  const repeated = await post("/api/publish/image", { ...gallery, images: [galleryImages[0], galleryImages[0]] });
  assert.equal(repeated.status, 422);
  const unsafe = await post("/api/publish/image", { ...gallery, images: [{ src: "http://127.0.0.1/private.png" }] });
  assert.equal(unsafe.status, 422);
  const quality = (await post("/api/quality/image", gallery)).json();
  assert.equal(quality.ok, true, JSON.stringify(quality.issues));
  assert.equal(quality.perImage.length, 12);
  const published = await post("/api/publish/image", { ...gallery, similarityReviewedHashes: quality.perImage.map((image) => image.sha256) });
  assert.equal(published.status, 200, published.body);
  const galleryFile = published.json().file;
  galleryCleanup.push(path.join(workflowRoot, "..", galleryFile));
  const saved = await call({ pathname: `/api/content/read?type=image&file=${encodeURIComponent(galleryFile)}` });
  assert.equal(saved.json().data.images.length, 12);
  assert.equal(saved.json().data.images[0].width, 320, "dimensions come from bytes, not the client");
  const reversed = [...saved.json().data.images].reverse();
  const updated = await post("/api/content/update", { type: "image", file: galleryFile, expectedContentSha256: published.json().contentSha256, data: { ...gallery, draft: false, images: reversed } });
  assert.equal(updated.status, 200, updated.body);
  const reopened = await call({ pathname: `/api/content/read?type=image&file=${encodeURIComponent(galleryFile)}` });
  assert.deepEqual(reopened.json().data.images.map((image) => image.src), reversed.map((image) => image.src));
  assert.equal(reopened.json().data.image, reversed[0].src);
  const stale = await post("/api/content/update", { type: "image", file: galleryFile, expectedContentSha256: published.json().contentSha256, data: gallery });
  assert.equal(stale.status, 409);
  const duplicateMember = await post("/api/quality/image", { ...gallery, title: "复制非封面图片", images: [galleryImages[11]] });
  assert.equal(duplicateMember.json().ok, false);
  assert.match(JSON.stringify(duplicateMember.json().issues), /已存在/);
  await rm(path.join(workflowRoot, "..", galleryFile), { force: true });
  const legacyImage = "/images/xgif-gallery-legacy-small.PNG";
  const legacyFile = "site/src/content/images/20990101-oldg.md";
  galleryCleanup.push(path.join(workflowRoot, "../site/public", legacyImage), path.join(workflowRoot, "..", legacyFile));
  const legacyBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();
  await writeFile(path.join(workflowRoot, "../site/public", legacyImage), legacyBytes, { flag: "wx" });
  const legacyMarkdown = `---\ncontentId: "20990101-oldg"\ntitle: "旧小图"\ndescription: "旧单图继续可编辑"\nimage: "${legacyImage}"\nsourceKind: "unknown"\ntags: ["生活"]\ndraft: true\n---\n`;
  await writeFile(path.join(workflowRoot, "..", legacyFile), legacyMarkdown, { flag: "wx" });
  const legacyEdit = await post("/api/content/update", { type: "image", file: legacyFile, expectedContentSha256: createHash("sha256").update(legacyMarkdown).digest("hex"), data: { title: "旧单图编辑", description: "保持旧图片", tags: ["生活"], sourceKind: "unknown", draft: true, images: [{ src: legacyImage }] } });
  assert.equal(legacyEdit.status, 200, legacyEdit.body);
  const legacyRead = (await call({ pathname: `/api/content/read?type=image&file=${encodeURIComponent(legacyFile)}` })).json();
  assert.equal(legacyRead.data.images[0].width, 64);
  const originalImage = await sampleImage();
  await writeFile(assetFixture, originalImage, { flag: "wx" });
  assetFixtureCreated = true;
  await writeFile(imageFixture, `---
contentId: "20990101-dupe"
title: "相似图测试"
image: "/images/xgif-duplicate-fixture.png"
description: "用于查重测试"
category: "表情包"
ratio: "square"
source: "群聊转存（来源待核实）"
sourceKind: "unknown"
tags: ["生活"]
pubDate: 2099-01-01
draft: true
public: false
---
`, { flag: "wx" });
  imageFixtureCreated = true;
  const asDataUrl = (buffer, mime) => `data:${mime};base64,${buffer.toString("base64")}`;
  const exactImage = await post("/api/publish/image", {
    title: "改名的同一张图片", description: "测试重复拦截", sourceKind: "unknown",
    fileName: "renamed.png", fileData: asDataUrl(originalImage, "image/png"),
  });
  assert.equal(exactImage.status, 409, exactImage.body);
  const resizedImage = await sharp(originalImage).resize(240, 240).jpeg({ quality: 65 }).toBuffer();
  const fileData = asDataUrl(resizedImage, "image/jpeg");
  const similarImage = await post("/api/check/image", { fileData });
  assert.equal(similarImage.status, 200, similarImage.body);
  assert.ok(similarImage.json().similarity.matches.some((item) => item.title === "相似图测试" && item.kind === "similar"));
  const unreviewed = await post("/api/publish/image", {
    title: "相似的不同文件", description: "需要先比较", sourceKind: "unknown",
    fileName: "smaller.jpg", fileData,
    similarityReviewedSha256: createHash("sha256").update(originalImage).digest("hex"),
  });
  assert.equal(unreviewed.status, 422, unreviewed.body);
  assert.match(unreviewed.json().error, /检查相似图片/);
  console.log("本地发布器 HTTP 集成检查通过。");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  for (const file of galleryCleanup) await rm(file, { force: true });
  if (fixtureCreated) await rm(heldFixture, { force: true });
  if (imageFixtureCreated) await rm(imageFixture, { force: true });
  if (assetFixtureCreated) await rm(assetFixture, { force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
