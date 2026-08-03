import assert from "node:assert/strict";
import test from "node:test";
import { contentPathsMatchingRef } from "../git-content-membership.js";

test("content membership recognizes working files already identical to origin/main", async () => {
  const paths = [
    "site/src/content/articles/current.md",
    "site/src/content/articles/changed.md",
    "site/src/content/images/new.md",
  ];
  const calls = [];
  const matching = await contentPathsMatchingRef({
    paths,
    ref: "origin/main",
    runGit: async (args) => {
      calls.push(args);
      if (args[0] === "ls-tree") {
        return {
          stdout: [
            "100644 blob aaaa\tsite/src/content/articles/current.md",
            "100644 blob bbbb\tsite/src/content/articles/changed.md",
            "",
          ].join("\0"),
        };
      }
      return { stdout: "aaaa\ncccc\ndddd\n" };
    },
  });

  assert.deepEqual([...matching], ["site/src/content/articles/current.md"]);
  assert.deepEqual(calls, [
    ["ls-tree", "-r", "-z", "origin/main", "--", ...paths],
    ["hash-object", "--", ...paths],
  ]);
});

test("content membership fails closed when Git omits a working hash", async () => {
  await assert.rejects(
    contentPathsMatchingRef({
      paths: ["one.md", "two.md"],
      ref: "origin/main",
      runGit: async (args) => (
        args[0] === "ls-tree"
          ? { stdout: "100644 blob aaaa\tone.md\0" }
          : { stdout: "aaaa\n" }
      ),
    }),
    /无法完整核对/u,
  );
});
