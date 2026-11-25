import assert from "node:assert/strict";

export const WITHDRAWN_ARTICLE_IDS = Object.freeze(["20251030-tfm4", "20251230-oucg"]);

const SHA_PATTERN = /^[a-f0-9]{7,64}$/iu;

export function withdrawnRoutes(ids = WITHDRAWN_ARTICLE_IDS) {
  return ids.flatMap((id) => [`/${id}`, `/preview/articles/${id}`]);
}

export function requireExpectedSha(value) {
  const expectedSha = String(value ?? "").trim();
  assert.ok(expectedSha, "发布验收必须设置 EXPECTED_SHA");
  assert.notEqual(expectedSha.toLowerCase(), "unknown", "不得把 unknown 当作已发布 SHA");
  assert.match(expectedSha, SHA_PATTERN, `EXPECTED_SHA 不是有效提交：${expectedSha}`);
  return expectedSha;
}

export function assertLiveCommitMatches(commit, expectedSha) {
  const expected = requireExpectedSha(expectedSha);
  const live = String(commit ?? "").trim();
  assert.ok(live, "线上 /build.json 缺少 commit");
  assert.notEqual(live.toLowerCase(), "unknown", "线上 /build.json commit 为 unknown，不能作为发布验收");
  assert.match(live, SHA_PATTERN, `线上 commit 不是有效提交：${live}`);
  const liveSha = live.toLowerCase();
  const expectedNorm = expected.toLowerCase();
  assert.ok(
    liveSha.startsWith(expectedNorm) || expectedNorm.startsWith(liveSha),
    `线上提交 ${live} 与预期 ${expected} 不一致`,
  );
}

export function parseCloudflareHeaders(text) {
  const blocks = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/u)) {
    if (rawLine.trim() === "" || /^\s*#/u.test(rawLine)) {
      if (rawLine.trim() === "") current = null;
      continue;
    }
    if (!/^\s/u.test(rawLine)) {
      current = { pattern: rawLine.trim(), headers: [] };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const line = rawLine.trim();
    const index = line.indexOf(":");
    if (index === -1) continue;
    current.headers.push({
      name: line.slice(0, index).trim(),
      value: line.slice(index + 1).trim(),
    });
  }
  return blocks;
}

function patternMatches(pattern, path) {
  if (pattern === path) return true;
  if (!pattern.endsWith("*")) return false;
  const prefix = pattern.slice(0, -1);
  return path === prefix || path.startsWith(prefix) || (prefix.endsWith("/") && path === prefix.slice(0, -1));
}

export function headerForPath(blocks, path, headerName) {
  const target = String(headerName).toLowerCase();
  let value;
  let specificity = -1;
  for (const block of blocks) {
    if (!patternMatches(block.pattern, path)) continue;
    const header = [...block.headers].reverse().find((item) => item.name.toLowerCase() === target);
    if (!header) continue;
    const spec = block.pattern.replace(/\*$/u, "").length;
    if (spec >= specificity) {
      specificity = spec;
      value = header.value;
    }
  }
  return value;
}

export function homepageCspFromHeaders(text) {
  return headerForPath(parseCloudflareHeaders(text), "/", "Content-Security-Policy");
}

export function assertCspMatches(liveCsp, expectedCsp) {
  const live = String(liveCsp ?? "").trim();
  const expected = String(expectedCsp ?? "").trim();
  assert.ok(expected, "当前 site/public/_headers 未定义首页 Content-Security-Policy");
  assert.ok(live, "首页未返回 Content-Security-Policy");
  assert.equal(live, expected, "首页 Content-Security-Policy 与当前仓库 site/public/_headers 不一致");
}

export function assertWithdrawnRouteStatus(path, status) {
  assert.equal(status, 404, `已撤回路由 ${path} 应为 404，实际为 ${status}`);
}
