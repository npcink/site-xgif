import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  assertCspMatches,
  assertLiveCommitMatches,
  assertUnpublishedRouteStatus,
  homepageCspFromHeaders,
  requireExpectedSha,
  unpublishedArticleRoutes,
} from "./lib/release-acceptance-contract.mjs";

const baseUrl = new URL(process.env.XGIF_PRODUCTION_URL || "https://www.xgif.cn/");
const requireApex = /^(?:1|true|yes)$/iu.test(process.env.REQUIRE_APEX_REDIRECT || "");
const expectedSha = requireExpectedSha(process.env.EXPECTED_SHA);
const timeout = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);
const expectedCsp = homepageCspFromHeaders(await readFile(new URL("../public/_headers", import.meta.url), "utf8"));

async function request(pathOrUrl, options = {}) {
  const url = new URL(pathOrUrl, baseUrl);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: options.redirect || "follow",
    signal: AbortSignal.timeout(timeout),
    headers: options.headers,
  });
  return { url, response };
}

const build = await request("/build.json");
assert.equal(build.response.status, 200, "build.json 不可用");
const buildInfo = JSON.parse(await build.response.text());
assert.equal(buildInfo.service, "xgif-site");
assertLiveCommitMatches(buildInfo.commit, expectedSha);

const home = await request("/");
assert.equal(home.response.status, 200, "www 首页不可用");
assertCspMatches(home.response.headers.get("content-security-policy"), expectedCsp);

for (const path of unpublishedArticleRoutes()) {
  const result = await request(path, { redirect: "manual" });
  assertUnpublishedRouteStatus(path, result.response.status);
}

let apexReady = false;
try {
  const apex = await request("https://xgif.cn/", { redirect: "manual" });
  const apexTarget = apex.response.headers.get("location") || "";
  apexReady = [301, 308].includes(apex.response.status) && /^https:\/\/www\.xgif\.cn(?:\/|$)/u.test(apexTarget);
} catch (error) {
  if (requireApex) throw new Error(`裸域名不可用：${error.message}`);
}
if (requireApex) assert.ok(apexReady, "裸域名尚未 301/308 到 www.xgif.cn");
else if (!apexReady) console.warn("提醒：裸域名尚未 301/308 到 www.xgif.cn（本地验收不阻断）。");

console.log(`发布验收通过：${baseUrl.origin}，commit=${buildInfo.commit}`);
