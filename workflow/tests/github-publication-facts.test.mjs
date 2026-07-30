import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPullRequest,
  GitHubPublicationFacts,
} from "../github-publication-facts.js";

function check(name, status, conclusion) {
  return { name, status, conclusion };
}

test("GitHub publication facts separate checks, merge, and deployment results", () => {
  assert.equal(classifyPullRequest({
    state: "OPEN",
    statusCheckRollup: [check("Astro site", "IN_PROGRESS", "")],
  }).stage, "checks_running");
  assert.equal(classifyPullRequest({
    state: "OPEN",
    statusCheckRollup: [check("Astro site", "COMPLETED", "FAILURE")],
  }).stage, "checks_failed");
  assert.equal(classifyPullRequest({
    state: "OPEN",
    statusCheckRollup: [check("Astro site", "COMPLETED", "SUCCESS")],
  }).stage, "checks_passed");
  assert.equal(classifyPullRequest({
    state: "MERGED",
    statusCheckRollup: [check("Workers Builds: site-www-xgif", "COMPLETED", "SUCCESS")],
  }).stage, "deployment_succeeded");
  assert.equal(classifyPullRequest({
    state: "MERGED",
    statusCheckRollup: [check("Workers Builds: site-www-xgif", "COMPLETED", "FAILURE")],
  }).stage, "deployment_failed");
});

test("GitHub publication facts fail closed when remote status is unavailable", async () => {
  const facts = new GitHubPublicationFacts({ repoRoot: "/not-used", ttlMs: 30_000 });
  facts.cachedAt = Date.now();
  facts.available = false;
  const result = await facts.forBranches(["content-sync/example"]);
  assert.equal(result.get("content-sync/example").stage, "remote_unknown");
  assert.match(result.get("content-sync/example").description, /保留已推送事实/u);
});

test("GitHub publication facts query each requested branch exactly", async () => {
  const calls = [];
  const facts = new GitHubPublicationFacts({
    repoRoot: "/repo",
    ttlMs: 30_000,
    query: async (_cwd, args) => {
      calls.push(args);
      const branch = args[args.indexOf("--head") + 1];
      return JSON.stringify(branch.endsWith("with-pr") ? [{
        number: 7,
        headRefName: branch,
        state: "OPEN",
        statusCheckRollup: [],
        url: "https://github.com/example/repo/pull/7",
      }] : []);
    },
  });
  const result = await facts.forBranches([
    "content-sync/with-pr",
    "content-sync/without-pr",
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args.includes("--head") && args.includes("--limit")));
  assert.equal(result.get("content-sync/with-pr").stage, "pr_open");
  assert.equal(result.get("content-sync/without-pr").stage, "pushed_no_pr");
});

test("concurrent GitHub fact requests refresh branches missing from the active query", async () => {
  let releaseFirstQuery;
  const firstQuery = new Promise((resolve) => {
    releaseFirstQuery = resolve;
  });
  const calls = [];
  const facts = new GitHubPublicationFacts({
    repoRoot: "/repo",
    ttlMs: 30_000,
    query: async (_cwd, args) => {
      const branch = args[args.indexOf("--head") + 1];
      calls.push(branch);
      if (branch === "content-sync/first") await firstQuery;
      return "[]";
    },
  });

  const first = facts.forBranches(["content-sync/first"]);
  await new Promise((resolve) => setImmediate(resolve));
  const second = facts.forBranches(["content-sync/second"]);
  releaseFirstQuery();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.get("content-sync/first").stage, "pushed_no_pr");
  assert.equal(secondResult.get("content-sync/second").stage, "pushed_no_pr");
  assert.deepEqual(calls, ["content-sync/first", "content-sync/second"]);
});

test("one failed GitHub branch query does not hide successful branch facts", async () => {
  const facts = new GitHubPublicationFacts({
    repoRoot: "/repo",
    ttlMs: 30_000,
    query: async (_cwd, args) => {
      const branch = args[args.indexOf("--head") + 1];
      if (branch === "content-sync/broken") throw new Error("network unavailable");
      return JSON.stringify([{
        number: 9,
        headRefName: branch,
        state: "OPEN",
        statusCheckRollup: [],
        url: "https://github.com/example/repo/pull/9",
      }]);
    },
  });
  const result = await facts.forBranches([
    "content-sync/healthy",
    "content-sync/broken",
  ]);
  assert.equal(result.get("content-sync/healthy").stage, "pr_open");
  assert.equal(result.get("content-sync/broken").stage, "remote_unknown");
});
