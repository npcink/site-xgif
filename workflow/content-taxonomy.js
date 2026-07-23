export const CANONICAL_TAGS = Object.freeze([
  "AI",
  "互联网",
  "科技",
  "社会观察",
  "职场",
  "打工",
  "人际",
  "情感",
  "恋爱",
  "婚姻",
  "亲情",
  "成长",
  "青春",
  "校园",
  "回忆",
  "生活",
  "旅行",
  "美食",
  "医疗",
  "军事",
  "哲学",
  "科普",
  "幽默",
  "搞笑",
  "反转",
  "吐槽",
  "无语",
  "灵异",
  "群聊",
  "可爱",
  "反应图",
  "整活",
]);

const directAliases = new Map([
  ["ai", "AI"],
  ["人工智能", "AI"],
  ["网络", "互联网"],
  ["观察", "社会观察"],
  ["社会", "社会观察"],
  ["工作", "职场"],
  ["上班", "职场"],
  ["情绪", "情感"],
  ["爱情", "恋爱"],
  ["家庭", "亲情"],
  ["日常", "生活"],
  ["随笔", "生活"],
  ["故事", "生活"],
  ["故事汇", "生活"],
  ["段子", "幽默"],
  ["笑话", "搞笑"],
  ["搞笑图", "搞笑"],
  ["表情包", "反应图"],
  ["像素风", "反应图"],
  ["反差", "反转"],
  ["脑洞", "整活"],
]);

const rules = [
  [/ai|人工智能|模型|算法/iu, "AI"],
  [/互联网|网络|平台|网站|社交媒体/iu, "互联网"],
  [/科技|数码|电脑|服务器|硬盘|软件|硬件/iu, "科技"],
  [/社会|观察|时代|新闻|现象/iu, "社会观察"],
  [/职场|工作|上班|老板|同事|办公室/iu, "职场"],
  [/打工|工资|加班|下班/iu, "打工"],
  [/人际|朋友|社交|相处/iu, "人际"],
  [/情感|情绪|感情/iu, "情感"],
  [/恋爱|爱情|情侣|对象/iu, "恋爱"],
  [/婚姻|夫妻|结婚|离婚/iu, "婚姻"],
  [/亲情|家庭|父亲|母亲|父母|孩子/iu, "亲情"],
  [/成长|人生|改变/iu, "成长"],
  [/青春|少年|年轻/iu, "青春"],
  [/校园|学校|学生|老师|同学/iu, "校园"],
  [/回忆|往事|童年|怀旧/iu, "回忆"],
  [/生活|日常|随笔|故事/iu, "生活"],
  [/旅行|旅游|出发|风景/iu, "旅行"],
  [/美食|吃饭|食物|餐厅|猪油/iu, "美食"],
  [/医疗|医生|医院|手术|健康|疾病/iu, "医疗"],
  [/军事|军训|军队|部队/iu, "军事"],
  [/哲学|意义|思考|认知/iu, "哲学"],
  [/科普|知识|解释/iu, "科普"],
  [/幽默|段子|笑话/iu, "幽默"],
  [/搞笑|好笑|笑死/iu, "搞笑"],
  [/反转|意外|反差/iu, "反转"],
  [/吐槽|抱怨|压力/iu, "吐槽"],
  [/无语|沉默|离谱|迷惑/iu, "无语"],
  [/灵异|怪谈|恐怖|诡异/iu, "灵异"],
  [/群聊|微信|qq|聊天/iu, "群聊"],
  [/可爱|萌/iu, "可爱"],
  [/表情|反应|像素/iu, "反应图"],
  [/整活|脑洞|抽象/iu, "整活"],
];

function valuesOf(input) {
  if (Array.isArray(input)) return input;
  return String(input || "").split(/[,，、\n]/u);
}

export function normalizeContentTags(input, { type = "article", max = 3 } = {}) {
  const normalized = [];
  const add = (tag) => {
    if (tag && !normalized.includes(tag) && normalized.length < max) normalized.push(tag);
  };

  for (const value of valuesOf(input)) {
    const raw = String(value || "").trim().replace(/^#+/u, "");
    if (!raw) continue;
    if (CANONICAL_TAGS.includes(raw)) {
      add(raw);
      continue;
    }
    const direct = directAliases.get(raw.toLowerCase());
    if (direct) {
      add(direct);
      continue;
    }
    const match = rules.find(([pattern]) => pattern.test(raw));
    if (match) add(match[1]);
  }

  if (!normalized.length) add(type === "image" ? "反应图" : "生活");
  return normalized;
}

export function canonicalTagsPrompt() {
  return CANONICAL_TAGS.join("、");
}
