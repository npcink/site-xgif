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
    if (await exists(path.join(this.gitDir, "HEAD"))) return;
    await run("git", ["init", "--bare", "--initial-branch=history", this.gitDir], this.repoRoot);
  }

  async snapshot(message = "Automatic content safety snapshot") {
    await this.ensureRepository();
    await run("git", this.gitArgs(["add", "-A", "-f", "--", ...this.paths]), this.repoRoot);
    const staged = await run("git", this.gitArgs(["diff", "--cached", "--name-only"]), this.repoRoot);
    if (!staged.stdout.trim()) {
      return {
        ok: true,
        changed: false,
        ...(await this.status()),
        offsite: await this.pushOffsite(),
      };
    }
    await run("git", [
      "-c", "user.name=XGIF Local Backup",
      "-c", "user.email=local-backup@xgif.invalid",
      ...this.gitArgs(["commit", "-m", message]),
    ], this.repoRoot);
    return {
      ok: true,
      changed: true,
      ...(await this.status()),
      offsite: await this.pushOffsite(),
    };
  }

  async pushOffsite() {
    let remote = "";
    try {
      remote = (await run("git", this.gitArgs(["remote", "get-url", "--push", "origin"]), this.repoRoot)).stdout.trim();
    } catch {
      return { configured: false, ok: false, remote: "", error: "" };
    }
    try {
      await run("git", this.gitArgs(["push", "origin", "history"]), this.repoRoot);
      return { configured: true, ok: true, remote, error: "" };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        remote,
        error: String(error.stderr || error.stdout || error.message || "私有远程推送失败。").trim(),
      };
    }
  }

  async status() {
    await this.ensureRepository();
    try {
      const [commit, committedAt, count] = await Promise.all([
        run("git", this.gitArgs(["rev-parse", "HEAD"]), this.repoRoot),
        run("git", this.gitArgs(["log", "-1", "--format=%cI"]), this.repoRoot),
        run("git", this.gitArgs(["ls-tree", "-r", "--name-only", "HEAD"]), this.repoRoot),
      ]);
      return {
        ready: true,
        gitDir: path.relative(this.repoRoot, this.gitDir),
        commit: commit.stdout.trim(),
        committedAt: committedAt.stdout.trim(),
        files: count.stdout.split(/\r?\n/).filter(Boolean).length,
      };
    } catch {
      return {
        ready: false,
        gitDir: path.relative(this.repoRoot, this.gitDir),
        commit: "",
        committedAt: "",
        files: 0,
      };
    }
  }
}
