import assert from "node:assert/strict";
import test from "node:test";
import { preservePublicationHold } from "../publication-hold.js";

test("restoring an older public version retains the current hold and the original body", () => {
  for (const newline of ["\n", "\r\n"]) {
    const previous = ['---', 'title: "旧版本"', 'draft: false', '---', '', '普通测试正文。', ''].join(newline);
    const restored = preservePublicationHold({ publicationHold: true }, previous);
    assert.match(restored, /publicationHold: true/);
    assert.match(restored, /draft: true/);
    assert.ok(restored.endsWith(`${newline}${newline}普通测试正文。${newline}`));
    assert.equal(preservePublicationHold({}, previous), previous);
  }
});
