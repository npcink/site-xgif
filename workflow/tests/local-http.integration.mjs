import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 18_000 + (process.pid % 10_000);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "xgif-http-integration-"));
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
  cwd: workflowRoot,
  env: {
    ...process.env,
    PORT: String(port),
    XGIF_PUBLISHER_TEST_MODE: "true",
    XGIF_LOCAL_DATABASE_PATH: path.join(temporaryDirectory, "xgif.sqlite3"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

function call({ method = "GET", pathname, headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          rawBody: Buffer.concat(chunks),
          body: text,
          json: () => JSON.parse(text),
        });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await call({ pathname: "/api/health" });
      if (response.status === 200) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`本地发布器集成测试启动超时。\n${output}`);
}

try {
  await waitUntilReady();
  const health = await call({ pathname: "/api/health" });
  assert.equal(health.status, 200);
  assert.equal(health.json().service, "xgif-local-publisher");

  const staticAsset = await call({
    pathname: "/app.js?v=integration",
    headers: { "accept-encoding": "br, gzip" },
  });
  assert.equal(staticAsset.status, 200);
  assert.equal(staticAsset.headers["content-encoding"], "br");
  assert.match(staticAsset.headers["cache-control"], /max-age=3600/);
  assert.ok(staticAsset.headers.etag);
  assert.ok(staticAsset.rawBody.byteLength > 0);
  const unchangedAsset = await call({
    pathname: "/app.js?v=integration",
    headers: { "if-none-match": staticAsset.headers.etag },
  });
  assert.equal(unchangedAsset.status, 304);

  const hostileHost = await call({
    pathname: "/api/health",
    headers: { host: "attacker.example" },
  });
  assert.equal(hostileHost.status, 403);

  const hostileOrigin = await call({
    pathname: "/api/status",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(hostileOrigin.status, 403);

  const missingCsrf = await call({
    method: "POST",
    pathname: "/api/not-a-route",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(missingCsrf.status, 403);

  const session = await call({ pathname: "/api/session" });
  const csrf = session.json().csrfToken;
  assert.ok(csrf);
  const validCsrf = await call({
    method: "POST",
    pathname: "/api/not-a-route",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: "{}",
  });
  assert.equal(validCsrf.status, 404);

  const emptyTitleSuggestions = await call({
    method: "POST",
    pathname: "/api/ai/article-title-suggestions",
    headers: {
      "content-type": "application/json",
      "x-xgif-csrf": csrf,
      origin: `http://127.0.0.1:${port}`,
    },
    body: "{}",
  });
  assert.equal(emptyTitleSuggestions.status, 400);
  assert.match(emptyTitleSuggestions.json().error, /正文、摘要或来源链接/);
  console.log("本地发布器 HTTP 集成检查通过。");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
