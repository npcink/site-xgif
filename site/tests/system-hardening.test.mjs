import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production build exposes traceable deployment metadata", async () => {
  const info = JSON.parse(await readFile(new URL("../dist/build.json", import.meta.url), "utf8"));
  assert.equal(info.service, "xgif-site");
  assert.match(info.commit, /^(?:[a-f0-9]{7,64}|unknown)$/u);
  assert.ok(Number.isFinite(Date.parse(info.builtAt)));
});

test("scheduled production smoke requires the apex redirect", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/production-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /REQUIRE_APEX_REDIRECT:\s*"true"/u);
  assert.match(workflow, /node site\/scripts\/production-smoke\.mjs/u);
});
