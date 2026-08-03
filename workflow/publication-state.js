function normalizeTimestamp(value) {
  const timestamp = String(value || "").trim();
  return Number.isNaN(Date.parse(timestamp)) ? "" : timestamp;
}

function isEscaped(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingDelimiter(value, start, open, close) {
  let depth = 1;
  for (let cursor = start + 1; cursor < value.length; cursor += 1) {
    if (isEscaped(value, cursor)) continue;
    if (value[cursor] === open) depth += 1;
    if (value[cursor] === close) depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

export function markdownVerificationText(value) {
  const markdown = String(value || "");
  const referenceDefinition = /^\s*\[([^\]\n]+)\]:\s*<?\S+>?(?:\s+.*)?$/gimu;
  const references = new Set(
    [...markdown.matchAll(referenceDefinition)]
      .map((match) => match[1].trim().replace(/\s+/gu, " ").toLowerCase()),
  );
  let visible = "";

  for (let cursor = 0; cursor < markdown.length;) {
    const image = markdown[cursor] === "!" && markdown[cursor + 1] === "[";
    const labelStart = image ? cursor + 1 : cursor;
    if (markdown[labelStart] === "[" && !isEscaped(markdown, labelStart)) {
      const labelEnd = findClosingDelimiter(markdown, labelStart, "[", "]");
      const destinationStart = labelEnd + 1;
      if (labelEnd > labelStart && markdown[destinationStart] === "(") {
        const destinationEnd = findClosingDelimiter(markdown, destinationStart, "(", ")");
        if (destinationEnd > destinationStart) {
          visible += markdown.slice(labelStart + 1, labelEnd);
          cursor = destinationEnd + 1;
          continue;
        }
      }
    }
    visible += markdown[cursor];
    cursor += 1;
  }

  return visible
    .replace(referenceDefinition, "")
    .replace(/\[([^\]\n]+)\]\[([^\]\n]*)\]/gu, (match, label, reference) => {
      const key = String(reference || label).trim().replace(/\s+/gu, " ").toLowerCase();
      return references.has(key) ? label : match;
    });
}

export function contentVerificationAnchors(value, width = 48) {
  const text = String(value || "");
  const anchorWidth = Math.max(1, Number.parseInt(width, 10) || 48);
  if (!text) return [];
  if (text.length <= anchorWidth) return [text];

  const lastStart = text.length - anchorWidth;
  return [...new Set([
    text.slice(0, anchorWidth),
    text.slice(Math.floor(lastStart / 2), Math.floor(lastStart / 2) + anchorWidth),
    text.slice(lastStart),
  ])];
}

export function publicationFromWorkflow(workflow = {}) {
  if (workflow.state === "draft") {
    return {
      state: "draft",
      label: "草稿",
      description: "只保存在本地内容库。",
      verification: "not_applicable",
      checkedAt: "",
      lastVerifiedAt: "",
    };
  }

  if (workflow.state !== "pending_deploy") {
    return {
      state: "local",
      label: "待同步",
      description: "本地站点已经发布，当前版本尚未完整进入远程发布流程。",
      verification: "not_applicable",
      checkedAt: "",
      lastVerifiedAt: "",
    };
  }

  return {
    state: "pending",
    label: "云端待核对",
    description: "远程已包含当前内容；打开详情后再核对线上页面。",
    verification: "not_checked",
    checkedAt: "",
    lastVerifiedAt: "",
  };
}

export function publicationFromDeployment(
  deployment = {},
  {
    previous = null,
    checkedAt = new Date().toISOString(),
  } = {},
) {
  const currentCheck = normalizeTimestamp(checkedAt) || new Date().toISOString();

  if (deployment.state === "live") {
    return {
      state: "online",
      label: "已上线",
      description: "线上页面已经匹配当前内容。",
      verification: "verified",
      checkedAt: currentCheck,
      lastVerifiedAt: currentCheck,
      url: deployment.url || "",
    };
  }

  if (deployment.state === "pending_deploy") {
    return {
      state: "pending",
      label: "待上线",
      description: deployment.description || "线上页面还没有匹配当前版本。",
      verification: "verified",
      checkedAt: currentCheck,
      lastVerifiedAt: currentCheck,
      url: deployment.url || "",
    };
  }

  if (deployment.state === "unknown") {
    const previousState = ["online", "pending"].includes(previous?.state)
      ? previous.state
      : "";
    if (previousState) {
      const previousLabel = previousState === "online" ? "已上线" : "待上线";
      return {
        ...previous,
        label: previousState === "online" ? "上次确认已上线" : "上次确认待上线",
        description: `本次无法连接线上站点，暂时保留上次“${previousLabel}”结果。`,
        verification: "unknown",
        checkedAt: currentCheck,
        lastVerifiedAt: normalizeTimestamp(previous.lastVerifiedAt),
        url: deployment.url || previous.url || "",
      };
    }
  }

  return {
    state: "unknown",
    label: "待验证",
    description: deployment.description || "当前无法连接线上站点，尚无可保留的核对结果。",
    verification: "unknown",
    checkedAt: currentCheck,
    lastVerifiedAt: "",
    url: deployment.url || "",
  };
}

export function contentPublicationCounts(items = []) {
  const counts = {
    all: items.length,
    draft: 0,
    local: 0,
    pending: 0,
    unknown: 0,
    online: 0,
    unverified: 0,
    cloud: 0,
    attention: 0,
    publishing: 0,
  };

  for (const item of items) {
    const state = item.publication?.state || "unknown";
    if (Object.hasOwn(counts, state)) counts[state] += 1;
    if (item.publication?.verification === "unknown") counts.unverified += 1;
    if (["pending", "unknown", "online"].includes(state)) counts.cloud += 1;
    if (["local", "pending"].includes(state) || item.publication?.verification === "unknown") {
      counts.attention += 1;
      counts.publishing += 1;
    }
  }
  return counts;
}
