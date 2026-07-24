const STATUS_PRESENTATION = {
  draft: {
    label: "草稿",
    nextTitle: "继续整理",
    nextDescription: "内容只保存在本地内容库，完成复核后再发布。",
    action: "edit",
  },
  pending_commit: {
    label: "待同步",
    nextTitle: "同步当前内容",
    nextDescription: "内容已进入本地站点，下一步是创建内容记录并推送到 GitHub。",
    action: "sync",
  },
  pending_push: {
    label: "同步未完成",
    nextTitle: "重新同步",
    nextDescription: "本地已有内容记录，但远程分支尚未包含当前版本。",
    action: "retry",
  },
  pending_deploy: {
    label: "待上线",
    nextTitle: "等待合并与部署",
    nextDescription: "远程分支已包含当前内容；合并 PR 并完成 Cloudflare 部署后会自动核对线上版本。",
    action: "details",
  },
  unknown: {
    label: "待验证",
    nextTitle: "稍后重新核对",
    nextDescription: "当前无法连接线上站点。内容状态没有被降级，可在详情中查看上次核对结果。",
    action: "details",
  },
  online: {
    label: "已上线",
    nextTitle: "线上版本已核对",
    nextDescription: "线上页面已经匹配当前内容。",
    action: "open",
  },
};

export function libraryItemPresentation(item = {}) {
  if (item.publication?.state === "online") return STATUS_PRESENTATION.online;
  if (item.publication?.state === "draft") return STATUS_PRESENTATION.draft;
  if (item.publication?.state === "pending") return STATUS_PRESENTATION.pending_deploy;
  if (item.publication?.state === "unknown") return STATUS_PRESENTATION.unknown;
  return STATUS_PRESENTATION[item.workflow?.state] || STATUS_PRESENTATION.pending_commit;
}

export function libraryTaskPresentation(counts = {}) {
  const total = Number(counts.all || 0);
  const drafts = Number(counts.draft || 0);
  const local = Number(counts.local || 0);
  const pending = Number(counts.pending || 0);
  const unknown = Number(counts.unverified || counts.unknown || 0);
  const online = Number(counts.online || 0);
  const unfinished = local + pending;

  if (unfinished > 0) {
    return {
      state: "attention",
      kicker: "下一步",
      title: `${unfinished} 项发布流程待完成`,
      description: `${local} 项待同步，${pending} 项等待合并或部署。详情会分别显示 Git 与线上状态。`,
      actionLabel: "查看待完成内容",
      action: "pending",
    };
  }
  if (unknown > 0) {
    return {
      state: "checking",
      kicker: "待核对",
      title: `${unknown} 项线上状态待验证`,
      description: "网络核对失败不会把已上线内容降级。稍后刷新系统状态即可重试。",
      actionLabel: "查看待验证内容",
      action: "unknown",
    };
  }
  if (drafts > 0) {
    return {
      state: "draft",
      kicker: "待复核",
      title: `${drafts} 项草稿等待整理`,
      description: "草稿不会进入公开站点，完成内容复核后再发布。",
      actionLabel: "查看草稿",
      action: "draft",
    };
  }
  return {
    state: "ready",
    kicker: "状态正常",
    title: total ? `${online} 项内容均已上线` : "内容库还是空的",
    description: total ? "当前没有待处理的发布任务。" : "新建文章、图片或从备份导入内容。",
    actionLabel: "",
    action: "none",
  };
}
