import assert from "node:assert/strict";
import process from "node:process";

const baseUrl = new URL(process.env.XGIF_PRODUCTION_URL || "https://www.xgif.cn/");
const requireApex = /^(?:1|true|yes)$/iu.test(process.env.REQUIRE_APEX_REDIRECT || "");
const expectedSha = String(process.env.EXPECTED_SHA || "").trim();
const timeout = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

async function request(pathOrUrl, options = {}) {
  const url = new URL(pathOrUrl, baseUrl);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: options.redirect || "follow",
    signal: AbortSignal.timeout(timeout),
    headers: options.headers,
  });
  return { url, response, text: await response.text() };
}

const home = await request("/");
assert.equal(home.response.status, 200, "www 首页不可用");
const rights = await request("/rights/");
assert.equal(rights.response.status, 200, "版权与更正页面不可用");
assert.match(rights.text, /1355471563@qq\.com/u, "版权与更正页面缺少反馈邮箱");

const sitemap = await request("/sitemap.xml");
assert.equal(sitemap.response.status, 200, "sitemap 不可用");
const articleUrl = sitemap.text.match(/<loc>(https:\/\/www\.xgif\.cn\/articles\/[^<]+)<\/loc>/u)?.[1];
assert.ok(articleUrl, "sitemap 中没有公开文章");

const article = await request(articleUrl);
assert.equal(article.response.status, 200, "公开文章不可用");
assert.match(article.text, /查看原始来源|来源/u, "公开文章缺少来源信息");
assert.ok(article.text.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, "").length > 400, "公开文章正文疑似为空");

const build = await request("/build.json");
assert.equal(build.response.status, 200, "build.json 不可用");
const buildInfo = JSON.parse(build.text);
assert.equal(buildInfo.service, "xgif-site");
assert.match(buildInfo.commit, /^(?:[a-f0-9]{7,64}|unknown)$/u);
if (expectedSha) {
  assert.ok(buildInfo.commit.startsWith(expectedSha) || expectedSha.startsWith(buildInfo.commit), `线上提交 ${buildInfo.commit} 与预期 ${expectedSha} 不一致`);
}

const r2Url = home.text.match(/https:\/\/img\.xgif\.cn\/[^"' )<]+/u)?.[0];
if (r2Url) {
  const sameSite = await request(r2Url, { headers: { referer: baseUrl.href } });
  assert.equal(sameSite.response.status, 200, "站内 R2 图片不可用");
  const hotlink = await request(r2Url, { headers: { referer: "https://example.org/" }, redirect: "manual" });
  assert.equal(hotlink.response.status, 403, "R2 防盗链未拒绝第三方 Referer");
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
else if (!apexReady) console.warn("提醒：裸域名尚未 301/308 到 www.xgif.cn（本地巡检不阻断）。");

console.log(`生产巡检通过：${baseUrl.origin}，commit=${buildInfo.commit}，article=${articleUrl}`);
