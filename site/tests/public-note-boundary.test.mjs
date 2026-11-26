import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isPublicArticle, publicArticleNote } from "../src/lib/article-visibility.mjs";

test("draft and publication hold independently exclude articles from public reads", () => {
  for (const [draft, publicationHold, expected] of [
    [false, false, true], [true, false, false], [false, true, false], [true, true, false],
  ]) assert.equal(isPublicArticle({ data: { draft, publicationHold } }), expected);
});

test("only the explicit public field supplies an editorial note", () => {
  assert.equal(publicArticleNote({ note: "旧备注", internalNote: "内部备注" }), "");
  assert.equal(publicArticleNote({ editorNote: "  来源待确认，欢迎补充线索。  ", note: "旧备注" }), "来源待确认，欢迎补充线索。");
  assert.equal(publicArticleNote({ editorNote: "   ", note: "不回退" }), "");
});

const readBuiltArticle = (id) =>
  readFile(new URL(`../dist/${id}/index.html`, import.meta.url), "utf8");

test("public pages hide private import reminders but retain reader-facing editorial notes", async () => {
  const [imported, editorial] = await Promise.all([
    readBuiltArticle("20260722-99j9"),
    readBuiltArticle("20260710-vfks"),
  ]);

  assert.doesNotMatch(imported, /flomo\s*私人/);
  assert.doesNotMatch(imported, /请在公开前复核/);
  assert.match(editorial, /文字克制细腻/);
});
