import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { inspectImageFile, runImageTool } from "../image-cli.js";
import { r2ObjectKey, r2PublicUrl } from "../r2-storage.js";

test("image inspection identifies real bytes, preserves GIF animation and rejects unsupported or small files", async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-image-cli-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const file = path.join(repoRoot, "arbitrary.extension");
  const png = await sharp({ create: { width: 200, height: 180, channels: 3, background: "red" } }).png().toBuffer();
  await writeFile(file, png);
  const result = await runImageTool({ repoRoot, file, upload: true });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 200);
  assert.equal(result.byteLength, png.length);
  await assert.rejects(readFile(path.join(repoRoot, "workflow/records/r2-assets.jsonl")), { code: "ENOENT" });
  const gif = await sharp([png, png], { join: { animated: true } }).gif().toBuffer();
  await writeFile(file, gif);
  assert.deepEqual((await inspectImageFile(file)).buffer, gif);
  await writeFile(file, await sharp(png).resize(50, 50).png().toBuffer());
  await assert.rejects(inspectImageFile(file), /160/u);
  await writeFile(file, "not an image");
  await assert.rejects(inspectImageFile(file));
  await writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(inspectImageFile(file), /8 MB/u);
});

test("upload backs up original bytes before external writes and reuses a ledger object without duplicating it", async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-upload-cli-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const file = path.join(repoRoot, "image.png");
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "blue" } }).png().toBuffer();
  await writeFile(file, png);
  const env = { XGIF_R2_ENABLED: "true", XGIF_R2_BUCKET: "xgif-test", XGIF_R2_PUBLIC_BASE_URL: "https://img.example.test" };
  let writes = 0;
  const storeAsset = async ({ asset, config }) => {
    writes += 1;
    assert.deepEqual(await readFile(path.join(repoRoot, `workflow/private-sources/r2-assets/${asset.sha256}.png`)), png);
    const objectKey = r2ObjectKey(asset);
    return { objectKey, publicUrl: r2PublicUrl(config, objectKey), reused: false };
  };
  const result = await runImageTool({ repoRoot, file, upload: true, apply: true, env, storeAsset });
  assert.equal(result.ok, true);
  assert.equal(writes, 1);
  const reused = await runImageTool({ repoRoot, file, upload: true, apply: true, env, storeAsset });
  assert.equal(reused.reused, true);
  assert.equal(writes, 1);
  const rows = (await readFile(path.join(repoRoot, "workflow/records/r2-assets.jsonl"), "utf8")).trim().split("\n");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).publicUrl, result.publicUrl);
});

test("a failed semantic check remains visible in the result and private check record", async t => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-check-record-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const file = path.join(repoRoot, "private-original-name.png");
  await writeFile(file, await sharp({ create: { width: 200, height: 200, channels: 3, background: "blue" } }).png().toBuffer());
  const result = await runImageTool({ repoRoot, file, env: {
    XGIF_EMBEDDING_PROVIDER: "ollama", XGIF_EMBEDDING_BASE_URL: "http://127.0.0.1:11435",
    XGIF_EMBEDDING_MODEL: "test-model", XGIF_EMBEDDING_API_KEY: "private-test-key",
  }, fetchImpl: async () => { throw new Error("private-test-key must not be recorded"); } });
  assert.equal(result.similarity.seriesEmbedding.status, "unavailable");
  assert.equal(result.similarity.checkRecordSaved, true);
  const record = await readFile(path.join(repoRoot, "workflow/.runtime/image-checks.jsonl"), "utf8");
  assert.equal(JSON.parse(record).similarity.seriesEmbedding.status, "unavailable");
  assert.ok(!record.includes("private-test-key"));
  assert.ok(!record.includes(file));
});
