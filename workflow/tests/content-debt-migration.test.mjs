import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migratePublishedContentDebt } from "../content-debt-migration.js";

test("published debt migration previews and applies governed metadata only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-content-debt-"));
  const articles = path.join(root, "site", "src", "content", "articles");
  const images = path.join(root, "site", "src", "content", "images");
  const file = path.join(articles, "20260124-0suv.md");
  const markdown = [
    "---",
    'title: "Adult"',
    'contentId: "20260124-0suv"',
    'summary: "This summary is deliberately long enough for the content audit."',
    'source: "Original"',
    'sourceKind: "original"',
    'tags: ["幽默"]',
    "pubDate: 2026-01-24",
    'internalNote: "Imported; review before publication."',
    "draft: false",
    "---",
    "",
    "This body is deliberately long enough to remain a published migration fixture without changing body text.",
    "",
  ].join("\n");
  try {
    await mkdir(articles, { recursive: true });
    await mkdir(images, { recursive: true });
    await writeFile(file, markdown, "utf8");

    const preview = await migratePublishedContentDebt({
      repoRoot: root,
      resolvedAt: "2026-07-30T00:00:00.000Z",
    });
    assert.equal(preview.applied, false);
    assert.equal(preview.migrated.length, 1);
    assert.equal(await readFile(file, "utf8"), markdown);

    const applied = await migratePublishedContentDebt({
      repoRoot: root,
      apply: true,
      resolvedAt: "2026-07-30T00:00:00.000Z",
    });
    assert.equal(applied.migrated[0].changes.recommendationGroup, "adult-humor");
    const next = await readFile(file, "utf8");
    assert.match(next, /^recommendationGroup: "adult-humor"$/mu);
    assert.match(next, /^internalReviewStatus: "resolved"$/mu);
    assert.match(next, /^internalReviewResolvedAt: "2026-07-30T00:00:00.000Z"$/mu);
    assert.match(next, /This body is deliberately long enough/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
