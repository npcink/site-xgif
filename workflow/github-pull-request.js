import { execFile } from "node:child_process";
import { safeProcessError } from "./safe-process-error.js";

function runGh(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
      killSignal: "SIGTERM",
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function normalizeExistingPullRequest(value) {
  const [pullRequest] = Array.isArray(value) ? value : [];
  if (!pullRequest?.url || String(pullRequest.state || "OPEN").toUpperCase() !== "OPEN") return null;
  return {
    attempted: true,
    ok: true,
    created: false,
    number: Number(pullRequest.number || 0),
    url: String(pullRequest.url),
    state: String(pullRequest.state || ""),
    error: "",
  };
}

function isContentSyncBranch(value) {
  return /^content-sync\/[0-9A-Za-z][0-9A-Za-z._/-]*$/u.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.includes("@{")
    && !value.endsWith("/")
    && !value.endsWith(".");
}

export async function ensureGitHubPullRequest({
  repoRoot,
  branch,
  title,
  body,
  query = runGh,
}) {
  const normalizedBranch = String(branch || "").trim();
  if (!isContentSyncBranch(normalizedBranch)) {
    return {
      attempted: false,
      ok: false,
      created: false,
      number: 0,
      url: "",
      state: "",
      error: "内容分支名称无效，未创建 PR。",
    };
  }

  try {
    const existing = normalizeExistingPullRequest(JSON.parse(await query(repoRoot, [
      "pr",
      "list",
      "--state",
      "open",
      "--head",
      normalizedBranch,
      "--limit",
      "1",
      "--json",
      "number,url,state",
    ])));
    if (existing) return existing;

    const output = String(await query(repoRoot, [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      normalizedBranch,
      "--title",
      String(title || "Publish XGIF content"),
      "--body",
      String(body || "由 XGIF 本地发布助手创建。合并仍需人工确认。"),
    ])).trim();
    const url = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/u);
    if (!url) throw new Error("GitHub 未返回可识别的 PR 地址。");
    return {
      attempted: true,
      ok: true,
      created: true,
      number: Number(url[1]),
      url: url[0],
      state: "OPEN",
      error: "",
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      created: false,
      number: 0,
      url: "",
      state: "",
      error: safeProcessError(error, {
        fallback: "内容分支已推送，但自动创建 GitHub PR 失败。",
        redactPaths: [repoRoot],
      }),
    };
  }
}
