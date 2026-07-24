import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function remoteIdentity(remote) {
  const value = String(remote || "").trim();
  const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      provider: sshMatch[1].toLowerCase() === "github.com" ? "github" : "git",
      repository: sshMatch[2].replace(/\.git$/, ""),
    };
  }
  try {
    const url = new URL(value);
    return {
      provider: url.hostname.toLowerCase() === "github.com" ? "github" : "git",
      repository: url.pathname.replace(/^\/|\.git$/g, ""),
    };
  } catch {
    return { provider: "git", repository: "已配置私有远端" };
  }
}

function safeGitError(error) {
  return String(error?.stderr || error?.stdout || error?.message || "私有远程推送失败。")
    .replace(/https?:\/\/[^@\s]+@/gi, "https://")
    .replace(/\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[redacted]")
    .trim();
}

async function exists(filePath) {
  return stat(filePath).then(() => true).catch(() => false);
}

export class LocalContentBackup {
  constructor({
    repoRoot,
    workflowRoot,
    gitDir = path.join(workflowRoot, "backups", "content-history.git"),
    paths = [
      "site/src/content/articles",
      "site/src/content/images",
      "site/public/images/memes",
      "site/public/images/articles",
      "workflow/records",
      "workflow/private-sources",
      "workflow/trash",
    ],
  }) {
    this.repoRoot = repoRoot;
    this.workflowRoot = workflowRoot;
    this.gitDir = gitDir;
    this.paths = paths;
  }

  gitArgs(args) {
    return [`--git-dir=${this.gitDir}`, `--work-tree=${this.repoRoot}`, ...args];
  }

  async ensureRepository() {
    await mkdir(path.dirname(this.gitDir), { recursive: true });
    await mkdir(path.join(this.workflowRoot, "trash"), { recursive: true });
    await Promise.all(this.paths.map((item) => mkdir(path.join(this.repoRoot, item), { recursive: true })));
    if (await exists(path.join(this.gitDir, "HEAD"))) return;
    await run("git", ["init", "--bare", "--initial-branch=history", this.gitDir], this.repoRoot);
  }

  async snapshot(message = "Automatic content safety snapshot") {
    await this.ensureRepository();
    await run("git", this.gitArgs(["add", "-A", "-f", "--", ...this.paths]), this.repoRoot);
    const staged = await run("git", this.gitArgs(["diff", "--cached", "--name-only"]), this.repoRoot);
    let changed = false;
    if (!staged.stdout.trim()) {
      const push = await this.pushOffsite();
      const status = await this.status();
      return {
        ok: true,
        changed,
        ...status,
        offsite: {
          ...status.offsite,
          error: push.error || status.offsite.error,
        },
      };
    }
    await run("git", [
      "-c", "user.name=XGIF Local Backup",
      "-c", "user.email=local-backup@xgif.invalid",
      ...this.gitArgs(["commit", "-m", message]),
    ], this.repoRoot);
    changed = true;
    const push = await this.pushOffsite();
    const status = await this.status();
    return {
      ok: true,
      changed,
      ...status,
      offsite: {
        ...status.offsite,
        error: push.error || status.offsite.error,
      },
    };
  }

  async pushOffsite() {
    let remote = "";
    try {
      remote = (await run("git", this.gitArgs(["remote", "get-url", "--push", "origin"]), this.repoRoot)).stdout.trim();
    } catch {
      return { configured: false, ok: false, error: "" };
    }
    try {
      await run("git", this.gitArgs(["push", "origin", "history"]), this.repoRoot);
      return { configured: true, ok: true, error: "" };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        error: safeGitError(error),
      };
    }
  }

  async offsiteStatus({ commit = "", committedAt = "" } = {}) {
    let remote = "";
    try {
      remote = (await run("git", this.gitArgs(["remote", "get-url", "--push", "origin"]), this.repoRoot)).stdout.trim();
    } catch {
      return {
        configured: false,
        ok: false,
        provider: "",
        repository: "",
        branch: "history",
        commit: "",
        syncedAt: "",
        error: "尚未配置私有内容远端。",
      };
    }
    const identity = remoteIdentity(remote);
    let remoteCommit = "";
    let remoteCommittedAt = "";
    try {
      remoteCommit = (await run("git", this.gitArgs(["rev-parse", "--verify", "refs/remotes/origin/history"]), this.repoRoot)).stdout.trim();
      remoteCommittedAt = (await run("git", this.gitArgs(["log", "-1", "--format=%cI", "refs/remotes/origin/history"]), this.repoRoot)).stdout.trim();
    } catch {
      // The first successful push will create the remote-tracking ref.
    }
    const synchronized = Boolean(commit && remoteCommit && commit === remoteCommit);
    return {
      configured: true,
      ok: synchronized,
      ...identity,
      branch: "history",
      commit: remoteCommit,
      syncedAt: synchronized ? (remoteCommittedAt || committedAt) : "",
      error: synchronized ? "" : "本机私有快照尚未同步到远端，请重试。",
    };
  }

  async status() {
    await this.ensureRepository();
    try {
      const [commit, committedAt, count] = await Promise.all([
        run("git", this.gitArgs(["rev-parse", "HEAD"]), this.repoRoot),
        run("git", this.gitArgs(["log", "-1", "--format=%cI"]), this.repoRoot),
        run("git", this.gitArgs(["ls-tree", "-r", "--name-only", "HEAD"]), this.repoRoot),
      ]);
      const result = {
        ready: true,
        gitDir: path.relative(this.repoRoot, this.gitDir),
        commit: commit.stdout.trim(),
        committedAt: committedAt.stdout.trim(),
        files: count.stdout.split(/\r?\n/).filter(Boolean).length,
      };
      return {
        ...result,
        offsite: await this.offsiteStatus(result),
      };
    } catch {
      return {
        ready: false,
        gitDir: path.relative(this.repoRoot, this.gitDir),
        commit: "",
        committedAt: "",
        files: 0,
        offsite: {
          configured: false,
          ok: false,
          provider: "",
          repository: "",
          branch: "history",
          commit: "",
          syncedAt: "",
          error: "尚未创建本机私有内容快照。",
        },
      };
    }
  }

  async listFileHistory(file, { limit = 20 } = {}) {
    await this.ensureRepository();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    try {
      const result = await run("git", this.gitArgs([
        "log",
        `--max-count=${safeLimit}`,
        "--format=%H%x00%cI%x00%s%x00",
        "--",
        file,
      ]), this.repoRoot);
      const fields = result.stdout.split("\0");
      const items = [];
      for (let index = 0; index + 2 < fields.length; index += 3) {
        const commit = fields[index].trim();
        if (!commit) continue;
        items.push({
          commit,
          createdAt: fields[index + 1].trim(),
          message: fields[index + 2].trim(),
        });
      }
      return items;
    } catch {
      return [];
    }
  }

  async readFileVersion(file, commit) {
    await this.ensureRepository();
    if (!/^[a-f0-9]{40}$/i.test(String(commit || ""))) {
      throw new Error("版本标识无效。");
    }
    const history = await this.listFileHistory(file, { limit: 100 });
    if (!history.some((item) => item.commit === commit)) {
      throw new Error("该版本不属于当前内容的本地历史。");
    }
    return (await run("git", this.gitArgs(["show", `${commit}:${file}`]), this.repoRoot)).stdout;
  }
}
