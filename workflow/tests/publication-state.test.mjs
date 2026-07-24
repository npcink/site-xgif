import assert from "node:assert/strict";
import test from "node:test";
import {
  contentPublicationCounts,
  publicationFromDeployment,
} from "../publication-state.js";

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
  });
});
