const sourceLabels = [
  { host: "jandan.net", name: "煎蛋" },
  { host: "zhihu.com", name: "知乎" },
  { host: "hupu.com", name: "虎扑" },
  { host: "ngabbs.com", name: "NGA 玩家社区" },
  { host: "sspai.com", name: "少数派" },
  { host: "weixin.qq.com", name: "微信公众号" },
  { host: "36kr.com", name: "36氪" },
  { host: "bilibili.com", name: "哔哩哔哩" },
  { host: "x.com", name: "X" },
  { host: "twitter.com", name: "X" },
];

const sourcePrefix = /(?:来源链接|文章链接|原文链接|原链接|来源|原文|出处|链接)\s*[:：]\s*/iu;
const sourceOnlyPrefix = /^(?:来源链接|文章链接|原文链接|原链接|来源|原文|出处|链接)\s*[:：]\s*/iu;
const rawUrlPattern = /https?:\/\/[^\s<>"'`]+/giu;

function trimUrlPunctuation(value) {
  let result = String(value || "").trim();
  result = result.replace(/[，。；！？、…」』】》]+$/u, "");
  while (/[)\]]$/.test(result)) {
    const open = result.endsWith(")") ? "(" : "[";
    const close = result.at(-1);
    if ((result.match(new RegExp(`\\${open}`, "g")) || []).length >= (result.match(new RegExp(`\\${close}`, "g")) || []).length) break;
    result = result.slice(0, -1);
  }
  return result;
}

export function normalizeArticleSourceUrl(value) {
  try {
    const url = new URL(trimUrlPunctuation(value));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|spm|fbclid|gclid|yclid)/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function inferArticleSourceName(value) {
  const normalized = normalizeArticleSourceUrl(value);
  if (!normalized) return "来源待确认";
  const hostname = new URL(normalized).hostname.toLowerCase().replace(/^www\./u, "");
  const known = sourceLabels.find(({ host }) => hostname === host || hostname.endsWith(`.${host}`));
  return known?.name || "第三方";
}

function markdownOnlyUrl(line) {
  return String(line || "").trim().match(/^\[[^\]]+\]\((https?:\/\/[^\s)]+)\)$/iu)?.[1] || "";
}

function lineIsSourceOnly(line) {
  const value = String(line || "").trim();
  const withoutPrefix = value.replace(sourceOnlyPrefix, "").trim();
  const markdownUrl = markdownOnlyUrl(withoutPrefix);
  if (markdownUrl) return Boolean(normalizeArticleSourceUrl(markdownUrl));
  const matches = [...withoutPrefix.matchAll(rawUrlPattern)];
  return matches.length === 1 && normalizeArticleSourceUrl(matches[0][0]) === normalizeArticleSourceUrl(withoutPrefix);
}

function sourceCandidates(lines) {
  const candidates = [];
  lines.forEach((line, lineIndex) => {
    const value = String(line || "").trim();
    const explicit = sourcePrefix.test(value);
    sourcePrefix.lastIndex = 0;
    const markdownUrl = markdownOnlyUrl(value.replace(sourceOnlyPrefix, "").trim());
    const rawUrls = markdownUrl ? [markdownUrl] : [...value.matchAll(rawUrlPattern)].map((match) => match[0]);
    for (const rawUrl of rawUrls) {
      const url = normalizeArticleSourceUrl(rawUrl);
      if (!url) continue;
      candidates.push({
        url,
        lineIndex,
        explicit,
        sourceOnly: lineIsSourceOnly(value),
      });
    }
  });
  return candidates;
}

export function removeStructuredSourceLines(lines, sourceUrl) {
  const normalizedSourceUrl = normalizeArticleSourceUrl(sourceUrl);
  if (!normalizedSourceUrl) return { bodyLines: [...lines], removed: 0 };
  const removableLines = new Set(
    sourceCandidates(lines)
      .filter((candidate) => candidate.url === normalizedSourceUrl && candidate.sourceOnly)
      .map(({ lineIndex }) => lineIndex),
  );
  return {
    bodyLines: lines.filter((_line, index) => !removableLines.has(index)),
    removed: removableLines.size,
  };
}

export function extractArticleSource(lines) {
  const bodyLines = [...lines];
  const candidates = sourceCandidates(bodyLines);
  const uniqueUrls = [...new Set(candidates.map(({ url }) => url))];
  let sourceUrl = "";

  if (uniqueUrls.length === 1) {
    [sourceUrl] = uniqueUrls;
  } else if (uniqueUrls.length > 1) {
    const explicitUrls = [...new Set(candidates.filter(({ explicit }) => explicit).map(({ url }) => url))];
    if (explicitUrls.length === 1) [sourceUrl] = explicitUrls;
  }

  if (!sourceUrl) {
    const reason = uniqueUrls.length
      ? `检测到 ${uniqueUrls.length} 个可能的来源链接，无法唯一确定，请人工确认。`
      : "未检测到来源链接，请确认来源或明确标记为原创。";
    return {
      bodyLines,
      sourceUrl: "",
      source: "来源待确认",
      sourceKind: "unknown",
      needsSourceReview: true,
      sourceReviewReason: reason,
      candidates: uniqueUrls,
    };
  }

  const cleaned = removeStructuredSourceLines(bodyLines, sourceUrl);
  return {
    bodyLines: cleaned.bodyLines,
    sourceUrl,
    source: inferArticleSourceName(sourceUrl),
    sourceKind: "publication",
    needsSourceReview: false,
    sourceReviewReason: "",
    candidates: uniqueUrls,
  };
}
