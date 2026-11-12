import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runVisual, sourceSnapshot } from "../scripts/run-visual-remote.mjs";

async function fixture(t, options = {}) {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "xgif-visual-test-"));
  t.after(() => rm(siteDir, { recursive: true, force: true }));
  const files = {
    "package.json": "{}",
    "src/content/articles/public.md": "---\ntitle: public\ndraft: false\n---\nPublic",
    "src/content/articles/draft.md": "---\ndraft: true\n---\nPrivate draft",
    "src/content/images/private.md": "---\npublic: false\n---\nPrivate image",
    "src/secrets/token.json": "private",
    "src/secrets.json": "private",
    "public/.env.production": "TOKEN=private",
    "public/key.pem": "private",
    "private-sources/private.md": "private",
    "node_modules/package/index.js": "private",
    "tests/visual/__screenshots__/fixture.png": "old screenshot",
    ".env": "TOKEN=private",
    ...options.files,
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(siteDir, file)), { recursive: true });
    await writeFile(path.join(siteDir, file), contents);
  }
  await symlink(path.join(siteDir, ".env"), path.join(siteDir, "src/link.js"));
  const filenames = [...Object.keys(files), "src/link.js"];
  const calls = [], messages = [];
  let payload, artifactDir;
  const command = async (program, args, config = {}) => {
    calls.push({ program, args });
    if (program === "git") return { code: 0, stdout: filenames.join("\0") + "\0" };
    if (program === "ssh") {
      const script = args.at(-1);
      if (script.includes("mktemp -d")) {
        if (options.offline) return { code: 255, stdout: "" };
        return { code: 0, stdout: script.match(/mktemp -d '([^']+)'/u)[1].replace("XXXXXX", "abcdef") + "\n" };
      }
      if (script.includes("sh scripts/run-visual-container.sh") && options.abortDuringTest) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return { code: script.includes("sh scripts/run-visual-container.sh") ? (options.testCode || 0) : 0, stdout: "" };
    }
    if (program === "rsync") {
      if (config.input) payload = config.input.split("\0").filter(Boolean);
      else {
        if (options.transferFailure) return { code: 12, stdout: "" };
        artifactDir = args.at(-1);
        const returned = path.join(artifactDir, "tests/visual/__screenshots__");
        await mkdir(returned, { recursive: true });
        await writeFile(path.join(returned, "fixture.png"), "new screenshot");
        await writeFile(path.join(artifactDir, "failure.txt"), "diagnostic");
        if (options.concurrentEdit) await writeFile(path.join(siteDir, "tests/visual/__screenshots__/fixture.png"), "local edit");
      }
      return { code: 0, stdout: "" };
    }
    assert.fail(`Unexpected local command: ${program}`);
  };
  const run = (args = [], extra = {}) => runVisual({ siteDir, args, env: {}, command, log: (line) => messages.push(line), ...extra });
  return { siteDir, filenames, run, calls, messages, get payload() { return payload; }, get artifactDir() { return artifactDir; } };
}

test("M4 failure preserves test status, safely quoted arguments and returned diagnostics", async (t) => {
  const f = await fixture(t, { testCode: 7 });
  const canary = path.join(f.siteDir, "must-not-exist");
  const args = ["--grep", `literal's $(touch ${canary})`, "--project=mobile"];
  assert.equal(await f.run(args), 7);
  assert.equal(await readFile(path.join(f.artifactDir, "failure.txt"), "utf8"), "diagnostic");
  const script = f.calls.find((c) => c.program === "ssh" && c.args.at(-1).includes("sh scripts/run-visual-container.sh")).args.at(-1);
  const encoded = script.split("sh scripts/run-visual-container.sh ")[1];
  const decoded = execFileSync("sh", ["-c", `set -- ${encoded}; printf '%s\\0' "$@"`]).toString().split("\0").filter(Boolean);
  assert.deepEqual(decoded.slice(1), args);
  await assert.rejects(readFile(canary), { code: "ENOENT" });
  assert.ok(f.calls.at(-1).args.at(-1).includes("rm -rf -- '/tmp/xgif-visual-"));
  assert.ok(f.calls.every((c) => ["git", "ssh", "rsync"].includes(c.program)));
  assert.equal(await readFile(path.join(f.siteDir, "tests/visual/__screenshots__/fixture.png"), "utf8"), "old screenshot");
});

test("source transfer excludes secrets, private content, dependencies and symlinks", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.payload.sort(), ["package.json", "src/content/articles/public.md", "tests/visual/__screenshots__/fixture.png"].sort());
  const outside = await mkdtemp(path.join(os.tmpdir(), "xgif-private-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "token.js"), "private");
  await symlink(outside, path.join(f.siteDir, "src/external"));
  assert.equal((await sourceSnapshot(f.siteDir, ["src/external/token.js"])).size, 0);
});

