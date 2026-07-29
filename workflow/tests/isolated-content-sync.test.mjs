import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupContentSyncBranch,
  isolatedContentSync,
  retryContentSyncPush,
} from "../isolated-content-sync.js";

function run(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-isolated-sync-test-"));
  const repoRoot = path.join(root, "repo");
  const remote = path.join(root, "origin.git");
  await mkdir(path.join(repoRoot, "site", "src", "content", "articles"), { recursive: true });
  await mkdir(path.join(repoRoot, "workflow"), { recursive: true });
  await run(root, ["init", "--bare", remote]);
  await run(repoRoot, ["init", "-b", "main"]);
  await run(repoRoot, ["config", "user.name", "XGIF Test"]);
  await run(repoRoot, ["config", "user.email", "xgif@example.test"]);
  await writeFile(
    path.join(repoRoot, "site", "src", "content", "articles", "existing.md"),
    "base article\n",
  );
  await writeFile(path.join(repoRoot, "workflow", "server.js"), "base code\n");
  await run(repoRoot, ["add", "."]);
  await run(repoRoot, ["commit", "-m", "Initial main"]);
  await run(repoRoot, ["remote", "add", "origin", remote]);
  await run(repoRoot, ["push", "-u", "origin", "main"]);
  return { root, repoRoot };
}

