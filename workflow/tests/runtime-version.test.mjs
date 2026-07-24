import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { publisherSourceVersion } from "../runtime-version.js";

test("publisher source version changes when runtime code changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-runtime-version-"));
  await mkdir(path.join(root, "db", "migrations"), { recursive: true });
  await writeFile(path.join(root, "server.js"), "export const value = 1;\n");
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "db", "migrations", "001.sql"), "SELECT 1;\n");
  const first = publisherSourceVersion(root);
  await writeFile(path.join(root, "server.js"), "export const value = 2;\n");
  const second = publisherSourceVersion(root);
  assert.match(first, /^[a-f0-9]{16}$/);
  assert.notEqual(first, second);
});
