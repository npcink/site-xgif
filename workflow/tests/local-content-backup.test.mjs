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
    mkdir(path.join(workflowRoot, "private-sources", "articles"), { recursive: true }),
    mkdir(path.join(workflowRoot, ".runtime"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(repoRoot, "site", "src", "content", "articles", "draft.md"), "draft one", "utf8"),
    writeFile(path.join(workflowRoot, "records", "items.jsonl"), "{}\n", "utf8"),
    writeFile(path.join(workflowRoot, "private-sources", "articles", "draft.md"), "private source\n", "utf8"),
    writeFile(path.join(workflowRoot, ".env"), "SECRET=do-not-back-up\n", "utf8"),
    writeFile(path.join(workflowRoot, ".runtime", "xgif.sqlite3"), "database", "utf8"),
  ]);

  const backup = new LocalContentBackup({ repoRoot, workflowRoot });
  const first = await backup.snapshot("first snapshot");
  assert.equal(first.changed, true);
  assert.equal(first.offsite.configured, false);
  assert.equal(first.offsite.ok, false);
  assert.match(first.offsite.error, /尚未配置私有内容远端/);
  await writeFile(path.join(repoRoot, "site", "src", "content", "articles", "draft.md"), "draft two", "utf8");
  const second = await backup.snapshot("second snapshot");
  assert.equal(second.changed, true);
  assert.notEqual(first.commit, second.commit);
  const unchanged = await backup.snapshot("unchanged snapshot");
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.commit, second.commit);
  const history = await backup.listFileHistory("site/src/content/articles/draft.md");
  assert.equal(history.length, 2);
  assert.equal(history[0].commit, second.commit);
  assert.equal(
    await backup.readFileVersion("site/src/content/articles/draft.md", first.commit),
    "draft one",
  );
  assert.equal(
    await backup.readFileVersion("site/src/content/articles/draft.md", second.commit),
    "draft two",
  );

  const { stdout } = await execFileAsync("git", [
    `--git-dir=${backup.gitDir}`,
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
  ]);
  assert.match(stdout, /site\/src\/content\/articles\/draft\.md/);
  assert.match(stdout, /workflow\/records\/items\.jsonl/);
  assert.match(stdout, /workflow\/private-sources\/articles\/draft\.md/);
  assert.doesNotMatch(stdout, /\.env|xgif\.sqlite3/);
});

test("private content status distinguishes the local snapshot from the synchronized remote", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-content-offsite-"));
  const workflowRoot = path.join(repoRoot, "workflow");
  const articleDirectory = path.join(repoRoot, "site", "src", "content", "articles");
  const remoteDirectory = path.join(repoRoot, "private-content.git");
  await mkdir(articleDirectory, { recursive: true });
  await writeFile(path.join(articleDirectory, "draft.md"), "private draft", "utf8");
  await execFileAsync("git", ["init", "--bare", "--initial-branch=history", remoteDirectory]);

  const backup = new LocalContentBackup({ repoRoot, workflowRoot });
  await backup.ensureRepository();
  await execFileAsync("git", [
    `--git-dir=${backup.gitDir}`,
    "remote",
    "add",
    "origin",
    remoteDirectory,
  ]);

  const snapshot = await backup.snapshot("sync private content");
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.files, 1);
  assert.equal(snapshot.offsite.configured, true);
  assert.equal(snapshot.offsite.ok, true);
  assert.equal(snapshot.offsite.branch, "history");
  assert.equal(snapshot.offsite.commit, snapshot.commit);
  assert.ok(snapshot.offsite.syncedAt);

  const status = await backup.status();
  assert.equal(status.offsite.ok, true);
  assert.equal(status.offsite.commit, status.commit);
});
