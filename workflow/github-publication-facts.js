import { execFile } from "node:child_process";

const failedConclusions = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "FAILURE",
  "STARTUP_FAILURE",
  "TIMED_OUT",
]);

function remoteUnknown(description = "当前无法读取 GitHub PR 与检查状态，保留已推送事实。") {
  return {
    stage: "remote_unknown",
    label: "已推送 · 远端待确认",
    description,
    number: 0,
    url: "",
    state: "",
  };
}

function runGh(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 8_000,
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

export function classifyPullRequest(pr = {}) {
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failed = checks.filter((check) => failedConclusions.has(String(check.conclusion || "")));
  const pending = checks.filter((check) => String(check.status || "") !== "COMPLETED");
  const workersBuild = checks.find((check) => /Workers Builds/iu.test(String(check.name || "")));
  let stage = "pr_open";
  let label = "PR 已创建";
  let description = "等待 GitHub 检查完成。";

  if (String(pr.state || "") === "MERGED") {
    if (workersBuild?.conclusion === "SUCCESS") {
      stage = "deployment_succeeded";
      label = "部署检查通过";
      description = "PR 已合并且 Cloudflare Workers Builds 已通过，等待线上内容核验。";
    } else if (workersBuild && failedConclusions.has(String(workersBuild.conclusion || ""))) {
      stage = "deployment_failed";
      label = "部署失败";
      description = "PR 已合并，但 Cloudflare Workers Builds 未通过。";
    } else {
      stage = "merged";
      label = "PR 已合并";
      description = "等待 Cloudflare Workers Builds 完成。";
    }
  } else if (failed.length) {
    stage = "checks_failed";
    label = "PR 检查失败";
    description = `${failed.length} 项检查未通过，需要先修复。`;
  } else if (pending.length) {
    stage = "checks_running";
    label = "PR 检查中";
    description = `${pending.length} 项检查仍在运行。`;
  } else if (checks.length) {
    stage = "checks_passed";
    label = "PR 检查通过";
    description = "所有已报告检查均已通过，等待合并。";
  }

  return {
    stage,
    label,
    description,
    number: Number(pr.number || 0),
    url: String(pr.url || ""),
    state: String(pr.state || ""),
  };
}

export class GitHubPublicationFacts {
  constructor({ repoRoot, ttlMs = 30_000, query = runGh }) {
    this.repoRoot = repoRoot;
    this.ttlMs = ttlMs;
    this.cachedAt = 0;
    this.cached = new Map();
    this.pending = null;
    this.available = false;
    this.query = query;
  }

  async refresh(branches) {
    const entries = await Promise.all(branches.map(async (branch) => {
      try {
        const stdout = await this.query(this.repoRoot, [
          "pr",
          "list",
          "--state",
          "all",
          "--head",
          branch,
          "--limit",
          "1",
          "--json",
          "number,headRefName,state,statusCheckRollup,url",
        ]);
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) throw new TypeError("GitHub PR response must be an array.");
        const [pr] = parsed;
        return [branch, pr ? classifyPullRequest(pr) : {
          stage: "pushed_no_pr",
          label: "已推送 · 待建 PR",
          description: "内容分支已推送，但尚未找到对应 PR。",
          number: 0,
          url: "",
          state: "",
        }];
      } catch {
        return [branch, remoteUnknown()];
      }
    }));
    for (const [branch, facts] of entries) this.cached.set(branch, facts);
    this.cachedAt = Date.now();
    this.available = true;
    return this.cached;
  }

  async forBranches(branches = []) {
    const unique = [...new Set(branches.map((branch) => String(branch || "")).filter(Boolean))];
    if (!unique.length) return new Map();
    const missing = unique.filter((branch) => !this.cached.has(branch));
    if (Date.now() - this.cachedAt >= this.ttlMs || missing.length) {
      if (this.pending) {
        await this.pending;
        const stillMissing = unique.filter((branch) => !this.cached.has(branch));
        if (this.available && stillMissing.length) {
          this.pending = this.refresh(stillMissing)
            .catch(() => {
              this.available = false;
              this.cachedAt = Date.now();
              return new Map();
            })
            .finally(() => { this.pending = null; });
          await this.pending;
        }
      } else {
        this.pending = this.refresh(
          Date.now() - this.cachedAt >= this.ttlMs ? unique : missing,
        )
          .catch(() => {
            this.available = false;
            this.cachedAt = Date.now();
            return new Map();
          })
          .finally(() => { this.pending = null; });
        await this.pending;
      }
    }
    return new Map(unique.map((branch) => [
      branch,
      this.available
        ? this.cached.get(branch) || remoteUnknown("当前分支的 GitHub 状态尚未取得，保留已推送事实。")
        : remoteUnknown(),
    ]));
  }
}