test("updates return changed screenshots but never overwrite concurrent local edits", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(["--update-snapshots"]), 0);
  assert.equal(await readFile(path.join(f.siteDir, "tests/visual/__screenshots__/fixture.png"), "utf8"), "new screenshot");
  const changed = await fixture(t, { concurrentEdit: true });
  assert.equal(await changed.run(["--update-snapshots=changed"]), 1);
  assert.equal(await readFile(path.join(changed.siteDir, "tests/visual/__screenshots__/fixture.png"), "utf8"), "local edit");
  assert.equal(await readFile(path.join(changed.artifactDir, "tests/visual/__screenshots__/fixture.png"), "utf8"), "new screenshot");
});

test("offline M4 fails explicitly without local Docker; failed transfer keeps remote diagnostics", async (t) => {
  const offline = await fixture(t, { offline: true });
  assert.equal(await offline.run(), 255);
  assert.deepEqual(offline.calls.map((c) => c.program), ["ssh"]);
  assert.ok(offline.messages.some((line) => line.includes("未回退本机 Docker")));
  const failed = await fixture(t, { testCode: 9, transferFailure: true });
  assert.equal(await failed.run(), 9);
  assert.ok(!failed.calls.at(-1).args.at(-1).includes("rm -rf"));
  assert.ok(failed.messages.some((line) => line.includes("保留 M4 任务目录")));
});

test("low host space refuses both preparation and container launch before any Docker or task creation", async (t) => {
  const f = await fixture(t);
  await f.run();
  const scripts = f.calls.filter((c) => c.program === "ssh" && (c.args.at(-1).includes("mktemp -d") || c.args.at(-1).includes("sh scripts/run-visual-container.sh"))).map((c) => c.args.at(-1));
  const bin = path.join(f.siteDir, "fake-bin"), marker = path.join(f.siteDir, "must-not-run");
  await mkdir(bin);
  for (const name of ["docker", "mktemp", "sh"]) {
    await writeFile(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' forbidden >> '${marker}'\nexit 99\n`, { mode: 0o755 });
  }
  for (const free of ["4194304", "unknown"]) {
    await writeFile(path.join(bin, "df"), `#!/bin/sh\nprintf '%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' '/dev/disk3 20000000 10000000 ${free} 50% /tmp'\n`, { mode: 0o755 });
    for (const script of scripts) {
      const result = spawnSync("/bin/sh", ["-c", script], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
      assert.equal(result.status, 73);
      assert.match(result.stderr, free === "unknown" ? /无法读取.*未启动测试/u : /至少需要 10 GiB.*未启动测试/u);
    }
  }
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("interruption returns diagnostics and cleans only this run while preserving signal status", async (t) => {
  const f = await fixture(t, { abortDuringTest: true });
  const controller = new AbortController();
  controller.abort("SIGTERM");
  assert.equal(await f.run([], { signal: controller.signal }), 143);
  assert.equal(await readFile(path.join(f.artifactDir, "failure.txt"), "utf8"), "diagnostic");
  assert.ok(f.calls.at(-1).args.at(-1).includes("docker container inspect 'xgif-visual-"));
  assert.ok(f.calls.at(-1).args.at(-1).includes("rm -rf -- '/tmp/xgif-visual-"));
});

test("each run has its own container/directory and only GitHub Linux CI executes locally", async (t) => {
  const f = await fixture(t);
  await f.run(); await f.run([], { env: { CI: "1", GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" }, platform: "darwin" });
  const directories = f.calls.filter((c) => c.program === "ssh" && c.args.at(-1).includes("mktemp -d")).map((c) => c.args.at(-1));
  assert.equal(new Set(directories).size, 2);
  const calls = [];
  const args = ["--project=mobile", "--grep", "a b"];
  assert.equal(await runVisual({ args, env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" }, platform: "linux", command: async (...call) => { calls.push(call); return { code: 23 }; }, log() {} }), 23);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "npm");
  assert.deepEqual(calls[0][1], ["run", "test:visual", "--", ...args]);
  const script = await readFile(new URL("../scripts/run-visual-container.sh", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8");
  assert.equal(script.match(/mcr\.microsoft\.com\/playwright:[\w.-]+/u)[0], workflow.match(/mcr\.microsoft\.com\/playwright:[\w.-]+/u)[0]);
  assert.ok(!script.includes("volume create"));
});
