import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withToolLock } from "../tool-lock.js";

test("concurrent content writers are rejected and failure releases the lock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-tool-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(withToolLock(root, async () => {
    await assert.rejects(withToolLock(root, () => assert.fail("must not run")), /另一个内容工具/u);
    throw new Error("write failed");
  }), /write failed/u);
  assert.equal(await withToolLock(root, () => 42), 42);
});
