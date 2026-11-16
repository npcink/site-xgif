import assert from "node:assert/strict";
import test from "node:test";
import {
  rankRecommendationCandidates,
  selectContentRecommendations,
  manifestRecommendationOptions,
} from "../src/lib/recommendations.mjs";

const entry = ({
  id,
  title,
  body = "",
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
  body,
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

test("original body overlap relates articles while all generated metadata is ignored", () => {
  const source = entry({ id: "source", title: "服务器", body: "军训树荫下的游泳课记忆，那个炎热午后多年后仍未忘记。", tags: ["科技"] });
  const related = entry({ id: "related", title: "无关标题", body: "多年后仍未忘记的青春记忆，炎热午后的树荫和游泳课。", tags: ["美食"] });
  const unrelated = entry({ id: "unrelated", title: "服务器", summary: "军训树荫下的游泳课记忆", body: "硬盘主机断电后的数据备份恢复方法。", tags: ["科技"] });
  const ranked = rankRecommendationCandidates(source, [unrelated, related]);
  assert.equal(ranked[0].id, "related"); assert.ok(ranked[0].lexical > ranked[1].lexical);
  for (const item of [source, related, unrelated]) Object.assign(item.data, { title: "被新模型完全重写", summary: "新摘要", description: "新描述", tags: ["新标签"], category: "新分类", mood: ["悲伤"], scenes: ["群聊"], altText: "新图注" });
  assert.deepEqual(rankRecommendationCandidates(source, [unrelated, related]).map(({ id, score }) => ({ id, score })), ranked.map(({ id, score }) => ({ id, score })));
});

test("image descriptions, moods, tags, scenes and body captions supply no lexical evidence", () => {
  const image = entry({ id: "image", title: "无语小熊", body: "群聊里的回应", mood: ["无语"], scenes: ["群聊"] });
  image.collection = "images";
  const related = entry({ id: "related", title: "无语小熊", body: "无语小熊群聊里的回应" });
  assert.equal(rankRecommendationCandidates(image, [related])[0].lexical, 0);
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
  const held = entry({ id: "held", title: "暂缓公开" }); held.data.publicationHold = true;

  const selected = selectContentRecommendations(
    source,
    [source, draft, privateEntry, held, published, published],
    { limit: 3 },
  );
  assert.deepEqual(selected.map((item) => item.data.contentId), ["published"]);
});

test("the surprise slot is deterministic while the first two remain relevance-led", () => {
  const source = entry({ id: "source", title: "成长与校园", body: "成长校园学习", tags: ["成长"] });
  const candidates = [
    entry({ id: "related-1", title: "成长一", body: "成长校园学习一", tags: ["成长"] }),
    entry({ id: "related-2", title: "成长二", body: "成长校园学习二", tags: ["成长"] }),
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

test("a thresholded image manifest can intentionally show fewer or zero results", () => {
  const source = entry({ id: "source", title: "草莓" });
  const related = entry({ id: "related", title: "水果" });
  const weak = entry({ id: "weak", title: "服务器" });
  const manifest = {
    mode: "hybrid", selection: { imageMinSimilarity: 0.35 },
    recommendations: { source: { images: ["related", "deleted"] } },
  };
  const options = manifestRecommendationOptions(manifest, "source", "images");
  assert.deepEqual(selectContentRecommendations(source, [related, weak], { limit: 3, ...options }).map(x => x.data.contentId), ["related"]);
  manifest.recommendations.source.images = [];
  assert.deepEqual(selectContentRecommendations(source, [related, weak], {
    ...manifestRecommendationOptions(manifest, "source", "images"),
  }), []);
  assert.equal(manifestRecommendationOptions(manifest, "new-content", "images").preferredOnly, false);
  assert.equal(manifestRecommendationOptions(manifest, "source", "articles").preferredOnly, false);
  manifest.recommendations.source.sourceType = "image";
  manifest.recommendations.source.articles = [];
  assert.equal(manifestRecommendationOptions(manifest, "source", "articles").preferredOnly, true);
  assert.equal(manifestRecommendationOptions({ recommendations: manifest.recommendations }, "source", "images").preferredOnly, false);
});

test("source-grounded manifests are authoritative for article lists too, including intentional empties", () => {
  const source = entry({ id: "source", body: "同一正文", title: "标题" });
  const candidates = [entry({ id: "one", body: "同一正文", title: "标题" })];
  const manifest = { mode: "rules", selection: { evidenceVersion: "original-sources-v2" }, recommendations: { source: { articles: [], images: [] } } };
  assert.deepEqual(selectContentRecommendations(source, candidates, manifestRecommendationOptions(manifest, "source", "articles")), []);
});

test("all fallback paths preserve groups for missing, legacy, partial and deleted recommendation lists", () => {
  const make = (id, group, extra = {}) => ({ collection: "articles", id, body: "相同的原文主题", data: { contentId: id, recommendationGroup: group, pubDate: new Date("2026-11-13"), ...extra } });
  const adult = make("adult", "adult-humor"); const general = make("general", "general");
  const same = make("same", "adult-humor");
  for (const manifest of [null, { recommendations: {} }, { recommendations: { adult: {} } },
    { recommendations: { adult: { articles: ["general", "deleted"] } } }]) {
    for (const options of [{}, { relatedSlots: 0 }, { allowSurprise: false }, { relatedSlots: 0, allowSurprise: false }]) {
      const select = (candidates) => selectContentRecommendations(adult, candidates, { ...manifestRecommendationOptions(manifest, "adult", "articles"), ...options });
      assert.deepEqual(select([general]), []);
      assert.deepEqual(select([general, same]).map(e => e.id), ["same"]);
      assert.deepEqual(select([general, make("hidden", "adult-humor", { publicationHold: true })]), []);
    }
  }
  assert.deepEqual(selectContentRecommendations(general, [adult]), []);
});
