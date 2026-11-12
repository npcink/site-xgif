import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeProcessError } from "./safe-process-error.js";

export const R2_CACHE_CONTROL = "public, max-age=31536000, immutable";

function envEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizePublicBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("XGIF_R2_PUBLIC_BASE_URL 缺失。");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("XGIF_R2_PUBLIC_BASE_URL 必须使用 HTTPS。");
  if (url.username || url.password || url.search || url.hash) throw new Error("XGIF_R2_PUBLIC_BASE_URL 不能包含凭据、查询参数或锚点。");
  if (url.pathname !== "/") throw new Error("XGIF_R2_PUBLIC_BASE_URL 只能填写域名根地址。");
  return url.origin;
}

export function getR2StorageConfig({ env = process.env, siteRoot } = {}) {
  const enabled = envEnabled(env.XGIF_R2_ENABLED);
  const bucket = String(env.XGIF_R2_BUCKET || "").trim();
  const publicBaseUrl = String(env.XGIF_R2_PUBLIC_BASE_URL || "").trim();
  const defaultBin = path.join(String(siteRoot || ""), "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");

  if (!enabled) {
    return { enabled: false, bucket, publicBaseUrl, wranglerBin: String(env.XGIF_WRANGLER_BIN || defaultBin) };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("XGIF_R2_BUCKET 缺失或不是有效的 R2 Bucket 名称。");
  }

  return {
    enabled: true,
    bucket,
    publicBaseUrl: normalizePublicBaseUrl(publicBaseUrl),
    wranglerBin: String(env.XGIF_WRANGLER_BIN || defaultBin),
  };
}

export function r2ObjectKey({ sha256, extension }) {
  const hash = String(sha256 || "").trim().toLowerCase();
  const ext = String(extension || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("R2 对象缺少有效的 SHA-256。");
  if (![".jpg", ".png", ".gif", ".webp"].includes(ext)) throw new Error("R2 对象扩展名不受支持。");
  return `memes/${hash}${ext}`;
}

export function r2PublicUrl(config, objectKey) {
  return `${config.publicBaseUrl}/${String(objectKey).replace(/^\/+/, "")}`;
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function headObject(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { method: "HEAD", cache: "no-store", redirect: "follow" });
  } catch (error) {
    throw new Error(`无法访问 R2 公网域名：${error.message}`);
  }
  return response.status;
}

export async function ensureR2Asset({ asset, config, siteRoot, fetchImpl = fetch, runCommand = runFile, wait = setTimeout }) {
  if (!config?.enabled) throw new Error("R2 图片存储尚未启用。");
  const objectKey = r2ObjectKey(asset);
  const publicUrl = r2PublicUrl(config, objectKey);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "xgif-r2-"));
  const tempFile = path.join(tempDir, `asset${asset.extension}`);
  try {
    await writeFile(tempFile, asset.buffer);
    await runCommand(
      config.wranglerBin,
      [
        "r2",
        "object",
        "put",
        `${config.bucket}/${objectKey}`,
        "--file",
        tempFile,
        "--content-type",
        asset.mime,
        "--cache-control",
        R2_CACHE_CONTROL,
        "--remote",
        "--force",
      ],
      { cwd: siteRoot, timeout: 120_000, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
    );
  } catch (error) {
    const details = safeProcessError(error, { fallback: "未知错误", redactPaths: [siteRoot, os.homedir()], maxLength: 800 });
    if (/CLOUDFLARE_API_TOKEN|not logged in|auth token has expired|authentication error|invalid access token/iu.test(details)) {
      throw Object.assign(new Error("R2 登录已失效或缺少上传凭据。请在本机终端进入 site 目录执行 npx wrangler login，完成 Cloudflare 授权后重试此图片；命令行使用可在 workflow/.env 配置 CLOUDFLARE_API_TOKEN 后重试。图片已保留。"), { statusCode: 503 });
    }
    if (/specified bucket does not exist/iu.test(details)) {
      throw Object.assign(new Error(`当前 Cloudflare 账号找不到 R2 Bucket「${config.bucket}」。请确认登录的是拥有该 Bucket 的账号，并核对 workflow/.env 中的 XGIF_R2_BUCKET 和 CLOUDFLARE_ACCOUNT_ID 后重试；图片已保留。`), { statusCode: 503 });
    }
    if (error.killed || error.code === "ETIMEDOUT") throw Object.assign(new Error("R2 上传超时，请检查网络后重试此图片；图片已保留。"), { statusCode: 503 });
    throw new Error(`R2 上传失败：${details}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const status = await headObject(publicUrl, fetchImpl);
    if (status >= 200 && status < 300) {
      return { objectKey, publicUrl, reused: false };
    }
    if (attempt < 4) await new Promise((resolve) => wait(resolve, 500 * (attempt + 1)));
  }
  throw new Error("R2 已接收对象，但自定义域名尚未能读取该文件；已停止写入内容元数据。");
}
