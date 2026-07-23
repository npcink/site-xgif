import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readBuiltArticle = (id) =>
  readFile(new URL(`../dist/articles/${id}/index.html`, import.meta.url), "utf8");

test("public pages hide private import reminders but retain reader-facing editorial notes", async () => {
  const [imported, editorial] = await Promise.all([
    readBuiltArticle("2026-07-22-今天写文的时候忽然想起一件事"),
    readBuiltArticle("2026-07-10-海边旧事与父亲的记忆"),
  ]);

  assert.doesNotMatch(imported, /flomo\s*私人/);
  assert.doesNotMatch(imported, /请在公开前复核/);
  assert.match(editorial, /文字克制细腻/);
});
