import assert from "node:assert/strict";
import test from "node:test";
import {
  libraryItemPresentation,
  libraryTaskPresentation,
} from "../public/library-presentation.js";

test("content presentation exposes one reader-facing stage and next action", () => {
  assert.deepEqual(
    libraryItemPresentation({
      publication: { state: "local" },
      workflow: { state: "pending_commit" },
    }),
    {
      label: "待同步",
      nextTitle: "同步当前内容",
      nextDescription: "内容已进入本地站点，下一步是创建内容记录并推送到 GitHub。",
      action: "sync",
    },
  );
  assert.equal(
    libraryItemPresentation({
      publication: { state: "local" },
      workflow: { state: "pending_deploy" },
    }).label,
    "待上线",
  );
  assert.equal(
    libraryItemPresentation({ publication: { state: "pending" } }).label,
    "待上线",
  );
  assert.equal(
    libraryItemPresentation({ publication: { state: "unknown" } }).label,
    "待验证",
  );
  assert.equal(
    libraryItemPresentation({ publication: { state: "online" } }).action,
    "open",
  );
});

test("task presentation prioritizes unfinished publication work over drafts", () => {
  const pending = libraryTaskPresentation({ all: 8, draft: 3, local: 2, online: 3 });
  assert.equal(pending.title, "2 项内容待处理");
  assert.equal(pending.action, "attention");

  const drafts = libraryTaskPresentation({ all: 5, draft: 2, local: 0, online: 3 });
  assert.equal(drafts.title, "2 项草稿等待整理");
  assert.equal(drafts.action, "draft");

  const unknown = libraryTaskPresentation({
    all: 3,
    draft: 0,
    local: 0,
    pending: 0,
    unverified: 2,
    online: 1,
  });
  assert.equal(unknown.title, "2 项内容待处理");
  assert.equal(unknown.action, "attention");

  const ready = libraryTaskPresentation({ all: 3, draft: 0, local: 0, online: 3 });
  assert.equal(ready.title, "3 项内容均已上线");
  assert.equal(ready.action, "none");
});
