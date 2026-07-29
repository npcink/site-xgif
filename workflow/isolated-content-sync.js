import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeProcessError } from "./safe-process-error.js";

const publicContentPrefixes = [
  "site/src/content/articles/",
  "site/src/content/images/",
];

function git(cwd, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd,
      ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGTERM" } : {}),
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizedContentFiles(files) {
  const unique = [...new Set((files || []).map((file) => String(file || "").replaceAll("\\", "/")))];
  if (!unique.length) throw new Error("没有可以同步的公开内容文件。");
  for (const file of unique) {
    if (
      path.isAbsolute(file)
      || file.includes("../")
      || !publicContentPrefixes.some((prefix) => file.startsWith(prefix))
      || !file.endsWith(".md")
    ) {
      throw new Error(`同步文件不在公开内容白名单中：${file}`);
    }
  }
  return unique;
}

export function contentSyncBranchName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `content-sync/${stamp}-${randomUUID().slice(0, 6)}`;
}

export async function isolatedContentSync({
  repoRoot,
  files,
  message,
  baseRef = "origin/main",
  remote = "origin",
  branch = contentSyncBranchName(),
  expectedContentSha256 = {},
  onPrepared = null,
}) {
  const relativeFiles = normalizedContentFiles(files);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-content-sync-"));
  const worktreePath = path.join(temporaryRoot, "checkout");
  let worktreeAdded = false;
  let push = { attempted: false, ok: false, error: "" };
  let commitSha = "";
  let commitCreated = false;
  let preparedRecorded = false;

  try {
    await git(repoRoot, ["fetch", remote, "main"]);
    await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseRef]);
    worktreeAdded = true;

    for (const relativeFile of relativeFiles) {
      const source = path.join(repoRoot, relativeFile);
      const destination = path.join(worktreePath, relativeFile);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      const expected = String(expectedContentSha256[relativeFile] || "");
      if (expected) {
        const actual = createHash("sha256").update(await readFile(destination)).digest("hex");
        if (actual !== expected) {
          const error = new Error(`内容在上线体检后发生变化，已停止同步：${relativeFile}`);
          error.statusCode = 409;
          throw error;
        }
      }
    }

    await git(worktreePath, ["add", "--", ...relativeFiles]);
    const changed = (await git(worktreePath, ["status", "--porcelain=v1", "--", ...relativeFiles])).stdout.trim();
    if (!changed) {
      const error = new Error("所选内容与 origin/main 完全一致，没有需要同步的变更。");
      error.statusCode = 422;
      throw error;
    }

    await git(worktreePath, ["commit", "-m", message, "--", ...relativeFiles]);
    commitCreated = true;
    commitSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (typeof onPrepared === "function") {
      await onPrepared({ branch, commitSha, relativeFiles, baseRef });
    }
    preparedRecorded = true;
    push.attempted = true;
    try {
      await git(worktreePath, ["push", "-u", remote, branch], { timeoutMs: 60_000 });
      push.ok = true;
    } catch (error) {
      push.error = safeProcessError(error, {
        fallback: "推送失败。",
        redactPaths: [repoRoot, temporaryRoot],
      });
    }

    return {
      branch,
      relativeFiles,
      commitSha,
      push,
      baseRef,
    };
  } finally {
    if (worktreeAdded) {
      await git(repoRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    if (!commitCreated || !preparedRecorded) {
      await git(repoRoot, ["branch", "-D", branch]).catch(() => {});
    }
  }
}

export async function retryContentSyncPush({
  repoRoot,
  branch,
  remote = "origin",
}) {
  const normalizedBranch = String(branch || "").trim();
  if (!/^content-sync\/[0-9A-Za-z._/-]+$/u.test(normalizedBranch)) {
    const error = new Error("只能重试本地保留的 content-sync 内容分支。");
    error.statusCode = 400;
    throw error;
  }
  await git(repoRoot, ["show-ref", "--verify", `refs/heads/${normalizedBranch}`]);
  const commitSha = (await git(repoRoot, ["rev-parse", normalizedBranch])).stdout.trim();
  const push = { attempted: true, ok: false, error: "" };
  try {
    await git(repoRoot, ["push", "-u", remote, normalizedBranch], { timeoutMs: 60_000 });
    push.ok = true;
  } catch (error) {
    push.error = safeProcessError(error, {
      fallback: "推送失败。",
      redactPaths: [repoRoot],
    });
  }
  return { branch: normalizedBranch, commitSha, push };
}

export async function cleanupContentSyncBranch({ repoRoot, branch }) {
  const normalizedBranch = String(branch || "").trim();
  if (!/^content-sync\/[0-9A-Za-z._/-]+$/u.test(normalizedBranch)) return false;
  return git(repoRoot, ["branch", "-D", normalizedBranch])
    .then(() => true)
    .catch(() => false);
}

export const isolatedContentSyncPolicy = {
  baseRef: "origin/main",
  publicContentPrefixes,
};
