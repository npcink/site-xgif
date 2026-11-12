import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultSite = fileURLToPath(new URL("../", import.meta.url));
const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
const rootFiles = new Set(["package.json", "package-lock.json", ".node-version", "astro.config.mjs", "tsconfig.json", "playwright.config.mjs"]);
const privatePart = /^(?:\..*|secrets?(?:\..*)?|credentials(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?|private(?:-sources)?|backups?|trash|records|node_modules|dist|coverage|test-results|playwright-report)$/iu;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const spaceCheck = `XGIF_VISUAL_FREE_KIB=$(df -Pk /tmp | awk 'NR == 2 {print $4}');
case "$XGIF_VISUAL_FREE_KIB" in ''|*[!0-9]*) printf '%s\\n' 'M4 无法读取宿主 /tmp 可用空间；未启动测试。' >&2; exit 73;; esac;
if [ "$XGIF_VISUAL_FREE_KIB" -lt 10485760 ]; then
  printf 'M4 宿主 /tmp 可用空间不足：%s KiB，启动前至少需要 10 GiB（10485760 KiB）；未启动测试。\\n' "$XGIF_VISUAL_FREE_KIB" >&2; exit 73;
fi;`;

export function runCommand(command, args, { cwd, input, capture = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, stdio: ["pipe", capture ? "pipe" : "inherit", "inherit"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code, exitSignal) => resolve({ code: code ?? (exitSignal === "SIGINT" ? 130 : 143), stdout }));
    child.stdin.on("error", () => {}); // A failed SSH connection can close stdin before rsync receives its file list.
    child.stdin.end(input);
  });
}

