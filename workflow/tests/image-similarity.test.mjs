import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ImageSimilarityIndex, perceptualFingerprint, compareImageFingerprints } from "../image-similarity.js";

import { sampleImage } from "./fixtures/image-sample.mjs";

test("perceptual comparison finds resized and re-encoded copies while rejecting different and flat images", async () => {
  const original = await sampleImage();
  const jpeg = await sharp(original).resize(190, 190).jpeg({ quality: 55 }).toBuffer();
  const first = await perceptualFingerprint(original);
  assert.notDeepEqual(original, jpeg);
  assert.equal(compareImageFingerprints(first, await perceptualFingerprint(jpeg)).similar, true);
  assert.equal(compareImageFingerprints(first, await perceptualFingerprint(await sampleImage(true))).similar, false);
  const gif = await sharp([original, await sampleImage(true)], { join: { animated: true } }).gif().toBuffer();
  const animated = await perceptualFingerprint(gif);
  assert.equal(animated.animated, true);
  assert.equal(compareImageFingerprints(first, animated).similar, true);
  const flat = await perceptualFingerprint(await sharp({ create: { width: 200, height: 200, channels: 3, background: "white" } }).png().toBuffer());
  assert.equal(compareImageFingerprints(flat, flat).similar, false);
});

test("similarity index rebuilds corrupt cache, excludes the edited entry, and reports missing source bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-image-similarity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "site/src/content/images");
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(root, "site/public/images"), { recursive: true });
  await mkdir(path.join(root, "workflow/records"), { recursive: true });
  const original = await sampleImage();
  const hash = createHash("sha256").update(original).digest("hex");
  await writeFile(path.join(root, "site/public/images/source.png"), original);
  const entry = (title, image) => `---\ntitle: "${title}"\nimage: "${image}"\n---\n`;
  await writeFile(path.join(directory, "source.md"), entry("原图", "/images/source.png"));
  await writeFile(path.join(directory, "remote.md"), entry("缺少字节", "https://img.xgif.cn/missing.png"));
  await writeFile(path.join(directory, "unsafe.md"), entry("越界路径", "/../../secret.png"));
  const cachePath = path.join(root, "workflow/.runtime/image-fingerprints-v1.json");
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, "{broken");
  const index = new ImageSimilarityIndex({ repoRoot: root });
  const identical = await index.check({ buffer: original });
  assert.equal(identical.matches[0].kind, "exact");
  assert.equal(identical.seriesCandidates[0].decision, "duplicate");
  assert.equal(identical.seriesCandidates[0].memberCount, 1);
  const reencoded = await sharp(original).jpeg({ quality: 65 }).toBuffer();
  const report = await index.check({ buffer: reencoded });
  assert.equal(report.matches[0].kind, "similar");
  assert.equal(report.unavailable, 2);
  assert.equal(report.checked, 1);
  assert.ok(JSON.parse(await readFile(cachePath, "utf8")).fingerprints[hash]);
  const excluded = await index.check({ buffer: original, excludeFile: "site/src/content/images/source.md" });
  assert.equal(excluded.matches.length, 0);
  await writeFile(path.join(root, "workflow/records/r2-assets.jsonl"), JSON.stringify({ publicUrl: "https://img.xgif.cn/missing.png", sha256: hash }));
  const restored = await new ImageSimilarityIndex({ repoRoot: root }).check({ buffer: reencoded, excludeFile: "site/src/content/images/source.md" });
  assert.equal(restored.matches[0].title, "缺少字节");
  assert.equal(restored.checked, 1);
  await rm(cachePath);
  const backupDirectory = path.join(root, "workflow/private-sources/r2-assets");
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `${hash}.png`);
  await writeFile(backupPath, original);
  await writeFile(path.join(root, "workflow/records/r2-assets.jsonl"), JSON.stringify({
    publicUrl: "https://img.xgif.cn/missing.png", sha256: hash, objectKey: `memes/${hash}.png`,
  }));
  const fromBackup = await new ImageSimilarityIndex({ repoRoot: root }).check({ buffer: reencoded, excludeFile: "site/src/content/images/source.md" });
  assert.equal(fromBackup.checked, 1);
  await rm(cachePath);
  await writeFile(backupPath, await sampleImage(true));
  const corruptBackup = await new ImageSimilarityIndex({ repoRoot: root }).check({ buffer: reencoded, excludeFile: "site/src/content/images/source.md" });
  assert.equal(corruptBackup.checked, 0);
  assert.equal(corruptBackup.matches.length, 0);
});
