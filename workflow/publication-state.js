function normalizeTimestamp(value) {
  const timestamp = String(value || "").trim();
  return Number.isNaN(Date.parse(timestamp)) ? "" : timestamp;
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
  };

  for (const item of items) {
    const state = item.publication?.state || "unknown";
    if (Object.hasOwn(counts, state)) counts[state] += 1;
    if (item.publication?.verification === "unknown") counts.unverified += 1;
    if (["pending", "unknown", "online"].includes(state)) counts.cloud += 1;
    if (["local", "pending"].includes(state) || item.publication?.verification === "unknown") {
      counts.attention += 1;
    }
  }
  return counts;
}
