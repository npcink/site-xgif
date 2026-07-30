import assert from "node:assert/strict";
import test from "node:test";
import { safeProcessError } from "../safe-process-error.js";

test("external process errors redact credentials, tokens, and configured paths", () => {
  const exampleToken = ["github", "pat", "exampleToken"].join("_");
  const error = {
    stderr: `fatal: https://user:secret@example.test/repo ${exampleToken} /private/work/repo`,
  };
  const message = safeProcessError(error, { redactPaths: ["/private/work/repo"] });
  assert.equal(
    message,
    "fatal: https://example.test/repo [redacted] [workspace]",
  );
});

test("external process errors return a stable fallback", () => {
  assert.equal(
    safeProcessError(null, { fallback: "同步失败。" }),
    "同步失败。",
  );
});

test("external process errors are bounded before persistence or API output", () => {
  const result = safeProcessError({ stderr: "x".repeat(5_000) });
  assert.equal(result.length, 2_000);
  assert.match(result, /…$/u);
});
