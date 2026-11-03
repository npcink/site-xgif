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
  assert.equal(calls[0].options.timeout, 120_000);
  assert.deepEqual(requestedUrls, [`https://img.xgif.cn/memes/${"a".repeat(64)}.png`]);
});

test("expired Wrangler authentication gives a recovery action and removes its temporary upload", async () => {
  const { access } = await import("node:fs/promises");
  let temporaryFile;
  await assert.rejects(ensureR2Asset({ asset,
    config: { enabled: true, bucket: "xgif-memes-prod", publicBaseUrl: "https://img.xgif.cn", wranglerBin: "/tmp/wrangler" },
    siteRoot: "/tmp/site",
    runCommand: async (_command, args) => {
      temporaryFile = args[args.indexOf("--file") + 1];
      throw Object.assign(new Error("failed"), { stderr: "\u001b[31mERROR\u001b[0m In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable" });
    },
    fetchImpl: async () => { throw new Error("must not verify an unsuccessful upload"); },
  }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.match(error.message, /wrangler login/);
    assert.match(error.message, /图片已保留/);
    assert.doesNotMatch(error.message, /\u001b|non-interactive/u);
    return true;
  });
  await assert.rejects(access(temporaryFile), { code: "ENOENT" });
});

test("Wrangler upload timeouts remain retryable", async () => {
  await assert.rejects(ensureR2Asset({ asset,
    config: { enabled: true, bucket: "xgif-memes-prod", publicBaseUrl: "https://img.xgif.cn", wranglerBin: "/tmp/wrangler" },
    siteRoot: "/tmp/site",
    runCommand: async () => { throw Object.assign(new Error("command killed"), { killed: true }); },
  }), { statusCode: 503, message: "R2 上传超时，请检查网络后重试此图片；图片已保留。" });
});

test("a missing bucket identifies account selection as a recovery step", async () => {
  await assert.rejects(ensureR2Asset({ asset,
    config: { enabled: true, bucket: "xgif-memes-prod", publicBaseUrl: "https://img.xgif.cn", wranglerBin: "/tmp/wrangler" },
    siteRoot: "/tmp/site",
    runCommand: async () => { throw Object.assign(new Error("failed"), { stderr: "The specified bucket does not exist." }); },
  }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.match(error.message, /当前 Cloudflare 账号/);
    assert.match(error.message, /xgif-memes-prod/);
    assert.match(error.message, /CLOUDFLARE_ACCOUNT_ID/);
    return true;
  });
});
