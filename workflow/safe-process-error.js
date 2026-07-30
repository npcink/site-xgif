const tokenPattern = /\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gu;
const credentialUrlPattern = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu;

export function safeProcessError(error, {
  fallback = "外部命令执行失败。",
  redactPaths = [],
  maxLength = 2_000,
} = {}) {
  let message = String(
    error?.stderr
    || error?.stdout
    || error?.message
    || error
    || fallback,
  );
  message = message
    .replace(credentialUrlPattern, "$1")
    .replace(tokenPattern, "[redacted]");
  for (const value of redactPaths) {
    const target = String(value || "").trim();
    if (target) message = message.replaceAll(target, "[workspace]");
  }
  const normalized = message.trim() || fallback;
  const limit = Math.max(128, Number(maxLength) || 2_000);
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}…`
    : normalized;
}
