import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileR2Assets } from "../r2-reconciliation.js";

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-r2-reconcile-"));
  const imageDirectory = path.join(repoRoot, "site", "src", "content", "images");
  const ledgerPath = path.join(repoRoot, "workflow", "records", "r2-assets.jsonl");
  await Promise.all([
    mkdir(imageDirectory, { recursive: true }),
    mkdir(path.dirname(ledgerPath), { recursive: true }),
  ]);
  return { repoRoot, imageDirectory, ledgerPath };
}

function image(publicUrl) {
  return `---
title: "R2 图片"
contentId: "20260723-ab12"
description: "测试图片"
image: ${JSON.stringify(publicUrl)}
source: "群聊转存（来源待核实）"
sourceKind: "unknown"
tags: ["反应图"]
category: "表情包"
pubDate: "2026-07-23"
public: true
ratio: "square"
draft: false
---
`;
}

test("R2 reconciliation reports a consistent ledger without mutating it", async () => {
  const dirs = await fixture();
  const publicUrl = "https://img.xgif.cn/memes/abc.webp";
  await writeFile(path.join(dirs.imageDirectory, "20260723-ab12.md"), image(publicUrl), "utf8");
  await writeFile(dirs.ledgerPath, `${JSON.stringify({ publicUrl, objectKey: "memes/abc.webp" })}\n`, "utf8");
  const report = await reconcileR2Assets(dirs);
  assert.equal(report.ok, true);
  assert.deepEqual(report.counts, {
    references: 1,
    ledgerRows: 1,
    referencedWithoutLedger: 0,
    ledgerWithoutReference: 0,
    duplicateLedgerUrls: 0,
    invalidLedgerLines: 0,
    remoteUnavailable: 0,
    privateBackupIssues: 0,
  });
});

test("R2 reconciliation exposes recoverable partial publication states", async () => {
  const dirs = await fixture();
  await writeFile(
    path.join(dirs.imageDirectory, "20260723-ab12.md"),
    image("https://img.xgif.cn/memes/missing-ledger.webp"),
    "utf8",
  );
  await writeFile(
    dirs.ledgerPath,
    `${JSON.stringify({ publicUrl: "https://img.xgif.cn/memes/orphan.webp", objectKey: "memes/orphan.webp" })}\n`,
    "utf8",
  );
  const report = await reconcileR2Assets(dirs);
  assert.equal(report.ok, false);
  assert.equal(report.counts.referencedWithoutLedger, 1);
  assert.equal(report.counts.ledgerWithoutReference, 1);
});

test("R2 reconciliation verifies remote objects and private source bytes when requested", async () => {
  const dirs = await fixture();
  const hash = "a".repeat(64);
  const publicUrl = `https://img.xgif.cn/memes/${hash}.webp`;
  const privateBackupDirectory = path.join(dirs.repoRoot, "workflow", "private-sources", "r2-assets");
  await mkdir(privateBackupDirectory, { recursive: true });
  await writeFile(path.join(dirs.imageDirectory, "20260723-ab12.md"), image(publicUrl), "utf8");
  await writeFile(
    dirs.ledgerPath,
    `${JSON.stringify({ publicUrl, objectKey: `memes/${hash}.webp`, sha256: hash })}\n`,
    "utf8",
  );
  const report = await reconcileR2Assets({
    ...dirs,
    privateBackupDirectory,
    verifyRemote: true,
    verifyPrivateBackups: true,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.counts.remoteUnavailable, 1);
  assert.equal(report.counts.privateBackupIssues, 1);
});
