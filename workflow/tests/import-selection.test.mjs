import assert from "node:assert/strict";
import test from "node:test";
import { importItemMatchesFilter, summarizeImportSelection } from "../public/import-selection.js";

test("selection summary distinguishes selected, selectable, and total items", () => {
  const summary = summarizeImportSelection([
    { checked: true, disabled: false },
    { checked: false, disabled: false },
    { checked: false, disabled: true },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    selectable: 2,
    selected: 1,
    unselected: 2,
    allSelected: false,
  });
});

test("all selected ignores disabled exact duplicates", () => {
  const summary = summarizeImportSelection([
    { checked: true, disabled: false },
    { checked: false, disabled: true },
  ]);

  assert.equal(summary.allSelected, true);
});

test("unselected filter keeps unchecked and disabled items visible", () => {
  assert.equal(importItemMatchesFilter({ checked: false, disabled: false }, "unselected"), true);
  assert.equal(importItemMatchesFilter({ checked: false, disabled: true }, "unselected"), true);
  assert.equal(importItemMatchesFilter({ checked: true, disabled: false }, "unselected"), false);
  assert.equal(importItemMatchesFilter({ checked: true, disabled: false }, "all"), true);
});
