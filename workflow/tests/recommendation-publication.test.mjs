import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getRecommendationPublicationStatus,
  publishRecommendationManifest,
} from "../recommendation-publication.js";

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-recommendation-publication-"));
  const repoRoot = path.join(root, "repo");
  const remote = path.join(root, "origin.git");
  const manifest = path.join(repoRoot, "site", "src", "data", "recommendations.json");
  await mkdir(path.dirname(manifest), { recursive: true });
  await git(root, ["init", "--bare", remote]);
  await git(repoRoot, ["init", "-b", "main"]);
  await git(repoRoot, ["config", "user.name", "XGIF Test"]);
  await git(repoRoot, ["config", "user.email", "xgif@example.test"]);
  await writeFile(manifest, '{"schemaVersion":1,"recommendations":{"old":{}}}\n');
  await git(repoRoot, ["add", "."]);
  await git(repoRoot, ["commit", "-m", "Initial recommendations"]);
  await git(repoRoot, ["remote", "add", "origin", remote]);
  await git(repoRoot, ["push", "-u", "origin", "main"]);
  return { root, repoRoot, manifest };
}

const healthyRecommendations = {
  available: true,
  stale: false,
  covered: 1,
  total: 1,
  mode: "hybrid",
  degraded: false,
};

test("recommendation publication pushes one exact derived manifest from origin/main", async () => {
  const dirs = await createRepository();
  try {
    await writeFile(dirs.manifest, '{"schemaVersion":1,"recommendations":{"new":{}}}\n');
    const before = await getRecommendationPublicationStatus({
      repoRoot: dirs.repoRoot,
      recommendations: healthyRecommendations,
    });
    assert.equal(before.ready, true);
    assert.equal(before.currentInMain, false);

    const result = await publishRecommendationManifest({
      repoRoot: dirs.repoRoot,
      recommendations: healthyRecommendations,
    });
    assert.equal(result.push.ok, true);
    assert.equal(
      await git(dirs.repoRoot, ["show", `origin/${result.branch}:site/src/data/recommendations.json`]),
      '{"schemaVersion":1,"recommendations":{"new":{}}}',
    );
    assert.equal(await git(dirs.repoRoot, ["branch", "--show-current"]), "main");
    assert.equal(await git(dirs.repoRoot, ["branch", "--list", result.branch]), "");

    const after = await getRecommendationPublicationStatus({
      repoRoot: dirs.repoRoot,
      recommendations: healthyRecommendations,
    });
    assert.equal(after.ready, false);
    assert.equal(after.pendingBranch, result.branch);
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

test("recommendation publication blocks stale, degraded, uncovered, or content-ahead states", async () => {
  const dirs = await createRepository();
  try {
    const current = await getRecommendationPublicationStatus({
      repoRoot: dirs.repoRoot,
      recommendations: healthyRecommendations,
    });
    assert.equal(current.currentInMain, true);
    assert.equal(current.ready, false);

    await writeFile(dirs.manifest, '{"schemaVersion":1,"recommendations":{"new":{}}}\n');
    const blocked = await getRecommendationPublicationStatus({
      repoRoot: dirs.repoRoot,
      recommendations: {
        ...healthyRecommendations,
        stale: true,
        covered: 0,
        mode: "rules",
        degraded: true,
      },
      publicContentPending: 2,
    });
    assert.equal(blocked.ready, false);
    assert.match(blocked.blockers.join(" "), /不一致/u);
    assert.match(blocked.blockers.join(" "), /覆盖/u);
    assert.match(blocked.blockers.join(" "), /混合推荐/u);
    assert.match(blocked.blockers.join(" "), /2 条公开内容/u);
    await assert.rejects(
      publishRecommendationManifest({
        repoRoot: dirs.repoRoot,
        recommendations: healthyRecommendations,
        publicContentPending: 1,
      }),
      (error) => error.statusCode === 409 && /1 条公开内容/u.test(error.message),
    );
  } finally {
    await rm(dirs.root, { recursive: true, force: true });
  }
});

