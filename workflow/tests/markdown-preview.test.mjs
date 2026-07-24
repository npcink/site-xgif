import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdownPreview } from "../public/markdown-preview.js";

test("renders separate Markdown paragraphs and preserves deliberate line breaks", () => {
  assert.equal(
    renderMarkdownPreview("第一段。\n仍在第一段。\n\n第二段。"),
    "<p>第一段。<br />仍在第一段。</p><p>第二段。</p>",
  );
});

test("renders unordered and ordered lists in the article preview", () => {
  assert.equal(
    renderMarkdownPreview("- 第一项\n- **第二项**\n\n1. 步骤一\n2. 步骤二"),
    "<ul><li>第一项</li><li><strong>第二项</strong></li></ul><ol><li>步骤一</li><li>步骤二</li></ol>",
  );
});

test("escapes raw HTML before applying limited safe inline Markdown", () => {
  assert.equal(
    renderMarkdownPreview("<script>alert(1)</script> 与 `代码`"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt; 与 <code>代码</code></p>",
  );
});
