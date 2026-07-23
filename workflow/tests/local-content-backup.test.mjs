import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { LocalContentBackup } from "../local-content-backup.js";

const execFileAsync = promisify(execFile);

test("private Git snapshots include only content allowlist paths", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-content-backup-"));
  const workflowRoot = path.join(repoRoot, "workflow");
  await Promise.all([
    mkdir(path.join(repoRoot, "site", "src", "content", "articles"), { recursive: true }),
    mkdir(path.join(repoRoot, "site", "src", "content", "images"), { recursive: true }),
    mkdir(path.join(repoRoot, "site", "public", "images", "memes"), { recursive: true }),
    mkdir(path.join(workflowRoot, "records"), { recursive: true }),
    mkdir(path.join(workflowRoot, ".runtime"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(repoRoot, "site", "src", "content", "articles", "draft.md"), "draft one", "utf8"),
    writeFile(path.join(workflowRoot, "records", "items.jsonl"), "{}\n", "utf8"),
    writeFile(path.join(workflowRoot, ".env"), "SECRET=do-not-back-up\n", "utf8"),
    writeFile(path.join(workflowRoot, ".runtime", "xgif.sqlite3"), "database", "utf8"),
  ]);

  const backup = new LocalContentBackup({ repoRoot, workflowRoot });
  const first = await backup.snapshot("first snapshot");
  assert.equal(first.changed, true);
  await writeFile(path.join(repoRoot, "site", "src", "content", "articles", "draft.md"), "draft two", "utf8");
  const second = await backup.snapshot("second snapshot");
  assert.equal(second.changed, true);
  assert.notEqual(first.commit, second.commit);
  const unchanged = await backup.snapshot("unchanged snapshot");
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.commit, second.commit);

  const { stdout } = await execFileAsync("git", [
    `--git-dir=${backup.gitDir}`,
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
  ]);
  assert.match(stdout, /site\/src\/content\/articles\/draft\.md/);
  assert.match(stdout, /workflow\/records\/items\.jsonl/);
  assert.doesNotMatch(stdout, /\.env|xgif\.sqlite3/);
});
