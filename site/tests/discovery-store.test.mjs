import assert from "node:assert/strict";
import test from "node:test";
import { readSeen, rememberSeen, unseenRecommendations } from "../public/scripts/discovery-store.js";

test("history tolerates corrupt and unavailable storage and keeps valid bounded IDs", () => {
  assert.deepEqual([...readSeen({ getItem: () => '{broken' })], []);
  assert.deepEqual([...readSeen({ getItem: () => '["20260101-abcd",null,"/bad"]' })], ["20260101-abcd"]);
  const seen = readSeen();
  for (let index = 0; index < 205; index += 1) {
    rememberSeen(seen, `20260101-${index.toString(36).padStart(4, "0")}`);
  }
  assert.equal(seen.size, 200);
  assert.ok(!seen.has("20260101-0000"));
});

test("recommendations replace already viewed candidates and never recycle them when exhausted", () => {
  const ids = ["20260101-aaaa", "20260101-bbbb", "20260101-cccc", "20260101-dddd"];
  assert.deepEqual(unseenRecommendations([...ids, ids[2]], new Set(ids.slice(0, 2)), 3), ids.slice(2));
  assert.deepEqual(unseenRecommendations(ids, new Set(ids), 3), []);
});
