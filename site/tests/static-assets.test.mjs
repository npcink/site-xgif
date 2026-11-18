import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { versionStaticAssets } from "../src/lib/version-static-assets.mjs";

test("changing a module dependency invalidates entry URLs while preserving imports", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/entry.js"), 'import "./dependency.js";');
  await writeFile(path.join(root, "scripts/dependency.js"), 'export const value = 1;');
  await writeFile(path.join(root, "image-ratios.css"), "/* ratios */");
  const html = '<script src="/scripts/entry.js"></script><link href="/image-ratios.css"><p>原文 /scripts/entry.js</p><a href="/scripts/entry.js">原始链接</a>';
  await writeFile(path.join(root, "index.html"), html);
  const first = await versionStaticAssets(root);
  assert.equal(await readFile(path.join(root, "index.html"), "utf8"), html.replace('src="/scripts/', `src="${first}/scripts/`).replace('href="/image-', `href="${first}/image-`));
  assert.equal(await readFile(path.join(root, first, "scripts/entry.js"), "utf8"), 'import "./dependency.js";');
  await writeFile(path.join(root, "scripts/dependency.js"), 'export const value = 2;');
  await writeFile(path.join(root, "index.html"), html);
  const second = await versionStaticAssets(root);
  assert.notEqual(second, first);
  assert.equal(await readFile(path.join(root, second, "scripts/dependency.js"), "utf8"), 'export const value = 2;');
});

test("built pages reference versioned scripts and ratio CSS with immutable cache rules", async () => {
  const root = new URL("../dist/", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 5);
  for (const src of scripts) {
    assert.match(src, /^\/static\/[a-f0-9]{20}\/scripts\//);
    assert.ok((await readFile(new URL(`.${src}`, root))).length);
  }
  assert.match(html, /href="\/static\/[a-f0-9]{20}\/image-ratios\.css"/);
  const headers = await readFile(new URL("_headers", root), "utf8");
  assert.match(headers, /\/static\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
});
