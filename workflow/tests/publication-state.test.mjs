import assert from "node:assert/strict";
import test from "node:test";
import {
  contentVerificationAnchors,
  contentPublicationCounts,
  markdownVerificationText,
  publicationFromDeployment,
  publicationFromWorkflow,
} from "../publication-state.js";

test("content verification anchors cover the start, middle, and end of long content", () => {
  const content = `${"a".repeat(60)}${"b".repeat(60)}${"c".repeat(60)}`;
  const anchors = contentVerificationAnchors(content, 20);

  assert.deepEqual(anchors, [
    "a".repeat(20),
    "b".repeat(20),
    "c".repeat(20),
  ]);
});

test("content verification anchors keep short content as one exact anchor", () => {
  assert.deepEqual(contentVerificationAnchors("short content", 48), ["short content"]);
});

test("live verification compares rendered Markdown link labels instead of hidden destinations", () => {
  const markdown = [
    "正文开头。",
    "",
    "[相关前文](https://example.com/topic/1)",
    "",
    "![插图说明](https://example.com/assets/image_(large).png)",
    "",
    "[参考链接][source]",
    "",
    "[不是链接][missing]",
    "",
    "正文结尾。",
    "",
    "[本段原帖](https://example.com/topic/2)",
    "",
    "[source]: https://example.com/reference",
  ].join("\n");

  const visibleText = markdownVerificationText(markdown);

  assert.match(visibleText, /相关前文/u);
  assert.match(visibleText, /插图说明/u);
  assert.match(visibleText, /参考链接/u);
  assert.match(visibleText, /\[不是链接\]\[missing\]/u);
  assert.match(visibleText, /本段原帖/u);
  assert.doesNotMatch(visibleText, /https:\/\/example\.com/u);
});

test("content lists derive publication progress without waiting for live verification", () => {
  assert.deepEqual(publicationFromWorkflow({ state: "draft" }), {
    state: "draft",
    label: "草稿",
    description: "只保存在本地内容库。",
    verification: "not_applicable",
    checkedAt: "",
    lastVerifiedAt: "",
  });
  assert.equal(publicationFromWorkflow({ state: "pending_commit" }).state, "local");
  assert.deepEqual(publicationFromWorkflow({ state: "pending_deploy" }), {
    state: "pending",
    label: "云端待核对",
    description: "远程已包含当前内容；打开详情后再核对线上页面。",
    verification: "not_checked",
    checkedAt: "",
    lastVerifiedAt: "",
  });
});

test("deployment verification maps live and pending states without ambiguity", () => {
  const checkedAt = "2026-07-24T10:00:00.000Z";
  assert.deepEqual(
    publicationFromDeployment(
      { state: "live", url: "https://www.xgif.cn/articles/example/" },
      { checkedAt },
    ),
    {
      state: "online",
      label: "已上线",
      description: "线上页面已经匹配当前内容。",
      verification: "verified",
      checkedAt,
      lastVerifiedAt: checkedAt,
      url: "https://www.xgif.cn/articles/example/",
    },
  );
  assert.equal(
    publicationFromDeployment({ state: "pending_deploy" }, { checkedAt }).state,
    "pending",
  );
});

test("a failed verification preserves the last known public state", () => {
  const previous = {
    state: "online",
    label: "已上线",
    description: "线上页面已经匹配当前内容。",
    verification: "verified",
    checkedAt: "2026-07-24T09:00:00.000Z",
    lastVerifiedAt: "2026-07-24T09:00:00.000Z",
    url: "https://www.xgif.cn/articles/example/",
  };
  const result = publicationFromDeployment(
    { state: "unknown", description: "网络不可用" },
    { previous, checkedAt: "2026-07-24T10:00:00.000Z" },
  );
  assert.equal(result.state, "online");
  assert.equal(result.label, "上次确认已上线");
  assert.equal(result.verification, "unknown");
  assert.equal(result.lastVerifiedAt, previous.lastVerifiedAt);
});

test("publication counts separate workflow progress from verification confidence", () => {
  const items = [
    { publication: { state: "draft", verification: "not_applicable" } },
    { publication: { state: "local", verification: "not_applicable" } },
    { publication: { state: "pending", verification: "verified" } },
    { publication: { state: "unknown", verification: "unknown" } },
    { publication: { state: "online", verification: "unknown" } },
  ];
  assert.deepEqual(contentPublicationCounts(items), {
    all: 5,
    draft: 1,
    local: 1,
    pending: 1,
    unknown: 1,
    online: 1,
    unverified: 2,
    cloud: 3,
    attention: 4,
    publishing: 4,
  });
});
