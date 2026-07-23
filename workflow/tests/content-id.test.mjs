import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_ID_PATTERN,
  contentIdDatePrefix,
  createContentId,
  isContentId,
} from "../content-id.js";

test("content IDs combine a compact date with four lowercase alphanumeric characters", () => {
  const id = createContentId("2026-07-23", new Set(), () => 12345);

  assert.match(id, CONTENT_ID_PATTERN);
  assert.equal(id, "20260723-09ix");
  assert.equal(contentIdDatePrefix("2026-07-23"), "20260723");
  assert.equal(isContentId(id), true);
});

test("content ID generation retries collisions and rejects invalid dates", () => {
  const occupied = new Set(["20260723-0001"]);
  const values = [1, 2];
  const id = createContentId("2026-07-23", occupied, () => values.shift());

  assert.equal(id, "20260723-0002");
  assert.throws(() => createContentId("2026-02-30"), /有效的 YYYY-MM-DD/);
});
