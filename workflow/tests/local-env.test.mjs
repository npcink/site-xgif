import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalEnv } from "../local-env.js";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xgif-local-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("reads dotenv quotes and comments without overriding the caller's environment", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(path.join(directory, ".env"), [
    'DOUBLE="model # name" # a comment',
    "SINGLE='bucket name' # a comment",
    "PLAIN=value# a comment",
    'EMPTY="" # a comment',
    "DUPLICATE=first",
    "DUPLICATE=last",
    "PRESET=from-file",
    "PRESET_EMPTY=from-file",
  ].join("\r\n"));
  const env = { PRESET: "from-shell", PRESET_EMPTY: "" };

  assert.equal(await loadLocalEnv(directory, { env }), env);
  assert.deepEqual(env, {
    DOUBLE: "model # name",
    SINGLE: "bucket name",
    PLAIN: "value",
    EMPTY: "",
    DUPLICATE: "last",
    PRESET: "from-shell",
    PRESET_EMPTY: "",
  });
});

test("allows a missing dotenv file but propagates other read errors", async (t) => {
  const directory = await temporaryDirectory(t);
  const env = { PRESET: "from-shell" };
  assert.equal(await loadLocalEnv(directory, { env }), env);
  await mkdir(path.join(directory, ".env"));
  await assert.rejects(loadLocalEnv(directory, { env }), { code: "EISDIR" });
});
