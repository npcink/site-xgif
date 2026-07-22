import assert from "node:assert/strict";
import test from "node:test";
import { ensureR2Asset, getR2StorageConfig, R2_CACHE_CONTROL, r2ObjectKey, r2PublicUrl } from "../r2-storage.js";

const asset = {
  buffer: Buffer.from("image-bytes"),
  extension: ".png",
  mime: "image/png",
  sha256: "a".repeat(64),
};

test("R2 stays opt-in and validates its public boundary", () => {
  assert.equal(getR2StorageConfig({ env: {}, siteRoot: "/tmp/site" }).enabled, false);
  assert.throws(
    () => getR2StorageConfig({ env: { XGIF_R2_ENABLED: "true", XGIF_R2_BUCKET: "Bad_bucket", XGIF_R2_PUBLIC_BASE_URL: "https://img.xgif.cn" } }),
    /Bucket/,
  );
  assert.throws(
    () => getR2StorageConfig({ env: { XGIF_R2_ENABLED: "true", XGIF_R2_BUCKET: "xgif-memes-prod", XGIF_R2_PUBLIC_BASE_URL: "http://img.xgif.cn" } }),
    /HTTPS/,
  );
});

test("R2 object keys and public URLs are content addressed", () => {
  const config = { publicBaseUrl: "https://img.xgif.cn" };
  assert.equal(r2ObjectKey(asset), `memes/${"a".repeat(64)}.png`);
  assert.equal(r2PublicUrl(config, r2ObjectKey(asset)), `https://img.xgif.cn/memes/${"a".repeat(64)}.png`);
});

test("R2 upload uses Wrangler metadata and verifies the public URL", async () => {
  const requestedUrls = [];
  const calls = [];
  const result = await ensureR2Asset({
    asset,
    config: {
      enabled: true,
      bucket: "xgif-memes-prod",
      publicBaseUrl: "https://img.xgif.cn",
      wranglerBin: "/tmp/wrangler",
    },
    siteRoot: "/tmp/site",
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return { status: 200 };
    },
    runCommand: async (command, args, options) => calls.push({ command, args, options }),
    wait: (resolve) => resolve(),
  });

  assert.equal(result.reused, false);
  assert.equal(result.publicUrl, `https://img.xgif.cn/memes/${"a".repeat(64)}.png`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/tmp/wrangler");
  assert.ok(calls[0].args.includes("xgif-memes-prod/memes/" + "a".repeat(64) + ".png"));
  assert.ok(calls[0].args.includes(R2_CACHE_CONTROL));
  assert.ok(calls[0].args.includes("--remote"));
  assert.deepEqual(requestedUrls, [`https://img.xgif.cn/memes/${"a".repeat(64)}.png`]);
});
