import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLibrarySelectionState,
  createLibrarySelection,
  isLibraryFileSelected,
  libraryBatchPayload,
  librarySelectionSummary,
  selectAllFiltered,
  setLibraryFileSelected,
  setLibraryPageSelected,
} from "../public/library-selection.js";

test("current-page selection can expand to every filtered result", () => {
  const selection = createLibrarySelection();
  setLibraryPageSelected(selection, ["a.md", "b.md"], true);
  assert.equal(librarySelectionSummary(selection).count, 2);

  selectAllFiltered(selection, { type: "article", status: "local", query: "测试" }, 27);
  assert.deepEqual(librarySelectionSummary(selection), {
    count: 27,
    filtered: true,
    label: "已选择符合筛选的 27 条内容",
  });
  assert.equal(isLibraryFileSelected(selection, "another.md"), true);
  assert.deepEqual(libraryBatchPayload(selection, []), {
    selection: {
      type: "article",
      status: "local",
      query: "测试",
      exclude: [],
    },
  });
});

test("filtered selection supports exclusions without loading every row", () => {
  const selection = createLibrarySelection();
  selectAllFiltered(selection, { type: "all", status: "all", query: "" }, 60);
  setLibraryFileSelected(selection, "skip.md", false);

  assert.equal(isLibraryFileSelected(selection, "skip.md"), false);
  assert.equal(isLibraryFileSelected(selection, "keep.md"), true);
  assert.equal(librarySelectionSummary(selection).count, 59);
  assert.deepEqual(libraryBatchPayload(selection, []).selection.exclude, ["skip.md"]);

  clearLibrarySelectionState(selection);
  assert.deepEqual(librarySelectionSummary(selection), {
    count: 0,
    filtered: false,
    label: "未选择内容",
  });
});
