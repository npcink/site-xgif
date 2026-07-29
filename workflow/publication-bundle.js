import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const publicContentPrefixes = [
  "site/src/content/articles/",
  "site/src/content/images/",
];

export const publicAssetPrefixes = [
  "site/public/images/articles/",
  "site/public/images/memes/",
];

function portablePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizedRepositoryFile(file) {
  const normalized = portablePath(file).replace(/^\.\/+/u, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`发布文件路径无效：${normalized || "(empty)"}`);
  }
  return normalized;
}

export function isPublicContentFile(file) {
  const normalized = portablePath(file);
  return normalized.endsWith(".md")
    && publicContentPrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function isPublicAssetFile(file) {
  const normalized = portablePath(file);
  return publicAssetPrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function normalizePublicContentFile(file) {
  const normalized = normalizedRepositoryFile(file);
  if (!isPublicContentFile(normalized)) {
    throw new Error(`同步文件不在公开内容白名单中：${normalized}`);
  }
  return normalized;
}

export function normalizePublicAssetFile(file) {
  const normalized = normalizedRepositoryFile(file);
  if (!isPublicAssetFile(normalized)) {
    throw new Error(`同步文件不在公开资产白名单中：${normalized}`);
  }
  return normalized;
}

function parseFrontmatterScalar(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return "";
    }
  }
  return raw.replace(/^['"]|['"]$/gu, "");
}

export function localAssetFileFromUrl(value) {
  const source = String(value || "").trim();
  if (!source || /^(?:data:|https?:\/\/)/iu.test(source)) return "";
  try {
    if (decodeURIComponent(source.split(/[?#]/u, 1)[0]).split("/").includes("..")) {
      throw new Error(`本地图片地址包含无效路径：${source}`);
    }
  } catch (error) {
    if (/包含无效路径/u.test(error.message)) throw error;
    throw new Error(`本地图片地址无效：${source}`);
  }
  let pathname;
  try {
    const url = new URL(source, "http://xgif.local");
    if (url.origin !== "http://xgif.local") return "";
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new Error(`本地图片地址无效：${source}`);
  }
  const relative = pathname.replace(/^\/+/u, "");
  if (!relative || relative.split("/").includes("..")) {
    throw new Error(`本地图片地址包含无效路径：${source}`);
  }
  const file = `site/public/${relative}`;
  return isPublicAssetFile(file) ? file : "";
}

export function referencedAssetUrls(markdown) {
  const source = String(markdown || "");
  const urls = [];
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] || "";
  for (const line of frontmatter.split(/\r?\n/u)) {
    const field = line.match(/^(?:image|coverImage):\s*(.*)$/u);
    if (field) urls.push(parseFrontmatterScalar(field[1]));
  }
  for (const match of source.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu)) {
    urls.push(match[1] || match[2] || "");
  }
  for (const match of source.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    urls.push(match[1] || "");
  }
  return [...new Set(urls.map((url) => String(url || "").trim()).filter(Boolean))];
}

export function referencedLocalAssetFiles(markdown) {
  return referencedAssetUrls(markdown)
    .map(localAssetFileFromUrl)
    .filter(Boolean)
    .sort();
}

export function verifiablePublicAssetUrls(markdown, {
  siteBaseUrl,
  assetBaseUrls = [],
}) {
  const siteUrl = new URL(siteBaseUrl);
  const allowedOrigins = new Set([
    siteUrl.origin,
    ...assetBaseUrls.filter(Boolean).map((value) => new URL(value).origin),
  ]);
  return referencedAssetUrls(markdown)
    .filter((value) => !value.startsWith("data:"))
    .map((value) => new URL(value, siteUrl))
    .filter((url) => allowedOrigins.has(url.origin))
    .map((url) => url.href);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function publicationVersion({
  repoRoot,
  file,
  markdown,
  strictAssets = false,
}) {
  const contentFile = normalizePublicContentFile(file);
  const content = markdown ?? await readFile(path.join(repoRoot, contentFile), "utf8");
  const contentSha256 = sha256(content);
  const assetFiles = referencedLocalAssetFiles(content);
  const assets = [];

  for (const assetFile of assetFiles) {
    const absolute = path.join(repoRoot, assetFile);
    try {
      const metadata = await stat(absolute);
      if (!metadata.isFile()) throw new Error("not a file");
      assets.push({
        file: assetFile,
        sha256: sha256(await readFile(absolute)),
      });
    } catch (error) {
      if (strictAssets) {
        const missing = new Error(`内容引用的本地图片不存在：${assetFile}`);
        missing.statusCode = 422;
        missing.cause = error;
        throw missing;
      }
      assets.push({ file: assetFile, sha256: "missing" });
    }
  }

  const publicationSha256 = assets.length
    ? sha256([
      `${contentFile}\0${contentSha256}`,
      ...assets.map((asset) => `${asset.file}\0${asset.sha256}`),
    ].join("\n"))
    : contentSha256;
  return {
    file: contentFile,
    contentSha256,
    publicationSha256,
    assetFiles,
    assets,
  };
}

export async function buildPublicationBundle({
  repoRoot,
  items,
}) {
  const bundledItems = [];
  const expectedFileSha256 = {};
  const files = new Set();

  for (const item of items || []) {
    const version = await publicationVersion({
      repoRoot,
      file: item.file,
      strictAssets: true,
    });
    if (item.contentSha256 && item.contentSha256 !== version.contentSha256) {
      const error = new Error(`内容在上线体检后发生变化，已停止同步：${version.file}`);
      error.statusCode = 409;
      throw error;
    }
    files.add(version.file);
    expectedFileSha256[version.file] = version.contentSha256;
    for (const asset of version.assets) {
      files.add(asset.file);
      expectedFileSha256[asset.file] = asset.sha256;
    }
    bundledItems.push({
      ...item,
      ...version,
    });
  }

  return {
    items: bundledItems,
    files: [...files].sort(),
    expectedFileSha256,
  };
}
