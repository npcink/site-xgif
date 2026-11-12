import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const loader = await readFile(new URL("../public/scripts/analytics.js", import.meta.url), "utf8");
const { siteConfig } = await import("../src/config/site.ts");
const siteHost = new URL(siteConfig.url).hostname;

function runLoader(hostname, configuredHost = siteHost, queue) {
  const scripts = [];
  const window = { location: { hostname }, _mtj: queue };
  const document = {
    currentScript: configuredHost ? { dataset: { siteHost: configuredHost } } : null,
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) },
  };
  vm.runInNewContext(loader, { window, document });
  return { scripts, queue: window._mtj };
}

test("analytics loads asynchronously on the configured host and preserves queued commands", () => {
  const queue = [["example-command"]];
  const result = runLoader(siteHost, siteHost, queue);
  assert.equal(result.queue, queue);
  assert.equal(result.scripts.length, 1);
  assert.equal(result.scripts[0].async, true);
  assert.equal(result.scripts[0].src, "https://node90.aizhantj.com:21233/tjjs/?k=5nawhk8s42j");
  assert.ok(Array.isArray(runLoader(siteHost).queue));
});

test("analytics sends no requests from local builds, preview hosts, or missing host metadata", () => {
  for (const hostname of ["localhost", "127.0.0.1", "preview.workers.dev", `${siteHost}.example.com`]) {
    assert.equal(runLoader(hostname).scripts.length, 0);
    assert.equal(runLoader(hostname).queue, undefined);
  }
  assert.equal(runLoader(siteHost, null).scripts.length, 0);
});

test("production pages include analytics while personal and search pages exclude it", async () => {
  const builtPage = (path) => readFile(new URL(`../dist/${path}/index.html`, import.meta.url), "utf8");
  const home = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(home, /src="\/scripts\/analytics\.js"/u);
  assert.ok(home.includes(`data-site-host="${siteHost}"`));
  for (const path of ["search", "favorites", "activity"]) {
    assert.doesNotMatch(await builtPage(path), /src="\/scripts\/analytics\.js"/u);
  }
});
