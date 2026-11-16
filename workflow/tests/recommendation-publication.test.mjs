import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { loadPublicRecommendationContent, buildRecommendationManifest, writeRecommendationManifest } from "../recommendation-engine.js";
import { verifyRecommendationPublication } from "../recommendation-verify.js";
import { planRecommendationPublication } from "../publication-projection.js";
import { buildPublicationBundle } from "../publication-bundle.js";
import { isolatedContentSync } from "../isolated-content-sync.js";
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", args, { cwd })).stdout.trim();
const file = "site/src/content/articles/20261113-aaaa.md";
const article = '---\ncontentId: "20261113-aaaa"\ntitle: "AI 标题"\nsummary: "AI 摘要"\npubDate: "2026-11-13"\nrecommendationGroup: "general"\ndraft: false\n---\n\n原始正文。';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-rec-publication-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  for (const dir of ["site/src/content/articles", "site/src/content/images", "site/public/images/memes"]) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, file), article);
  const rebuild = async () => writeRecommendationManifest(root, buildRecommendationManifest(await loadPublicRecommendationContent(root)));
  await rebuild(); return { root, rebuild };
}
test("publication fingerprints ignore AI fields but reject stale body, date, group and public set", async t => {
  const { root } = await fixture(t);
  for (const raw of [article.replace("AI 标题", "另一标题"), article.replace("AI 摘要", "另一摘要")]) {
    await writeFile(path.join(root, file), raw); assert.equal((await verifyRecommendationPublication(root)).ok, true);
  }
  for (const raw of [article + "新正文", article.replace('"2026-11-13"', '"2026-11-12"'), article.replace('"general"', '"adult-humor"'), article.replace("draft: false", "draft: true")]) {
    await writeFile(path.join(root, file), raw); await assert.rejects(verifyRecommendationPublication(root), /不一致/);
  }
});
test("image byte changes, gallery order and unknown remote image identities block publication", async t => {
  const { root, rebuild } = await fixture(t);
  const image = "site/src/content/images/20261113-bbbb.md";
  const pixels = "site/public/images/memes/a.png";
  const raw = '---\ncontentId: "20261113-bbbb"\npubDate: "2026-11-13"\nimage: "/images/memes/a.png"\ndraft: false\n---\n';
  await writeFile(path.join(root, pixels), "pixels-one"); await writeFile(path.join(root, image), raw); await rebuild();
  assert.equal((await verifyRecommendationPublication(root)).publicCount, 2);
  await writeFile(path.join(root, pixels), "pixels-two"); await assert.rejects(verifyRecommendationPublication(root), /不一致/);
  await writeFile(path.join(root, "site/public/images/memes/b.png"), "second-pixels");
  const gallery = [{ src: "/images/memes/a.png" }, { src: "/images/memes/b.png" }];
  const withGallery = raw.replace("draft: false", `images: ${JSON.stringify(gallery)}\ndraft: false`);
  await writeFile(path.join(root, image), withGallery); await rebuild();
  assert.equal((await verifyRecommendationPublication(root)).ok, true);
  await writeFile(path.join(root, image), withGallery.replace(JSON.stringify(gallery), JSON.stringify([...gallery].reverse())).replace('image: "/images/memes/a.png"', 'image: "/images/memes/b.png"'));
  await assert.rejects(verifyRecommendationPublication(root), /不一致/);
  await writeFile(path.join(root, image), raw.replace("/images/memes/a.png", "https://other.test/a.png")); await rebuild();
  await assert.rejects(verifyRecommendationPublication(root), /无法离线核验/);
});
test("deleted targets, wrong collection, self links, unsafe group and duplicate lists are rejected", async t => {
  const { root, rebuild } = await fixture(t);
  const manifestPath = path.join(root, "site/src/data/recommendations.json");
  const original = JSON.parse(await readFile(manifestPath));
  for (const list of [["missing"], ["20261113-aaaa"], ["missing", "missing"]]) {
    const manifest = structuredClone(original); manifest.recommendations["20261113-aaaa"].articles = list;
    await writeFile(manifestPath, JSON.stringify(manifest)); await assert.rejects(verifyRecommendationPublication(root), /不一致/);
  }
  await writeFile(path.join(root, "site/src/content/images/20261113-bbbb.md"), `---
contentId: "20261113-bbbb"
image: "https://img.xgif.cn/memes/${"a".repeat(64)}.png"
recommendationGroup: "adult-humor"
draft: false
---
`);
  await rebuild(); const grouped = JSON.parse(await readFile(manifestPath));
  for (const kind of ["articles", "images"]) {
    const manifest = structuredClone(grouped); manifest.recommendations["20261113-aaaa"][kind] = ["20261113-bbbb"];
    await writeFile(manifestPath, JSON.stringify(manifest)); await assert.rejects(verifyRecommendationPublication(root), /引用了不允许/);
  }
});
test("projection preserves baseline AI-only lists and refuses a local full-library manifest containing unrelated public edits", async t => {
  const { root, rebuild } = await fixture(t);
  await git(root, "init", "-b", "main"); await git(root, "config", "user.name", "Test"); await git(root, "config", "user.email", "test@example.test");
  await git(root, "add", "."); await git(root, "commit", "-m", "Base"); await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  const plan = async () => planRecommendationPublication({ repoRoot: root, bundle: await buildPublicationBundle({ repoRoot: root, items: [{ file }] }) });
  await writeFile(path.join(root, file), article.replace("AI 标题", "新题"));
  assert.deepEqual((await plan()).files, [file]);
  const other = "site/src/content/articles/20261113-cccc.md";
  await writeFile(path.join(root, other), article.replaceAll("20261113-aaaa", "20261113-cccc"));
  await writeFile(path.join(root, file), article + "\n新增正文"); await rebuild();
  await assert.rejects(plan(), /不一致/);
  await unlink(path.join(root, other)); await rebuild();
  const result = await plan(); assert.ok(result.files.includes("site/src/data/recommendations.json"));
  const remote = path.join(root, "remote.git"); await git(root, "init", "--bare", remote); await git(root, "remote", "add", "origin", remote); await git(root, "push", "-u", "origin", "main");
  // A newer fetched baseline invalidates the planned transaction before branch/commit/push.
  await writeFile(path.join(root, "README.md"), "new baseline"); await git(root, "add", "README.md"); await git(root, "commit", "-m", "Advance"); await git(root, "push", "origin", "main");
  await assert.rejects(isolatedContentSync({ repoRoot: root, ...result, message: "Must not push", branch: "content-sync/base-race" }), /基线已变化/);
  assert.equal(await git(root, "branch", "--list", "content-sync/base-race"), "");
});

