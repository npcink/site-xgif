import assert from "node:assert/strict";
import test from "node:test";
import { ensureGitHubPullRequest } from "../github-pull-request.js";

test("GitHub PR automation reuses an existing pull request", async () => {
  const calls = [];
  const result = await ensureGitHubPullRequest({
    repoRoot: "/repo",
    branch: "content-sync/existing",
    query: async (_cwd, args) => {
      calls.push(args);
      return JSON.stringify([{ number: 12, url: "https://github.com/npcink/site-xgif/pull/12", state: "OPEN" }]);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.number, 12);
  assert.equal(calls.length, 1);
});

test("GitHub PR automation creates a PR without merging it", async () => {
  const calls = [];
  const result = await ensureGitHubPullRequest({
    repoRoot: "/repo",
    branch: "content-sync/new",
    title: "Publish 2 content updates",
    body: "Automated handoff.",
    query: async (_cwd, args) => {
      calls.push(args);
      return args[1] === "list" ? "[]" : "https://github.com/npcink/site-xgif/pull/15\n";
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.number, 15);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("create"));
  assert.ok(!calls[1].includes("merge"));
  assert.deepEqual(calls[0].slice(0, 4), ["pr", "list", "--state", "open"]);
});

test("GitHub PR automation ignores a non-open result and creates a new PR", async () => {
  const calls = [];
  const result = await ensureGitHubPullRequest({
    repoRoot: "/repo",
    branch: "content-sync/reopened",
    query: async (_cwd, args) => {
      calls.push(args);
      return args[1] === "list"
        ? JSON.stringify([{ number: 7, url: "https://github.com/npcink/site-xgif/pull/7", state: "CLOSED" }])
        : "https://github.com/npcink/site-xgif/pull/16\n";
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.number, 16);
  assert.equal(calls.length, 2);
});

test("GitHub PR automation rejects malformed content branch names before invoking gh", async () => {
  for (const branch of ["main", "content-sync/../main", "content-sync//bad", "content-sync/bad."]) {
    let called = false;
    const result = await ensureGitHubPullRequest({
      repoRoot: "/repo",
      branch,
      query: async () => {
        called = true;
        return "[]";
      },
    });
    assert.equal(result.attempted, false);
    assert.equal(result.ok, false);
    assert.equal(called, false);
  }
});

test("GitHub PR automation reports failure without losing the pushed branch fact", async () => {
  const result = await ensureGitHubPullRequest({
    repoRoot: "/repo",
    branch: "content-sync/unavailable",
    query: async () => { throw new Error("not authenticated"); },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /not authenticated|自动创建/u);
});
