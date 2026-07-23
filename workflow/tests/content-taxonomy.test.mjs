import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_TAGS,
  canonicalTagsPrompt,
  normalizeContentTags,
} from "../content-taxonomy.js";

test("normalizes noisy imported tags into a bounded canonical taxonomy", () => {
  assert.deepEqual(
    normalizeContentTags(["#故事汇", "服务器硬盘", "服务器硬盘", "人生思考"]),
    ["生活", "科技", "成长"],
  );
  assert.deepEqual(normalizeContentTags([], { type: "image" }), ["反应图"]);
  assert.equal(normalizeContentTags(["AI", "人工智能"]).length, 1);
});

test("canonical prompt and output use the same allowlist", () => {
  assert.match(canonicalTagsPrompt(), /社会观察/);
  assert.ok(CANONICAL_TAGS.includes(normalizeContentTags(["怪谈"])[0]));
});
