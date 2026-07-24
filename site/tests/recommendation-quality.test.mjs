import assert from "node:assert/strict";
import test from "node:test";
import {
  rankRecommendationCandidates,
  selectContentRecommendations,
} from "../src/lib/recommendations.mjs";

const entry = ({
  id,
  title,
  summary = "",
  tags = [],
  mood = [],
  scenes = [],
  category = "",
  pubDate = "2026-01-01",
  draft = false,
  public: isPublic = true,
}) => ({
  id,
  data: {
    contentId: id,
    title,
    summary,
    tags,
    mood,
    scenes,
    category,
    pubDate: new Date(pubDate),
    draft,
    public: isPublic,
  },
});

test("rare shared tags outrank broad shared tags", () => {
  const source = entry({
    id: "source",
    title: "校园里的哲学困惑",
    tags: ["生活", "哲学"],
  });
  const broad = entry({ id: "broad", title: "普通生活记录", tags: ["生活"] });
  const rare = entry({ id: "rare", title: "阅读哲学后的变化", tags: ["哲学"] });
  const background = [
    entry({ id: "life-1", title: "生活一", tags: ["生活"] }),
    entry({ id: "life-2", title: "生活二", tags: ["生活"] }),
    entry({ id: "life-3", title: "生活三", tags: ["生活"] }),
  ];

  const ranked = rankRecommendationCandidates(source, [broad, rare, ...background]);
  assert.equal(ranked[0].id, "rare");
  assert.ok(ranked[0].tag > ranked.find((item) => item.id === "broad").tag);
});

test("semantic title and summary overlap can relate content without a shared tag", () => {
  const source = entry({
    id: "source",
    title: "军训树荫下的游泳课记忆",
    summary: "多年后仍记得那个炎热午后。",
    tags: ["校园"],
  });
  const semantic = entry({
    id: "semantic",
    title: "炎热午后的树荫",
    summary: "一段多年后仍未忘记的青春记忆。",
    tags: ["回忆"],
  });
  const unrelated = entry({
    id: "unrelated",
    title: "服务器硬盘与备份",
    summary: "一次运维事故复盘。",
    tags: ["科技"],
  });

  const ranked = rankRecommendationCandidates(source, [unrelated, semantic]);
  assert.equal(ranked[0].id, "semantic");
  assert.ok(ranked[0].lexical > ranked[1].lexical);
});

test("image mood and scene text participates in cross-content ranking", () => {
  const image = entry({
    id: "image",
    title: "无语小熊",
    tags: ["反应图"],
    mood: ["无语", "吐槽"],
    scenes: ["群聊", "回应质疑"],
  });
  const related = entry({
    id: "related",
    title: "群聊里令人无语的回应",
    summary: "面对质疑时的一次吐槽。",
    tags: ["生活"],
  });
  const unrelated = entry({
    id: "unrelated",
    title: "菜市场里的童年味道",
    summary: "回忆爷爷奶奶做饭。",
    tags: ["回忆"],
  });

  const selected = selectContentRecommendations(image, [unrelated, related], {
    limit: 1,
    relatedSlots: 1,
    allowSurprise: false,
  });
  assert.equal(selected[0].data.contentId, "related");
});

test("recommendations exclude drafts, private entries, self, and duplicates", () => {
  const source = entry({ id: "source", title: "测试", tags: ["生活"] });
  const published = entry({ id: "published", title: "公开", tags: ["生活"] });
  const draft = entry({ id: "draft", title: "草稿", tags: ["生活"], draft: true });
  const privateEntry = entry({
    id: "private",
    title: "不公开",
    tags: ["生活"],
    public: false,
  });

  const selected = selectContentRecommendations(
    source,
    [source, draft, privateEntry, published, published],
    { limit: 3 },
  );
  assert.deepEqual(selected.map((item) => item.data.contentId), ["published"]);
});

test("the surprise slot is deterministic while the first two remain relevance-led", () => {
  const source = entry({ id: "source", title: "成长与校园", tags: ["成长"] });
  const candidates = [
    entry({ id: "related-1", title: "成长一", tags: ["成长"] }),
    entry({ id: "related-2", title: "成长二", tags: ["成长"] }),
    entry({ id: "surprise-1", title: "美食", tags: ["美食"] }),
    entry({ id: "surprise-2", title: "科技", tags: ["科技"] }),
  ];

  const first = selectContentRecommendations(source, candidates, { limit: 3 });
  const second = selectContentRecommendations(source, candidates, { limit: 3 });
  assert.deepEqual(
    first.map((item) => item.data.contentId),
    second.map((item) => item.data.contentId),
  );
  assert.ok(first.slice(0, 2).every((item) => item.data.tags.includes("成长")));
});
