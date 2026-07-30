import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupContentSyncBranch,
  contentSyncBranchName,
  isolatedContentSync,
} from "./isolated-content-sync.js";
import { recommendationManifestPath } from "./recommendation-engine.js";

function git(cwd, args, { trim = true } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      const value = String(stdout || "");
      resolve(trim ? value.trim() : value);
    });
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function manifestVersion(repoRoot) {
  const absolute = recommendationManifestPath(repoRoot);
  const file = path.relative(repoRoot, absolute).split(path.sep).join("/");
  const content = await readFile(absolute);
  return { file, sha256: sha256(content) };
}

async function refFileSha256(repoRoot, ref, file) {
  try {
    return sha256(await git(repoRoot, ["show", `${ref}:${file}`], { trim: false }));
  } catch {
    return "";
  }
}

function readinessBlockers(recommendations, publicContentPending) {
  const blockers = [];
  if (!recommendations?.available) blockers.push("推荐清单不存在。");
  if (recommendations?.stale) blockers.push("推荐清单与当前公开内容不一致。");
  if (Number(recommendations?.covered || 0) !== Number(recommendations?.total || 0)) {
    blockers.push("推荐清单尚未覆盖全部公开内容。");
  }
  if (recommendations?.mode !== "hybrid" || recommendations?.degraded) {
    blockers.push("推荐清单不是健康的混合推荐结果。");
  }
  if (Number(publicContentPending || 0) > 0) {
    blockers.push(`仍有 ${Number(publicContentPending)} 条公开内容未进入 origin/main。`);
  }
  return blockers;
}

export async function getRecommendationPublicationStatus({
  repoRoot,
  recommendations,
  publicContentPending = 0,
}) {
  let version;
  try {
    version = await manifestVersion(repoRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      file: "site/src/data/recommendations.json",
      manifestSha256: "",
      currentInMain: false,
      pendingBranch: "",
      ready: false,
      blockers: ["推荐清单不存在。"],
    };
  }
  const mainSha256 = await refFileSha256(repoRoot, "origin/main", version.file);
  const currentInMain = mainSha256 === version.sha256;
  let pendingBranch = "";
  if (!currentInMain) {
    const branches = await git(repoRoot, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)",
      "refs/remotes/origin/content-sync/",
    ]).catch(() => "");
    for (const branch of branches.split("\n").filter(Boolean).slice(0, 30)) {
      if (await refFileSha256(repoRoot, branch, version.file) === version.sha256) {
        pendingBranch = branch.replace(/^origin\//u, "");
        break;
      }
    }
  }
  const blockers = readinessBlockers(recommendations, publicContentPending);
  if (currentInMain) blockers.push("当前推荐清单已经进入 origin/main。");
  if (pendingBranch) blockers.push(`相同推荐清单已在 ${pendingBranch} 等待合并。`);
  return {
    file: version.file,
    manifestSha256: version.sha256,
    currentInMain,
    pendingBranch,
    ready: blockers.length === 0,
    blockers,
  };
}

export async function publishRecommendationManifest({
  repoRoot,
  recommendations,
  publicContentPending = 0,
}) {
  const publication = await getRecommendationPublicationStatus({
    repoRoot,
    recommendations,
    publicContentPending,
  });
  if (!publication.ready) {
    const error = new Error(publication.blockers.join(" "));
    error.statusCode = 409;
    error.publication = publication;
    throw error;
  }
  const branch = contentSyncBranchName();
  const result = await isolatedContentSync({
    repoRoot,
    files: [publication.file],
    message: "Publish recommendation manifest",
    branch,
    expectedFileSha256: {
      [publication.file]: publication.manifestSha256,
    },
  });
  if (result.push.ok) {
    await cleanupContentSyncBranch({ repoRoot, branch: result.branch });
  }
  return {
    ...result,
    manifestSha256: publication.manifestSha256,
  };
}
