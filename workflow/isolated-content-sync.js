import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isPublicContentFile,
  isPublicDerivedFile,
  normalizePublicAssetFile,
  normalizePublicContentFile,
  normalizePublicDerivedFile,
  publicAssetPrefixes,
  publicContentPrefixes,
  publicDerivedFiles,
} from "./publication-bundle.js";
import { safeProcessError } from "./safe-process-error.js";

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

function normalizedContentFiles(files, { allowEmpty = false } = {}) {
  const unique = [...new Set((files || []).map((file) => String(file || "").replaceAll("\\", "/")))];
  if (!unique.length && !allowEmpty) throw new Error("没有可以同步的公开内容文件。");
  return unique.map((file) => {
    if (isPublicContentFile(file)) return normalizePublicContentFile(file);
    if (isPublicDerivedFile(file)) return normalizePublicDerivedFile(file);
    return normalizePublicAssetFile(file);
  });
}

function normalizedDeletionFiles(files) {
  return [...new Set((files || []).map(normalizePublicContentFile))];
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
  deleteFiles = [],
  expectedContentSha256 = {},
  expectedFileSha256 = expectedContentSha256,
  expectedDeletionContentIds = {},
  onPrepared = null,
}) {
  const deletionFiles = normalizedDeletionFiles(deleteFiles);
  const relativeFiles = normalizedContentFiles(files, { allowEmpty: deletionFiles.length > 0 });
  const overlap = relativeFiles.filter((file) => deletionFiles.includes(file));
  if (overlap.length) throw new Error(`同一发布批次不能同时更新和删除：${overlap.join("、")}`);
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
      const expected = String(expectedFileSha256[relativeFile] || "");
      if (expected) {
        const actual = createHash("sha256").update(await readFile(destination)).digest("hex");
        if (actual !== expected) {
          const error = new Error(`内容在上线体检后发生变化，已停止同步：${relativeFile}`);
          error.statusCode = 409;
          throw error;
        }
      }
    }

    for (const relativeFile of deletionFiles) {
      const expectedContentId = String(expectedDeletionContentIds[relativeFile] || "");
      if (expectedContentId) {
        try {
          const markdown = await readFile(path.join(worktreePath, relativeFile), "utf8");
          const actualContentId = markdown.match(/^contentId:\s*["']?([^"'\n]+)["']?\s*$/mu)?.[1]?.trim() || "";
          if (actualContentId !== expectedContentId) {
            const error = new Error(`待下架路径已被另一条内容占用：${relativeFile}`);
            error.statusCode = 409;
            throw error;
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }

    if (relativeFiles.length) await git(worktreePath, ["add", "--", ...relativeFiles]);
    if (deletionFiles.length) {
      await git(worktreePath, ["rm", "--ignore-unmatch", "--", ...deletionFiles]);
    }
    const changedFiles = [...relativeFiles, ...deletionFiles];
    const changed = (await git(
      worktreePath,
      ["status", "--porcelain=v1", "--", ...changedFiles],
    )).stdout.trim();
    if (!changed) {
      if (!relativeFiles.length && deletionFiles.length) {
        commitSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
        push = { attempted: false, ok: true, error: "" };
        return {
          branch,
          relativeFiles,
          deletionFiles,
          commitSha,
          push,
          baseRef,
          noChange: true,
        };
      }
      const error = new Error("所选内容与 origin/main 完全一致，没有需要同步的变更。");
      error.statusCode = 422;
      throw error;
    }

    await git(worktreePath, ["commit", "-m", message, "--", ...changedFiles]);
    commitCreated = true;
    commitSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (typeof onPrepared === "function") {
      await onPrepared({ branch, commitSha, relativeFiles, deletionFiles, baseRef });
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
      deletionFiles,
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
  publicAssetPrefixes,
  publicDerivedFiles,
};
