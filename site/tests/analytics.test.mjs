import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built pages contain no legacy tracking or duplicate manually installed Cloudflare beacon", async () => {
  for (const page of ["index.html", "images/index.html", "search/index.html", "favorites/index.html", "activity/index.html"]) {
    const html = await readFile(new URL(`../dist/${page}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /analytics\.js|aizhantj|_mtj|data-cf-beacon|static\.cloudflareinsights\.com/u);
  }
});

test("CSP permits the existing Cloudflare beacon without legacy origins or dynamic evaluation", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const policy = headers.match(/Content-Security-Policy: (.+)/u)[1];
  const directives = new Map(policy.split(";").map(part => {
    const [name, ...sources] = part.trim().split(/\s+/u);
    return [name, sources];
  }));
  assert.deepEqual(directives.get("script-src"), ["'self'", "https://static.cloudflareinsights.com"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'", "https://cloudflareinsights.com"]);
  assert.deepEqual(directives.get("style-src"), ["'self'"]);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*|aizhantj/u);
});
