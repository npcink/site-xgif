import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_PATTERN_EXAMPLES,
  CONTENT_PATTERNS,
  inspectContentPatterns,
} from "../content-patterns.js";

test("shared content pattern examples remain executable documentation", () => {
  for (const example of CONTENT_PATTERN_EXAMPLES) {
    assert.equal(
      CONTENT_PATTERNS[example.rule].test(example.input),
      example.matches,
      `${example.rule}: ${example.input}`,
    );
  }
});

test("dry-run inspection reports line-level formatting without changing text", () => {
  const input = "来源：https://example.com/a  \n\n\n- #生活 #回忆\n";
  assert.deepEqual(inspectContentPatterns(input), {
    urls: ["https://example.com/a"],
    trailingWhitespaceLines: [1],
    excessiveBlankLineRuns: [1].length,
    terminalTagLines: [4],
    sourceLabelLines: [1],
  });
  assert.equal(input, "来源：https://example.com/a  \n\n\n- #生活 #回忆\n");
});
