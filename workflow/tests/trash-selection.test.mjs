import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthoritativeTrashSelection } from "../trash-selection.js";

const indexed = [{
  id: "trash-1",
  type: "article",
  file: "site/src/content/articles/original.md",
  trashFile: "workflow/trash/content/batch/article-original.md",
}];

test("trash operations use the indexed record instead of client paths", () => {
  const [selected] = resolveAuthoritativeTrashSelection([{
    id: "trash-1",
    type: "image",
    file: "site/src/content/images/forged.md",
    trashFile: "workflow/trash/content/batch/forged.md",
  }], indexed);
  assert.deepEqual(selected, indexed[0]);
});

test("trash operations reject stale, missing, and duplicate IDs", () => {
  assert.throws(
    () => resolveAuthoritativeTrashSelection([{ id: "missing" }], indexed),
    (error) => error.statusCode === 409,
  );
  assert.throws(
    () => resolveAuthoritativeTrashSelection([{ id: "" }], indexed),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => resolveAuthoritativeTrashSelection([{ id: "trash-1" }, { id: "trash-1" }], indexed),
    (error) => error.statusCode === 400,
  );
});
