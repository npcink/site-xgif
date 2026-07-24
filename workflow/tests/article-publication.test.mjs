import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LEGACY_ARTICLE_DISCLOSURE,
  prepareArticlePublication,
  readEditableArticleBody,
} from "../article-publication.js";

test("external publication emits the full body and keeps a private backup", async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-private-source-"));
  const article = {
    contentId: "20260723-ab12",
    sourceKind: "publication",
    body: "这是从外部来源导入的完整正文。",
    draft: false,
  };
  const prepared = await prepareArticlePublication(article, { workflowRoot });
  assert.equal(prepared.payload.body, article.body);
  assert.equal((await readFile(prepared.privateSourcePath, "utf8")).trim(), article.body);
  assert.equal(
    await readEditableArticleBody(prepared.payload, { workflowRoot }),
    article.body,
  );
});

test("legacy disclosure restores the private editable body for draft and public output", async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-private-source-"));
  const source = {
    contentId: "20260723-cd34",
    sourceKind: "editorial",
    body: "本地编辑正文",
    draft: false,
  };
  await prepareArticlePublication(source, { workflowRoot });
  const draft = await prepareArticlePublication({
    ...source,
    body: LEGACY_ARTICLE_DISCLOSURE,
    draft: true,
  }, { workflowRoot });
  assert.equal(draft.payload.body, source.body);
  const published = await prepareArticlePublication({
    ...source,
    body: LEGACY_ARTICLE_DISCLOSURE,
    draft: false,
  }, { workflowRoot });
  assert.equal(published.payload.body, source.body);
});

test("editable external article prefers a current public body over a stale private backup", async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-private-source-"));
  const source = {
    contentId: "20260723-ef56",
    sourceKind: "publication",
    body: "旧的私有正文",
    draft: false,
  };
  await prepareArticlePublication(source, { workflowRoot });

  assert.equal(
    await readEditableArticleBody({
      ...source,
      body: "公开 Markdown 中更新后的完整正文",
    }, { workflowRoot }),
    "公开 Markdown 中更新后的完整正文",
  );
});
