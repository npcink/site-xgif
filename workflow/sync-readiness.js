function auditIssues(audit) {
  return [
    ...(Array.isArray(audit?.blockers) ? audit.blockers : []),
    ...(Array.isArray(audit?.warnings) ? audit.warnings : []),
  ].map((issue) => String(issue || "").trim()).filter(Boolean);
}

export function partitionSyncCandidates(candidates = [], auditItems = []) {
  const auditByFile = new Map(
    auditItems.map((audit) => [String(audit?.file || ""), audit]),
  );
  const ready = [];
  const needsAttention = [];

  for (const candidate of candidates) {
    const audit = auditByFile.get(String(candidate?.file || ""));
    if (audit?.status === "ready") {
      ready.push(candidate);
      continue;
    }

    const issues = auditIssues(audit);
    needsAttention.push({
      ...candidate,
      auditStatus: audit?.status || "missing",
      blockers: Array.isArray(audit?.blockers) ? audit.blockers : [],
      warnings: Array.isArray(audit?.warnings) ? audit.warnings : [],
      reason: issues.join("；") || "无法取得有效的上线体检结果。",
    });
  }

  return { ready, needsAttention };
}
