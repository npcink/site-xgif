import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planContentSync, runContentSync } from "../content-sync-cli.js";

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", args, { cwd })).stdout.trim();

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-cli-sync-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  for (const dir of ["articles", "images"]) await mkdir(path.join(repoRoot, "site/src/content", dir), { recursive: true });
  const file = "site/src/content/articles/20261112-0001.md";
  const markdown = `---
title: "独立内容工具验收"
contentId: "20261112-0001"
summary: "测试公开内容的逐项选择、引用图片打包、发布阻断规则和默认不推送的执行方式。"
source: "本站原创"
sourceKind: "original"
tags: ["生活"]
pubDate: "2026-11-12"
readTime: "1 分钟"
recommendationGroup: "general"
shortFormReviewed: true
draft: false
---

这是一篇已确认完整的短文章。
`;
  await writeFile(path.join(repoRoot, file), markdown);
  return { repoRoot, file, markdown };
}

test("dry-run bundles only selected public content and its referenced image without publishing", async (t) => {
  const { repoRoot, file, markdown } = await fixture(t);
  const asset = "site/public/images/articles/cover.png";
  await mkdir(path.dirname(path.join(repoRoot, asset)), { recursive: true });
  await writeFile(path.join(repoRoot, asset), "fixture image bytes");
  await writeFile(path.join(repoRoot, file), markdown.replace('draft: false', 'coverImage: "/images/articles/cover.png"\ndraft: false'));
  const result = await runContentSync({ repoRoot, files: [file, file] });
  assert.equal(result.mode, "dry-run");
  assert.deepEqual(result.files, [asset, file]);
  assert.match(result.expectedFileSha256[asset], /^[a-f0-9]{64}$/u);
  await assert.rejects(readFile(path.join(repoRoot, "workflow/records/publication-events.jsonl")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(repoRoot, "workflow/.runtime/content-tools.lock")), { code: "ENOENT" });
});

test("sync rejects drafts, holds, missing images, review debt and private paths before invoking Git", async (t) => {
  const { repoRoot, file, markdown } = await fixture(t);
  for (const modified of [
    markdown.replace("draft: false", "draft: true"),
    markdown.replace("draft: false", "publicationHold: true\ndraft: false"),
    markdown.replace("draft: false", 'coverImage: "/images/articles/missing.png"\ndraft: false'),
    markdown.replace("shortFormReviewed: true", "shortFormReviewed: false"),
  ]) {
    await writeFile(path.join(repoRoot, file), modified);
    await assert.rejects(runContentSync({ repoRoot, files: [file], apply: true }), /不能同步/u);
  }
  await assert.rejects(planContentSync({ repoRoot, files: ["workflow/private-sources/private.md"] }), /白名单/u);
  await assert.rejects(planContentSync({ repoRoot, files: [] }), /请指定/u);
});

test("retry requires an explicit branch and apply, and cannot be mixed with fresh content", async (t) => {
  const { repoRoot, file } = await fixture(t);
  await assert.rejects(runContentSync({ repoRoot, files: [], retry: "content-sync/previous" }), /重试/u);
  await assert.rejects(runContentSync({ repoRoot, files: [file], apply: true, retry: "content-sync/previous" }), /重试/u);
  await assert.rejects(runContentSync({ repoRoot, files: [], apply: true, retry: "content-sync/unknown" }), /没有这个分支/u);
});

test("sync rejects public paths that resolve to private source bytes", async (t) => {
  const { repoRoot, file, markdown } = await fixture(t);
  const privateFile = path.join(repoRoot, "private.png");
  await writeFile(privateFile, "private source bytes");
  const asset = path.join(repoRoot, "site/public/images/articles/symlink.png");
  await mkdir(path.dirname(asset), { recursive: true });
  await symlink(privateFile, asset);
  await writeFile(path.join(repoRoot, file), markdown.replace('draft: false', 'coverImage: "/images/articles/symlink.png"\ndraft: false'));
  await assert.rejects(planContentSync({ repoRoot, files: [file] }), /符号链接/u);
});

test("apply pushes only selected content, persists receipts, and retries PR failure without another push", async (t) => {
  const { repoRoot, file } = await fixture(t);
  const remote = path.join(repoRoot, "remote.git");
  await git(repoRoot, "init", "--bare", remote);
  await git(repoRoot, "init", "-b", "main");
  await git(repoRoot, "config", "user.name", "XGIF Test");
  await git(repoRoot, "config", "user.email", "xgif@example.test");
  await writeFile(path.join(repoRoot, "README.md"), "base code\n");
  await git(repoRoot, "add", "README.md");
  await git(repoRoot, "commit", "-m", "Base");
  await git(repoRoot, "remote", "add", "origin", remote);
  await git(repoRoot, "push", "-u", "origin", "main");
  await writeFile(path.join(repoRoot, "README.md"), "unrelated dirty code\n");
  const failedPR = await runContentSync({ repoRoot, files: [file], apply: true,
    createPullRequest: async () => ({ ok: false, error: "GitHub temporarily unavailable" }) });
  assert.equal(failedPR.ok, false);
  assert.equal(failedPR.push.ok, true);
  assert.equal(await git(repoRoot, "show", `origin/${failedPR.branch}:README.md`), "base code");
  assert.equal(await git(repoRoot, "show", `origin/${failedPR.branch}:${file}`), (await readFile(path.join(repoRoot, file), "utf8")).trim());
  assert.equal(await git(repoRoot, "branch", "--show-current"), "main");
  assert.equal(await readFile(path.join(repoRoot, "README.md"), "utf8"), "unrelated dirty code\n");
  const receiptPath = path.join(repoRoot, "workflow/records/publication-events.jsonl");
  const records = (await readFile(receiptPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((record) => record.state), ["prepared", "push_succeeded"]);
  await assert.rejects(runContentSync({ repoRoot, files: [file], apply: true }), /已有发布回执/u);
  const retried = await runContentSync({ repoRoot, files: [], apply: true, retry: failedPR.branch,
    createPullRequest: async ({ branch }) => ({ ok: true, branch }) });
  assert.equal(retried.ok, true);
  assert.equal(retried.push.attempted, false);
  assert.equal(retried.pullRequest.branch, failedPR.branch);
  assert.equal((await readFile(receiptPath, "utf8")).trim().split("\n").length, 2);
});
