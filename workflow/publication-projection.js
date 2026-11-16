import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyRecommendationPublication } from "./recommendation-verify.js";

const exec = promisify(execFile);
const manifestFile = "site/src/data/recommendations.json";
/** A detached filesystem projection; never checks out the user's dirty tree or creates a branch. */
export async function planRecommendationPublication({ repoRoot, bundle, baseRef = "origin/main" }) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "xgif-publication-projection-")));
  const root = path.join(temporary, "snapshot");
  try {
    const { stdout } = await exec("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], { cwd: repoRoot });
    const expectedBaseCommit = stdout.trim();
    const archive = path.join(temporary, "base.tar");
    await exec("git", ["archive", "--format=tar", `--output=${archive}`, expectedBaseCommit], { cwd: repoRoot });
    await mkdir(root);
    await exec("tar", ["-xf", archive, "-C", root]);
    for (const file of bundle.files) {
      const destination = path.join(root, file);
      await mkdir(path.dirname(destination), { recursive: true });
      // Do not follow a tracked symlink in the base checkout.
      if (await realpath(path.dirname(destination)) !== path.dirname(destination)) throw new Error("发布基线包含符号链接");
      await rm(destination, { force: true });
      await copyFile(path.join(repoRoot, file), destination);
      const actual = createHash("sha256").update(await readFile(destination)).digest("hex");
      if (actual !== bundle.expectedFileSha256[file]) throw new Error(`内容在发布规划期间变化：${file}`);
    }
    // Prefer the already published manifest for metadata-only edits. Otherwise carry
    // the local artifact only if it exactly describes this projected public library.
    try {
      const recommendationCheck = await verifyRecommendationPublication(root);
      return { ...bundle, expectedBaseCommit, recommendationCheck };
    } catch {
      await mkdir(path.dirname(path.join(root, manifestFile)), { recursive: true });
      await rm(path.join(root, manifestFile), { force: true });
      try { await copyFile(path.join(repoRoot, manifestFile), path.join(root, manifestFile)); }
      catch (error) {
        if (error.code === "ENOENT") throw new Error("缺少与发布快照匹配的推荐清单，请针对 origin/main 加本批选中文件重建。");
        throw error;
      }
      const recommendationCheck = await verifyRecommendationPublication(root);
      return { ...bundle, files: [...bundle.files, manifestFile].sort(), expectedBaseCommit, recommendationCheck,
        expectedFileSha256: { ...bundle.expectedFileSha256, [manifestFile]: createHash("sha256").update(await readFile(path.join(root, manifestFile))).digest("hex") } };
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** Retry must verify the recorded commit itself, never substitute current local data. */
export async function verifyRecommendationRef(repoRoot, ref) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "xgif-publication-ref-")));
  try {
    const root = path.join(temporary, "snapshot"); await mkdir(root);
    const archive = path.join(temporary, "ref.tar");
    await exec("git", ["archive", "--format=tar", `--output=${archive}`, ref], { cwd: repoRoot });
    await exec("tar", ["-xf", archive, "-C", root]);
    return await verifyRecommendationPublication(root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
