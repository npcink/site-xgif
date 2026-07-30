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
import { publisherSourceVersion } from "./runtime-version.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const siteRoot = path.join(repoRoot, "site");
const astroBin = path.join(siteRoot, "node_modules", "astro", "bin", "astro.mjs");
const runtimeRoot = path.join(workflowRoot, ".runtime");
const publisherPidFile = path.join(runtimeRoot, "publisher.json");
const publisherLog = path.join(runtimeRoot, "publisher.log");
const previewLog = path.join(runtimeRoot, "preview.log");
const publisherUrl = "http://127.0.0.1:8787/api/health";
const publisherStatusUrl = "http://127.0.0.1:8787/api/status?refresh=remote";
const previewUrl = "http://127.0.0.1:4321/";
const expectedPublisherVersion = publisherSourceVersion(workflowRoot);

function probe(url, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET" }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function probePublisher(timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = request(publisherUrl, { method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({
            healthy: res.statusCode === 200 && body.service === "xgif-local-publisher" && body.ok === true,
            runtimeVersion: String(body.runtimeVersion || ""),
            pid: Number(body.pid || 0),
            startedAt: String(body.startedAt || ""),
          });
        } catch {
          resolve({ healthy: false, runtimeVersion: "", pid: 0, startedAt: "" });
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ healthy: false, runtimeVersion: "", pid: 0, startedAt: "" });
    });
    req.on("error", () => resolve({
      healthy: false,
      runtimeVersion: "",
      pid: 0,
      startedAt: "",
    }));
    req.end();
  });
}

function requestJson(url, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({
            ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
            statusCode: res.statusCode || 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch {
          resolve({ ok: false, statusCode: res.statusCode || 0, body: null });
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, body: null });
    });
    req.on("error", () => resolve({ ok: false, statusCode: 0, body: null }));
    req.end();
  });
}

async function refreshPublisherStatus() {
  const first = await requestJson(publisherStatusUrl);
  if (!first.ok || first.body?.services?.sitePreview?.available === true) return first;
  await delay(100);
  return requestJson(publisherStatusUrl);
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
  let publisherState = await probePublisher();
  let publisherRunning = publisherState.healthy;
  let previewRunning = await probe(previewUrl);

  if (publisherRunning && publisherState.runtimeVersion !== expectedPublisherVersion) {
    console.log("检测到本地发布助手代码已更新，正在自动重启。");
    await stopPublisher();
    publisherState = { healthy: false, runtimeVersion: "" };
    publisherRunning = false;
  }

  if (publisherRunning) {
    console.log("本地发布助手已在 127.0.0.1:8787 运行，继续复用。");
  } else {
    const stalePid = readPublisherPid();
    if (stalePid && processExists(stalePid)) {
      console.log("检测到旧版本地发布助手进程，正在停止。");
      await stopPublisher();
    }
    const pid = startDetached(
      "本地发布助手",
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "server.js"],
      workflowRoot,
      publisherLog,
    );
    writeFileSync(
      publisherPidFile,
      `${JSON.stringify({
        pid,
        startedAt: new Date().toISOString(),
        runtimeVersion: expectedPublisherVersion,
      }, null, 2)}\n`,
    );
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      publisherState = await probePublisher();
      if (publisherState.healthy && publisherState.runtimeVersion === expectedPublisherVersion) break;
      await delay(250);
    }
    publisherRunning = publisherState.healthy && publisherState.runtimeVersion === expectedPublisherVersion;
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

  if (publisherRunning && previewRunning) {
    const refreshed = await refreshPublisherStatus();
    if (!refreshed.ok || refreshed.body?.services?.sitePreview?.available !== true) {
      console.error("发布状态刷新失败：站点预览虽已启动，但发布助手尚未确认可用。");
      publisherRunning = false;
    }
  }

  console.log(`管理端：${publisherRunning ? "可用" : "不可用"} http://127.0.0.1:8787`);
  console.log(`站点预览：${previewRunning ? "可用" : "不可用"} http://127.0.0.1:4321`);

  if (!publisherRunning || !previewRunning) {
    console.error(`启动日志：${runtimeRoot}`);
    process.exitCode = 1;
  }
}

async function stopPublisher() {
  const pid = readPublisherPid();
  if (!pid || !processExists(pid)) {
    const state = await probePublisher();
    if (state.healthy) {
      console.error("本地发布助手正在运行，但没有可验证的 PID；为避免误杀进程，未自动停止。");
      process.exitCode = 1;
    } else {
      removePublisherPid();
      console.log("本地发布助手未运行。");
    }
    return;
  }

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && processExists(pid)) await delay(100);
  if (!processExists(pid)) {
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
  const [publisherState, previewRunning] = await Promise.all([probePublisher(), probe(previewUrl)]);
  const publisherCurrent = publisherState.healthy && publisherState.runtimeVersion === expectedPublisherVersion;
  const publisherLabel = !publisherState.healthy
    ? "不可用"
    : publisherCurrent
      ? "可用"
      : "运行版本已过期";
  console.log(`管理端：${publisherLabel} http://127.0.0.1:8787`);
  console.log(`站点预览：${previewRunning ? "可用" : "不可用"} http://127.0.0.1:4321`);
  if (!publisherCurrent || !previewRunning) process.exitCode = 1;
}

async function doctor() {
  const [publisherState, previewRunning, status] = await Promise.all([
    probePublisher(),
    probe(previewUrl),
    refreshPublisherStatus(),
  ]);
  const managedPid = readPublisherPid();
  const checks = {
    publisherReachable: publisherState.healthy,
    publisherCurrent: (
      publisherState.healthy
      && publisherState.runtimeVersion === expectedPublisherVersion
    ),
    publisherPidManaged: (
      Boolean(managedPid)
      && managedPid === publisherState.pid
      && processExists(managedPid)
    ),
    previewReachable: previewRunning,
    statusRefresh: (
      status.ok
      && status.body?.services?.sitePreview?.available === true
    ),
    gitPushReady: status.body?.git?.canPush === true,
  };
  console.log(JSON.stringify({
    ok: Object.values(checks).every(Boolean),
    checks,
    runtime: {
      pid: publisherState.pid || null,
      startedAt: publisherState.startedAt || null,
      runtimeVersion: publisherState.runtimeVersion || null,
      expectedRuntimeVersion: expectedPublisherVersion,
    },
  }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
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
} else if (command === "doctor") {
  await doctor();
} else {
  console.error(`未知命令：${command}`);
  console.error("可用命令：start、stop、restart、status、doctor");
  process.exitCode = 1;
}
