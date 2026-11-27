import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCspMatches,
  assertLiveCommitMatches,
  assertUnpublishedRouteStatus,
  homepageCspFromHeaders,
  requireExpectedSha,
  unpublishedArticleRoutes,
} from "../scripts/lib/release-acceptance-contract.mjs";

const headersText = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
const dailyWorkflow = await readFile(new URL("../../.github/workflows/production-smoke.yml", import.meta.url), "utf8");
const releaseWorkflow = await readFile(new URL("../../.github/workflows/release-acceptance.yml", import.meta.url), "utf8");
const releaseScript = await readFile(new URL("../scripts/release-acceptance.mjs", import.meta.url), "utf8");

test("release acceptance requires a real EXPECTED_SHA and rejects unknown", () => {
  assert.throws(() => requireExpectedSha(""), /必须设置 EXPECTED_SHA/u);
  assert.throws(() => requireExpectedSha("   "), /必须设置 EXPECTED_SHA/u);
  assert.throws(() => requireExpectedSha(undefined), /必须设置 EXPECTED_SHA/u);
  assert.throws(() => requireExpectedSha("unknown"), /不得把 unknown/u);
  assert.throws(() => requireExpectedSha("not-a-sha"), /不是有效提交/u);
  assert.throws(() => requireExpectedSha("a".repeat(41)), /不是有效提交/u);
  assert.equal(requireExpectedSha("81cc0b0"), "81cc0b0");
});

test("release acceptance requires a full live SHA and optionally matches an expected prefix", () => {
  const expected = "81cc0b0f35b4277ad8e04c576defa0c89a00166f";
  assert.throws(() => assertLiveCommitMatches("unknown", expected), /unknown/u);
  assert.throws(() => assertLiveCommitMatches("", expected), /缺少 commit/u);
  assert.throws(() => assertLiveCommitMatches("deadbeef".padEnd(40, "0"), expected), /不一致/u);
  assert.throws(() => assertLiveCommitMatches(expected, ""), /必须设置 EXPECTED_SHA/u);
  assert.doesNotThrow(() => assertLiveCommitMatches(expected, expected));
  assert.doesNotThrow(() => assertLiveCommitMatches(expected, "81cc0b0"));
  assert.throws(() => assertLiveCommitMatches("81cc0b0", expected), /完整 40 位/u);
  assert.throws(() => assertLiveCommitMatches("81cc0b0", "81cc0b0"), /完整 40 位/u);
});

test("release acceptance compares homepage CSP to the current _headers rule", () => {
  const expected = homepageCspFromHeaders(headersText);
  assert.ok(expected);
  assert.match(expected, /https:\/\/static\.cloudflareinsights\.com/u);
  assert.doesNotMatch(expected, /aizhantj/u);
  assert.doesNotThrow(() => assertCspMatches(expected, expected));
  assert.throws(
    () => assertCspMatches("default-src 'self'; script-src 'self' https://example.invalid", expected),
    /Content-Security-Policy 与当前仓库/u,
  );
  assert.throws(() => assertCspMatches("", expected), /未返回 Content-Security-Policy/u);
  const catalogOnly = `/catalog/*\n  X-Robots-Tag: noindex, nofollow\n`;
  assert.throws(() => assertCspMatches("default-src 'self'", homepageCspFromHeaders(catalogOnly)), /未定义首页/u);
});

test("release acceptance requires 404 for tracked unpublished public and preview routes", () => {
  assert.deepEqual(unpublishedArticleRoutes(), [
    "/20251030-tfm4",
    "/preview/articles/20251030-tfm4",
    "/20251230-oucg",
    "/preview/articles/20251230-oucg",
    "/20260824-k43x",
    "/preview/articles/20260824-k43x",
  ]);
  for (const path of unpublishedArticleRoutes()) {
    assert.doesNotThrow(() => assertUnpublishedRouteStatus(path, 404));
    assert.throws(() => assertUnpublishedRouteStatus(path, 200), /应为 404/u);
  }
  assert.match(releaseScript, /unpublishedArticleRoutes\(\)/u);
  assert.match(releaseScript, /redirect: "manual"/u);
  assert.match(releaseScript, /assertUnpublishedRouteStatus\(path, result\.response\.status\)/u);
});

test("package script and workflows keep daily smoke separate from release acceptance", () => {
  assert.match(packageJson, /"test:release-acceptance": "node scripts\/release-acceptance\.mjs"/u);
  assert.match(packageJson, /"test:production": "node scripts\/production-smoke\.mjs"/u);
  assert.match(dailyWorkflow, /schedule:/u);
  assert.match(dailyWorkflow, /REQUIRE_APEX_REDIRECT:\s*"true"/u);
  assert.match(dailyWorkflow, /node site\/scripts\/production-smoke\.mjs/u);
  assert.doesNotMatch(dailyWorkflow, /EXPECTED_SHA/u);
  assert.doesNotMatch(dailyWorkflow, /release-acceptance/u);
  assert.doesNotMatch(releaseWorkflow, /schedule:/u);
  assert.match(releaseWorkflow, /workflow_dispatch:/u);
  assert.match(releaseWorkflow, /expected_sha:/u);
  assert.match(releaseWorkflow, /required:\s*true/u);
  assert.match(releaseWorkflow, /EXPECTED_SHA:\s*\$\{\{\s*inputs\.expected_sha\s*\}\}/u);
  assert.match(releaseWorkflow, /node site\/scripts\/release-acceptance\.mjs/u);
});