test("isolated content sync starts from origin/main and preserves the active dirty branch", async () => {
  const dirs = await createRepository();
  const existing = "site/src/content/articles/existing.md";
  const added = "site/src/content/articles/added.md";
  try {
    await run(dirs.repoRoot, ["switch", "-c", "codex/development"]);
    await writeFile(path.join(dirs.repoRoot, "workflow", "server.js"), "branch code\n");
    await run(dirs.repoRoot, ["add", "workflow/server.js"]);
    await run(dirs.repoRoot, ["commit", "-m", "Development code"]);
    await writeFile(path.join(dirs.repoRoot, "workflow", "server.js"), "dirty development code\n");
    await writeFile(path.join(dirs.repoRoot, existing), "updated public article\n");
    await writeFile(path.join(dirs.repoRoot, added), "new public article\n");

    const result = await isolatedContentSync({
      repoRoot: dirs.repoRoot,
      files: [existing, added],
      message: "Sync two content items",
      branch: "content-sync/test-isolation",
    });

    assert.equal(result.push.ok, true);
    assert.equal(await run(dirs.repoRoot, ["branch", "--show-current"]), "codex/development");
    assert.equal(
      await readFile(path.join(dirs.repoRoot, "workflow", "server.js"), "utf8"),
      "dirty development code\n",
    );
    assert.equal(await run(dirs.repoRoot, ["status", "--short", "--", "workflow/server.js"]), "M workflow/server.js");
    assert.equal(
      await run(dirs.repoRoot, ["branch", "--list", "content-sync/test-isolation"]),
      "content-sync/test-isolation",
    );

    const remoteRef = "origin/content-sync/test-isolation";
    assert.equal(await run(dirs.repoRoot, ["show", `${remoteRef}:workflow/server.js`]), "base code");
    assert.equal(await run(dirs.repoRoot, ["show", `${remoteRef}:${existing}`]), "updated public article");
    assert.equal(await run(dirs.repoRoot, ["show", `${remoteRef}:${added}`]), "new public article");
    assert.deepEqual(
      (await run(dirs.repoRoot, ["diff", "--name-only", `origin/main..${remoteRef}`])).split("\n"),
      [added, existing],
    );
    assert.equal(
      (await run(dirs.repoRoot, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
    assert.equal(await cleanupContentSyncBranch({
      repoRoot: dirs.repoRoot,
      branch: "content-sync/test-isolation",
    }), true);
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", "content-sync/test-isolation"]), "");
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("isolated content sync rejects files outside the public Markdown allowlist", async () => {
  await assert.rejects(
    isolatedContentSync({
      repoRoot: "/tmp/not-used",
      files: ["workflow/server.js"],
      message: "Must not run",
    }),
    /不在公开内容白名单/u,
  );
});

test("isolated content sync cleans up an empty temporary branch", async () => {
  const dirs = await createRepository();
  try {
    await assert.rejects(
      isolatedContentSync({
        repoRoot: dirs.repoRoot,
        files: ["site/src/content/articles/existing.md"],
        message: "Nothing to sync",
        branch: "content-sync/test-empty",
      }),
      /完全一致/u,
    );
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", "content-sync/test-empty"]), "");
    assert.equal(
      (await run(dirs.repoRoot, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("isolated content sync preserves its local branch when the remote rejects the push", async () => {
  const dirs = await createRepository();
  const article = "site/src/content/articles/existing.md";
  const branch = "content-sync/test-rejected-push";
  try {
    const hook = path.join(dirs.root, "origin.git", "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);
    await writeFile(path.join(dirs.repoRoot, article), "updated after rejection\n");

    const result = await isolatedContentSync({
      repoRoot: dirs.repoRoot,
      files: [article],
      message: "Sync rejected content",
      branch,
    });

    assert.equal(result.push.attempted, true);
    assert.equal(result.push.ok, false);
    assert.match(result.push.error, /rejected|failed|declined/u);
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", branch]), branch);
    assert.equal(await run(dirs.repoRoot, ["show", `${branch}:${article}`]), "updated after rejection");
    assert.equal(
      (await run(dirs.repoRoot, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("a rejected content sync retries the preserved branch instead of the active branch", async () => {
  const dirs = await createRepository();
  const article = "site/src/content/articles/existing.md";
  const branch = "content-sync/test-retry";
  try {
    const hook = path.join(dirs.root, "origin.git", "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);
    await run(dirs.repoRoot, ["switch", "-c", "codex/active-work"]);
    await writeFile(path.join(dirs.repoRoot, article), "retry this exact content\n");

    const first = await isolatedContentSync({
      repoRoot: dirs.repoRoot,
      files: [article],
      message: "Sync content for retry",
      branch,
    });
    assert.equal(first.push.ok, false);

    await writeFile(hook, "#!/bin/sh\nexit 0\n");
    await chmod(hook, 0o755);
    const retried = await retryContentSyncPush({
      repoRoot: dirs.repoRoot,
      branch,
    });

    assert.equal(retried.push.ok, true);
    assert.equal(await run(dirs.repoRoot, ["branch", "--show-current"]), "codex/active-work");
    assert.equal(await run(dirs.repoRoot, ["show", `origin/${branch}:${article}`]), "retry this exact content");
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", branch]), branch);
    await cleanupContentSyncBranch({ repoRoot: dirs.repoRoot, branch });
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", branch]), "");
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("isolated sync records a prepared commit before pushing it", async () => {
  const dirs = await createRepository();
  const article = "site/src/content/articles/existing.md";
  const branch = "content-sync/test-prepared";
  try {
    await writeFile(path.join(dirs.repoRoot, article), "prepared content\n");
    let prepared = null;
    const result = await isolatedContentSync({
      repoRoot: dirs.repoRoot,
      files: [article],
      message: "Prepared content",
      branch,
      onPrepared: async (value) => {
        prepared = value;
        await assert.rejects(run(dirs.repoRoot, ["rev-parse", `origin/${branch}`]));
      },
    });
    assert.equal(result.push.ok, true);
    assert.equal(prepared.branch, branch);
    assert.equal(prepared.commitSha, result.commitSha);
    assert.equal(await run(dirs.repoRoot, ["branch", "--list", branch]), branch);
    await cleanupContentSyncBranch({ repoRoot: dirs.repoRoot, branch });
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("isolated sync rejects content changed after readiness inspection", async () => {
  const dirs = await createRepository();
  const article = "site/src/content/articles/existing.md";
  try {
    await writeFile(path.join(dirs.repoRoot, article), "changed after inspection\n");
    await assert.rejects(
      isolatedContentSync({
        repoRoot: dirs.repoRoot,
        files: [article],
        message: "Must stop",
        branch: "content-sync/test-version-mismatch",
        expectedContentSha256: {
          [article]: createHash("sha256").update("older inspected content\n").digest("hex"),
        },
      }),
      (error) => error.statusCode === 409 && /发生变化/u.test(error.message),
    );
    assert.equal(
      await run(dirs.repoRoot, ["branch", "--list", "content-sync/test-version-mismatch"]),
      "",
    );
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});