test("quality export only reads matching original-source cache and rejects stale model/input fingerprints", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  const { exportRecommendationQuality } = await import("../recommendation-quality-export.js");
  const { MULTIMODAL_INPUT_VERSION } = await import("../recommendation-engine.js");
  const { root } = await fixture(t); const docs = await loadPublicRecommendationContent(root);
  const model = "local-fixture"; const modelDigest = "fixed-digest";
  await writeRecommendationManifest(root, buildRecommendationManifest(docs, { mode: "hybrid", model, vectors: new Map([[docs[0].id, [1, 0]]]),
    embeddingDetails: { provider: "ollama", modelDigest, inputVersion: MULTIMODAL_INPUT_VERSION } }));
  await mkdir(path.join(root, "workflow/.runtime"), { recursive: true });
  const dbPath = path.join(root, "workflow/.runtime/xgif.sqlite3"); const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE recommendation_embeddings (content_id TEXT, content_sha256 TEXT, model TEXT, vector_json TEXT)");
  db.prepare("INSERT INTO recommendation_embeddings VALUES (?, ?, ?, ?)").run(docs[0].id, createHash("sha256").update(`ollama:${modelDigest}:${docs[0].contentSha256}`).digest("hex"), model, "[1,0]"); db.close();
  const before = await readFile(dbPath);
  const input = await exportRecommendationQuality(root); assert.equal(input.documents.length, 1); assert.deepEqual(input.documents[0].vector, [1, 0]);
  assert.equal(input.documents[0].body, docs[0].entry.body); assert.deepEqual(await readFile(dbPath), before);
  const changed = new DatabaseSync(dbPath); changed.exec("UPDATE recommendation_embeddings SET content_sha256 = 'stale'"); changed.close();
  await assert.rejects(exportRecommendationQuality(root), /缺少匹配原始依据/);
});

test("the committed tree is checked before receipts or push even when Git hooks change staged content", async t => {
  const { chmod } = await import("node:fs/promises");
  const { root, rebuild } = await fixture(t);
  const remote = path.join(root, "remote.git");
  await git(root, "init", "--bare", remote); await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Test"); await git(root, "config", "user.email", "test@example.test");
  await git(root, "add", "site"); await git(root, "commit", "-m", "Base"); await git(root, "remote", "add", "origin", remote); await git(root, "push", "-u", "origin", "main");
  await writeFile(path.join(root, file), article + "\nselected change"); await rebuild();
  const hook = path.join(root, ".git/hooks/pre-commit");
  await writeFile(hook, `#!/bin/sh\nprintf '\\nchanged by hook\\n' >> '${file}'\ngit add -- '${file}'\n`); await chmod(hook, 0o755);
  const bundle = await planRecommendationPublication({ repoRoot: root, bundle: await buildPublicationBundle({ repoRoot: root, items: [{ file }] }) });
  let prepared = false;
  await assert.rejects(isolatedContentSync({ repoRoot: root, ...bundle, branch: "content-sync/hook-changed", message: "Must stop", onPrepared: () => { prepared = true; } }), /不一致/);
  assert.equal(prepared, false);
  assert.equal(await git(root, "branch", "--list", "content-sync/hook-changed"), "");
  await assert.rejects(git(root, "show-ref", "--verify", "refs/remotes/origin/content-sync/hook-changed"));
});
