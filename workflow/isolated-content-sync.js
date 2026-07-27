import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const publicContentPrefixes = [
  "site/src/content/articles/",
  "site/src/content/images/",
];

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
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

function syncBranchName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `content-sync/${stamp}-${randomUUID().slice(0, 6)}`;
}

export async function isolatedContentSync({
  repoRoot,
  files,
  message,
  baseRef = "origin/main",
  remote = "origin",
  branch = syncBranchName(),
}) {
  const relativeFiles = normalizedContentFiles(files);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-content-sync-"));
  const worktreePath = path.join(temporaryRoot, "checkout");
  let worktreeAdded = false;
  let push = { attempted: false, ok: false, error: "" };
  let commitSha = "";
  let commitCreated = false;

  try {
    await git(repoRoot, ["fetch", remote, "main"]);
    await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseRef]);
    worktreeAdded = true;

    for (const relativeFile of relativeFiles) {
      const source = path.join(repoRoot, relativeFile);
      const destination = path.join(worktreePath, relativeFile);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
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
    push.attempted = true;
    try {
      await git(worktreePath, ["push", "-u", remote, branch]);
      push.ok = true;
    } catch (error) {
      push.error = String(error.stderr || error.stdout || error.message || "推送失败。").trim();
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
    if (push.ok || !commitCreated) {
      await git(repoRoot, ["branch", "-D", branch]).catch(() => {});
    }
  }
}

export const isolatedContentSyncPolicy = {
  baseRef: "origin/main",
  publicContentPrefixes,
};