export async function sourceSnapshot(siteDir, filenames) {
  const files = new Map();
  const realSite = await realpath(siteDir);
  for (const file of filenames) {
    if (!file || file.split("/").some((part) => part === "..")) continue;
    if (!rootFiles.has(file) && !/^(?:src|public|scripts|tests)\//u.test(file)) continue;
    if (!rootFiles.has(file) && file.split("/").some((part) => privatePart.test(part))) continue;
    if (/\.(?:pem|key|p12|pfx|sqlite3?|db|zip)$/iu.test(file)) continue;
    const fullPath = path.join(siteDir, file);
    const stat = await lstat(fullPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    if (!stat?.isFile() || await realpath(fullPath) !== path.join(realSite, file)) continue;
    const bytes = await readFile(fullPath);
    if (/^src\/content\/(?:articles|images)\/.*\.md$/u.test(file)) {
      const frontmatter = bytes.toString("utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
      if (!frontmatter || /^\s*(?:draft:\s*true|public:\s*false)\s*(?:#.*)?$/imu.test(frontmatter)) continue;
    }
    files.set(file, digest(bytes));
  }
  return files;
}

export async function applySnapshots(siteDir, artifactDir, initial) {
  const relative = "tests/visual/__screenshots__";
  const returned = path.join(artifactDir, relative);
  const names = await readdir(returned).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const updates = [];
  for (const name of names) {
    if (!name.endsWith(".png")) continue;
    const source = path.join(returned, name);
    if (!(await lstat(source)).isFile()) continue;
    const bytes = await readFile(source);
    const file = `${relative}/${name}`;
    if (digest(bytes) === initial.get(file)) continue;
    const destination = path.join(siteDir, file);
    const current = await readFile(destination).catch((error) => { if (error.code !== "ENOENT") throw error; });
    if ((current ? digest(current) : undefined) !== initial.get(file)) {
      throw new Error(`截图已在本机修改，未覆盖：${file}；远端版本保留在 ${artifactDir}`);
    }
    updates.push({ destination, bytes });
  }
  for (const { destination, bytes } of updates) {
    const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  }
  return updates.length;
}

export async function runVisual({ siteDir = defaultSite, args = [], env = process.env, platform = process.platform, command = runCommand, signal, log = console.log } = {}) {
  // GitHub already runs this job inside the pinned Playwright image; never nest Docker there.
  if (env.GITHUB_ACTIONS === "true" && env.RUNNER_OS === "Linux" && platform === "linux") {
    log("Linux CI：在工作流的 Playwright 容器内执行。");
    return (await command("npm", ["run", "test:visual", "--", ...args], { cwd: siteDir, signal })).code;
  }
  const host = env.XGIF_VISUAL_SSH_HOST || "muze@100.102.170.79";
  if (!/^[a-z\d_][a-z\d_.@-]*$/iu.test(host)) throw new Error("XGIF_VISUAL_SSH_HOST 必须是 SSH 主机别名或 user@host。");
  const runId = `xgif-visual-${digest(await realpath(siteDir)).slice(0, 12)}-${randomBytes(6).toString("hex")}`;
  const artifactDir = path.join(siteDir, "test-results", runId);
  const ssh = (script, options = {}) => command("ssh", [...sshOptions, host, script], options);
  const checked = (result, message) => { if (result.code) throw Object.assign(new Error(message), { exitCode: result.code }); return result; };
  let remoteDir, ranTests = false, returned = false, code = 0;
  log(`M4 Linux 视觉测试：${host}，任务 ${runId}；不会启动本机 Docker。`);
  try {
    const prepared = checked(await ssh(`set -eu; ${spaceCheck} command -v rsync >/dev/null; test "$(docker info --format '{{.OSType}}')" = linux; mktemp -d ${quote(`/tmp/${runId}.XXXXXX`)}`, { capture: true, signal }), "M4 预检失败（SSH、宿主空间或远端 Docker）；未回退本机 Docker。");
    remoteDir = prepared.stdout.trim();
    if (!new RegExp(`^/tmp/${runId}\\.[a-zA-Z0-9]+$`, "u").test(remoteDir)) throw new Error("M4 返回了非预期的任务目录。");
    const snapshot = async () => {
      const listed = checked(await command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], { cwd: siteDir, capture: true, signal }), "无法读取工作区源文件清单。");
      return sourceSnapshot(siteDir, listed.stdout.split("\0"));
    };
    const initial = await snapshot();
    const transport = ["-e", ["ssh", ...sshOptions].join(" ")];
    checked(await command("rsync", ["-rt", "--from0", "--files-from=-", ...transport, `${siteDir}/`, `${host}:${remoteDir}/site/`], { input: `${[...initial.keys()].join("\0")}\0`, signal }), "源码同步到 M4 失败。");
    log(`已同步 ${initial.size} 个源文件；远端目录 ${remoteDir}`);
    ranTests = true;
    try {
      code = (await ssh(`set -eu; ${spaceCheck} cd ${quote(`${remoteDir}/site`)} && sh scripts/run-visual-container.sh ${quote(runId)} ${args.map(quote).join(" ")}`, { signal })).code;
    } catch (error) {
      if (error.name !== "AbortError") throw error;
      code = signal?.reason === "SIGTERM" ? 143 : 130;
      log("视觉测试已中断，正在回传诊断并清理本次远端容器。");
    }
    await mkdir(artifactDir, { recursive: true });
    const artifacts = await command("rsync", ["-rt", ...transport, "--include=/test-results/***", "--include=/playwright-report/***", "--include=/tests/", "--include=/tests/visual/", "--include=/tests/visual/__screenshots__/***", "--exclude=*", `${host}:${remoteDir}/site/`, `${artifactDir}/`]);
    returned = artifacts.code === 0;
    if (!returned) throw new Error(`产物回传失败；保留 M4 任务目录 ${remoteDir}。`);
    log(`测试产物已回传：${artifactDir}`);
    if (args.some((arg) => arg === "-u" || /^--update-snapshots(?:=|$)/u.test(arg))) {
      // Do not apply screenshots from an older source revision over ongoing local edits.
      const current = await snapshot();
      if (current.size !== initial.size || [...initial].some(([file, hash]) => current.get(file) !== hash)) throw new Error(`源文件在运行期间变更；截图仅保存在 ${artifactDir}，未更新基线。`);
      log(`已回写 ${await applySnapshots(siteDir, artifactDir, initial)} 张变更截图。`);
    }
  } catch (error) {
    log(error.name === "AbortError" ? "视觉测试已中断，正在清理本次远端容器。" : error.message);
    code ||= error.exitCode || (error.name === "AbortError" ? (signal?.reason === "SIGTERM" ? 143 : 130) : 1);
  } finally {
    if (remoteDir && new RegExp(`^/tmp/${runId}\\.[a-zA-Z0-9]+$`, "u").test(remoteDir)) {
      const removeFiles = !ranTests || returned;
      const cleanup = await ssh(`set -e; docker info >/dev/null; if docker container inspect ${quote(runId)} >/dev/null 2>&1; then docker rm --force ${quote(runId)} >/dev/null; fi; ${removeFiles ? `rm -rf -- ${quote(remoteDir)}` : ":"}`).catch(() => ({ code: 1 }));
      if (cleanup.code) { log(`M4 清理失败，仅涉及任务 ${runId} / ${remoteDir}，请保留此标识排查。`); code ||= 1; }
    }
  }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const interrupt = () => controller.abort("SIGINT");
  const terminate = () => controller.abort("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try { process.exitCode = await runVisual({ args: process.argv.slice(2), signal: controller.signal }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate); }
}
