import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const connectionError = code => Object.assign(new Error(code), { code });

export function embeddingTunnelConfig(config, env) {
  const target = String(env.XGIF_EMBEDDING_SSH_TARGET || "").trim();
  if (!target) return null;
  const url = new URL(config.endpoint);
  const remotePort = String(env.XGIF_EMBEDDING_SSH_REMOTE_PORT || "11434");
  // Explicit opt-in; no shell, interactive auth, arbitrary forward destination,
  // or non-loopback listener. Ollama remains private on the M4.
  if (config.provider !== "ollama" || url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port || !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(target)
    || !/^\d{1,5}$/u.test(remotePort) || Number(remotePort) < 1 || Number(remotePort) > 65535) {
    throw connectionError("EMBEDDING_TUNNEL_CONFIG_INVALID");
  }
  return { target, host: url.hostname, port: Number(url.port), remotePort: Number(remotePort) };
}

export function canConnect({ host, port }) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    let finished = false;
    const finish = ready => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}

/** Start only a configured, missing tunnel; close only the process we own. */
export async function withEmbeddingConnection(config, env, action, {
  spawnImpl = spawn, probe = canConnect, startupTimeoutMs = 12_000,
} = {}) {
  const tunnel = embeddingTunnelConfig(config, env);
  if (!tunnel || await probe(tunnel)) return action();
  const child = spawnImpl("ssh", [
    "-N", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2",
    "-L", `127.0.0.1:${tunnel.port}:127.0.0.1:${tunnel.remotePort}`, tunnel.target,
  ], { stdio: "ignore" });
  let stopped = false;
  const closed = new Promise(resolve => {
    child.once("error", () => { stopped = true; resolve(); });
    child.once("close", () => { stopped = true; resolve(); });
  });
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline && !stopped) {
      if (await probe(tunnel)) {
        if (stopped) break;
        return await action();
      }
      await delay(100);
    }
    throw connectionError("EMBEDDING_TUNNEL_UNAVAILABLE");
  } finally {
    if (!stopped) {
      child.kill("SIGTERM");
      // Bounded cleanup also runs when model validation/inference fails.
      if (!await Promise.race([closed.then(() => true), delay(1000, false)])) {
        child.kill("SIGKILL");
        await Promise.race([closed, delay(1000)]);
      }
    }
  }
}
