import { spawn } from "node:child_process";

/** Optional SSH transport for the explicitly configured loopback model endpoint. */
export class LocalAiTunnel {
  constructor({ baseUrl, host = "", fetchImpl = fetch, spawnImpl = spawn }) {
    this.baseUrl = baseUrl;
    this.host = String(host).trim();
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
    this.child = null;
    this.connecting = null;
  }
  async healthy() {
    try {
      const response = await this.fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(1200), redirect: "error" });
      await response.body?.cancel();
      return response.ok;
    } catch { return false; }
  }
  async ensure() {
    if (!this.host) return;
    if (!this.connecting) this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async connect() {
    const url = new URL(this.baseUrl);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || !url.port
      || !/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(this.host)) {
      throw Object.assign(new Error("M4 隧道配置无效，请检查本机端口和 SSH 主机。"), { statusCode: 503 });
    }
    if (await this.healthy()) return;
    // Only terminate a tunnel created by this publisher, never another user's SSH process.
    this.close();
    const child = this.spawn("ssh", ["-N", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
      "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
      "-L", `127.0.0.1:${url.port}:127.0.0.1:11434`, this.host], { stdio: "ignore" });
    this.child = child;
    let failed = false;
    child.once("error", () => { failed = true; });
    child.once("exit", () => { failed = true; if (this.child === child) this.child = null; });
    for (let attempt = 0; attempt < 20 && !failed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await this.healthy()) return;
    }
    this.close();
    throw Object.assign(new Error("M4 隧道连接失败；请确认 M4 在线、Tailscale 已连接和 SSH 可用，再重试。"), { statusCode: 503, code: "M4_UNAVAILABLE" });
  }
  close() {
    const child = this.child;
    this.child = null;
    child?.kill("SIGTERM");
  }
}
