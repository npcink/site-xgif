import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(file);
    else if (entry.name.endsWith(".html")) yield file;
  }
}

export async function versionStaticAssets(directory) {
  const files = ["image-ratios.css", ...(await readdir(path.join(directory, "scripts")))
    .filter(name => name.endsWith(".js")).sort().map(name => `scripts/${name}`)];
  const assets = await Promise.all(files.map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
  // A shared hash covers relative module imports, including transitive changes.
  const hash = createHash("sha256");
  for (const { name, bytes } of assets) hash.update(name).update("\0").update(bytes).update("\0");
  const base = `/static/${hash.digest("hex").slice(0, 20)}`;
  for (const { name, bytes } of assets) {
    const target = path.join(directory, base.slice(1), name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const names = new Set(files);
  for await (const file of htmlFiles(directory)) {
    const html = await readFile(file, "utf8");
    const updated = html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")\/(scripts\/[^"?#]+\.js|image-ratios\.css)"/g,
      (match, prefix, name) => names.has(name) ? `${prefix}${base}/${name}"` : match);
    if (updated !== html) await writeFile(file, updated);
  }
  return base;
}

export default function staticAssetVersions() {
  return {
    name: "xgif-static-asset-versions",
    hooks: { "astro:build:done": async ({ dir }) => { await versionStaticAssets(fileURLToPath(dir)); } },
  };
}
