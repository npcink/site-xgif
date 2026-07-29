import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPublicationBundle,
  localAssetFileFromUrl,
  publicationVersion,
  referencedLocalAssetFiles,
  verifiablePublicAssetUrls,
} from "../publication-bundle.js";

test("publication bundle includes frontmatter and Markdown local image dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-bundle-"));
  const article = "site/src/content/articles/article.md";
  const cover = "site/public/images/articles/cover.webp";
  const bodyImage = "site/public/images/memes/2026/body.png";
  const markdown = `---
title: "Bundle"
coverImage: "/images/articles/cover.webp"
---

![Body](/images/memes/2026/body.png)
`;
  try {
    await Promise.all([
      mkdir(path.join(root, path.dirname(article)), { recursive: true }),
      mkdir(path.join(root, path.dirname(cover)), { recursive: true }),
      mkdir(path.join(root, path.dirname(bodyImage)), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, article), markdown),
      writeFile(path.join(root, cover), "cover"),
      writeFile(path.join(root, bodyImage), "body"),
    ]);

    const bundle = await buildPublicationBundle({
      repoRoot: root,
      items: [{ file: article }],
    });
    assert.deepEqual(bundle.files, [article, cover, bodyImage].sort());
    assert.deepEqual(bundle.items[0].assetFiles, [cover, bodyImage].sort());
    assert.match(bundle.items[0].publicationSha256, /^[a-f0-9]{64}$/u);
    assert.equal(Object.keys(bundle.expectedFileSha256).length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication versions change when a referenced asset changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-version-"));
  const article = "site/src/content/articles/article.md";
  const asset = "site/public/images/articles/image.webp";
  const markdown = `---\ntitle: "Version"\n---\n\n![Image](/images/articles/image.webp)\n`;
  try {
    await mkdir(path.join(root, path.dirname(article)), { recursive: true });
    await mkdir(path.join(root, path.dirname(asset)), { recursive: true });
    await writeFile(path.join(root, article), markdown);
    await writeFile(path.join(root, asset), "first");
    const first = await publicationVersion({ repoRoot: root, file: article, strictAssets: true });
    await writeFile(path.join(root, asset), "second");
    const second = await publicationVersion({ repoRoot: root, file: article, strictAssets: true });
    assert.equal(first.contentSha256, second.contentSha256);
    assert.notEqual(first.publicationSha256, second.publicationSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication bundle rejects missing local assets and unsafe paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-publication-missing-"));
  const article = "site/src/content/articles/article.md";
  try {
    await mkdir(path.join(root, path.dirname(article)), { recursive: true });
    await writeFile(path.join(root, article), `---\ntitle: "Missing"\n---\n\n![](/images/articles/missing.webp)\n`);
    await assert.rejects(
      buildPublicationBundle({ repoRoot: root, items: [{ file: article }] }),
      /本地图片不存在/u,
    );
    assert.throws(() => localAssetFileFromUrl("/images/articles/%2e%2e/private.txt"), /无效路径/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset extraction ignores remote and data URLs", () => {
  assert.deepEqual(
    referencedLocalAssetFiles(`![Remote](https://img.example/a.webp)\n<img src="data:image/png;base64,AA==">`),
    [],
  );
});

test("online asset verification is limited to the public site and configured asset origin", () => {
  const markdown = `---
coverImage: "/images/articles/cover.webp"
---
![R2](https://img.xgif.cn/memes/one.webp)
![external](https://untrusted.example/image.webp)
![internal](http://169.254.169.254/latest/meta-data)
`;
  assert.deepEqual(verifiablePublicAssetUrls(markdown, {
    siteBaseUrl: "https://www.xgif.cn",
    assetBaseUrls: ["https://img.xgif.cn"],
  }), [
    "https://www.xgif.cn/images/articles/cover.webp",
    "https://img.xgif.cn/memes/one.webp",
  ]);
});
