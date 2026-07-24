import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listReusableAssets } from "../asset-library.js";

test("asset library joins image metadata with local and R2 backup state", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-assets-"));
  const entries = path.join(repoRoot, "site", "src", "content", "images");
  const publicImages = path.join(repoRoot, "site", "public", "images");
  const records = path.join(repoRoot, "workflow", "records");
  const privateAssets = path.join(repoRoot, "workflow", "private-sources", "r2-assets");
  await Promise.all([
    mkdir(entries, { recursive: true }),
    mkdir(publicImages, { recursive: true }),
    mkdir(records, { recursive: true }),
    mkdir(privateAssets, { recursive: true }),
  ]);
  await writeFile(path.join(publicImages, "one.png"), Buffer.from("local-image"));
  await writeFile(path.join(entries, "one.md"), `---
title: "本地素材"
contentId: "20260724-0001"
description: "本地图片"
image: "/images/one.png"
tags: ["反应图"]
source: "原创"
sourceKind: "original"
pubDate: "2026-07-24"
public: true
draft: false
---
`, "utf8");
  await writeFile(path.join(entries, "two.md"), `---
title: "R2 素材"
contentId: "20260724-0002"
description: "远端图片"
image: "https://img.xgif.cn/memes/hash.webp"
tags: ["反应图"]
source: "用户提供"
sourceKind: "user_provided"
pubDate: "2026-07-24"
public: true
draft: false
---
`, "utf8");
  await writeFile(path.join(records, "r2-assets.jsonl"), `${JSON.stringify({
    publicUrl: "https://img.xgif.cn/memes/hash.webp",
    objectKey: "memes/hash.webp",
    sha256: "abcd",
    byteLength: 42,
  })}\n`, "utf8");

  const report = await listReusableAssets({ repoRoot });
  assert.equal(report.counts.total, 2);
  assert.equal(report.counts.local, 1);
  assert.equal(report.counts.r2, 1);
  assert.equal(report.items.find((item) => item.storage === "local").backup.ok, true);
  assert.equal(report.items.find((item) => item.storage === "r2").backup.ok, false);
});
