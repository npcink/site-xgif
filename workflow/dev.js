import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const siteRoot = path.join(repoRoot, "site");
const astroBin = path.join(siteRoot, "node_modules", "astro", "bin", "astro.mjs");
const runtimeRoot = path.join(workflowRoot, ".runtime");
const publisherPidFile = path.join(runtimeRoot, "publisher.json");
const publisherLog = path.join(runtimeRoot, "publisher.log");
const previewLog = path.join(runtimeRoot, "preview.log");
const publisherUrl = "http://127.0.0.1:8787/api/status";
const previewUrl = "http://127.0.0.1:4321/";

function probe(url, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET" }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(url, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe(url)) === expected) return true;
    await delay(250);
  }
  return false;
}

function startDetached(name, command, args, cwd, logFile) {
  mkdirSync(runtimeRoot, { recursive: true });
  appendFileSync(logFile, `\n[${new Date().toISOString()}] 启动 ${name}\n`);
  const logFd = openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  return child.pid;
}

function readPublisherPid() {
  if (!existsSync(publisherPidFile)) return null;
  try {
    const record = JSON.parse(readFileSync(publisherPidFile, "utf8"));
    return Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null;
  } catch {
    return null;
  }
}

function removePublisherPid() {
  if (existsSync(publisherPidFile)) unlinkSync(publisherPidFile);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function startServices() {
  let publisherRunning = await probe(publisherUrl);
  let previewRunning = await probe(previewUrl);

  if (publisherRunning) {
    console.log("本地发布助手已在 127.0.0.1:8787 运行，继续复用。");
  } else {
    const pid = startDetached(
      "本地发布助手",
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "server.js"],
      workflowRoot,
      publisherLog,
    );
    writeFileSync(publisherPidFile, `${JSON.stringify({ pid, startedAt: new Date().toISOString() }, null, 2)}\n`);
    publisherRunning = await waitFor(publisherUrl, true);
  }

  if (previewRunning) {
    console.log("Astro 站点预览已在 127.0.0.1:4321 运行，继续复用。");
  } else if (!existsSync(astroBin)) {
    console.error(`缺少 Astro：${astroBin}`);
    console.error("请先在 site 目录执行 npm install。");
  } else {
    startDetached(
      "Astro 站点预览",
      process.execPath,
      [astroBin, "dev", "--host", "127.0.0.1", "--port", "4321"],
      siteRoot,
      previewLog,
    );
    previewRunning = await waitFor(previewUrl, true);
  }

  console.log(`管理端：${publisherRunning ? "可用" : "不可用"} http://127.0.0.1:8787`);
  console.log(`站点预览：${previewRunning ? "可用" : "不可用"} http://127.0.0.1:4321`);

  if (!publisherRunning || !previewRunning) {
    console.error(`启动日志：${runtimeRoot}`);
    process.exitCode = 1;
  }
}

async function stopPublisher() {
  if (!(await probe(publisherUrl))) {
    removePublisherPid();
    console.log("本地发布助手未运行。");
    return;
  }

  const pid = readPublisherPid();
  if (!pid || !processExists(pid)) {
    console.error("本地发布助手正在运行，但没有可验证的 PID；为避免误杀进程，未自动停止。");
    return;
  }

  process.kill(pid, "SIGTERM");
  if (await waitFor(publisherUrl, false, 5_000)) {
    removePublisherPid();
    console.log("本地发布助手已停止。");
  } else {
    console.error("本地发布助手未能在 5 秒内停止。");
    process.exitCode = 1;
  }
}

async function stopPreview() {
  if (!(await probe(previewUrl))) {
    console.log("Astro 站点预览未运行。");
    return;
  }
  const exitCode = await run(process.execPath, [astroBin, "dev", "stop"], siteRoot);
  if (exitCode === 0 && (await waitFor(previewUrl, false, 5_000))) {
    console.log("Astro 站点预览已停止。");
  } else {
    console.error("Astro 站点预览停止失败。");
    process.exitCode = 1;
  }
}

async function showStatus() {
  const [publisherRunning, previewRunning] = await Promise.all([probe(publisherUrl), probe(previewUrl)]);
  console.log(`管理端：${publisherRunning ? "可用" : "不可用"} http://127.0.0.1:8787`);
  console.log(`站点预览：${previewRunning ? "可用" : "不可用"} http://127.0.0.1:4321`);
  if (!publisherRunning || !previewRunning) process.exitCode = 1;
}

const command = process.argv[2] || "start";

if (command === "start") {
  await startServices();
} else if (command === "stop") {
  await stopPublisher();
  await stopPreview();
} else if (command === "restart") {
  await stopPublisher();
  await stopPreview();
  if (!process.exitCode) await startServices();
} else if (command === "status") {
  await showStatus();
} else {
  console.error(`未知命令：${command}`);
  console.error("可用命令：start、stop、restart、status");
  process.exitCode = 1;
}
