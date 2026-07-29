import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  readRecoveryDrillStatus,
  runRecoveryDrill,
} from "../recovery-drill.js";

test("recovery drill rebuilds a temporary corrupted database and records the result", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-recovery-drill-"));
  await Promise.all([
    mkdir(path.join(repoRoot, "site", "src", "content", "articles"), { recursive: true }),
    mkdir(path.join(repoRoot, "site", "src", "content", "images"), { recursive: true }),
    mkdir(path.join(repoRoot, "workflow", "trash", "content"), { recursive: true }),
  ]);
  const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const statusPath = path.join(repoRoot, "recovery-drill.json");
  const result = await runRecoveryDrill({
    repoRoot,
    workflowRoot,
    statusPath,
    runtimeVersion: "test-runtime-version",
  });
  assert.equal(result.ok, true);
  assert.equal(result.corruptDatabaseWasQuarantined, true);
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/u);
  const recorded = await readRecoveryDrillStatus(statusPath);
  assert.equal(recorded.content, 0);
  assert.equal(recorded.runtimeVersion, "test-runtime-version");
});
