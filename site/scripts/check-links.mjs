import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd(), "dist");
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.name.endsWith(".html")) htmlFiles.push(absolute);
  }
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function candidatesFor(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const relative = decoded.replace(/^\/+/u, "");
  const direct = path.join(root, relative);
  if (path.extname(relative)) return [direct];
  return [
    direct,
    path.join(direct, "index.html"),
    `${direct}.html`,
  ];
}

await walk(root);
const failures = [];
const attributePattern = /\b(?:href|src)=["']([^"'<>]+)["']/giu;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  for (const match of html.matchAll(attributePattern)) {
    const raw = match[1].trim();
    if (
      !raw
      || raw.startsWith("#")
      || raw.startsWith("//")
      || /^(?:https?:|mailto:|tel:|data:|javascript:)/iu.test(raw)
    ) continue;

    let resolved;
    try {
      const pagePath = `/${path.relative(root, file).split(path.sep).join("/")}`;
      resolved = new URL(raw, `https://www.xgif.cn${pagePath}`).pathname;
    } catch {
      failures.push(`${path.relative(root, file)} -> 无效 URL：${raw}`);
      continue;
    }
    const candidates = candidatesFor(resolved);
    if (!(await Promise.all(candidates.map(exists))).some(Boolean)) {
      failures.push(`${path.relative(root, file)} -> ${raw}`);
    }
  }
}

if (failures.length) {
  console.error(`发现 ${failures.length} 个站内断链：\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`站内链接检查通过：${htmlFiles.length} 个 HTML 页面。`);
}
