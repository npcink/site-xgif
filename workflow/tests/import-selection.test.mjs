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

test("needs-review filter shows review and similar items regardless of selection", () => {
  assert.equal(importItemMatchesFilter({ status: "review", checked: false }, "needs-review"), true);
  assert.equal(importItemMatchesFilter({ status: "similar", checked: true }, "needs-review"), true);
  assert.equal(importItemMatchesFilter({ status: "ready", checked: false }, "needs-review"), false);
  assert.equal(importItemMatchesFilter({ status: "exact", checked: false }, "needs-review"), false);
  assert.equal(importItemMatchesFilter({ status: "ready", checked: true }, "all"), true);
});
