import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PUBLIC_ARTICLE_DISCLOSURE,
  prepareArticlePublication,
  readEditableArticleBody,
} from "../article-publication.js";

test("external publication keeps source body private and emits only disclosure publicly", async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-private-source-"));
  const article = {
    contentId: "20260723-ab12",
    sourceKind: "publication",
    body: "这是从外部来源导入的完整正文。",
    draft: false,
  };
  const prepared = await prepareArticlePublication(article, { workflowRoot });
  assert.equal(prepared.payload.body, PUBLIC_ARTICLE_DISCLOSURE);
  assert.equal((await readFile(prepared.privateSourcePath, "utf8")).trim(), article.body);
  assert.equal(
    await readEditableArticleBody(prepared.payload, { workflowRoot }),
    article.body,
  );
});

test("draft external article restores the private editable body", async () => {
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
    body: PUBLIC_ARTICLE_DISCLOSURE,
    draft: true,
  }, { workflowRoot });
  assert.equal(draft.payload.body, source.body);
});
