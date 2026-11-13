import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { canConnect, embeddingTunnelConfig, withEmbeddingConnection } from "../embedding-connection.js";

const config = { provider: "ollama", endpoint: "http://127.0.0.1:11435/api/embed" };
const env = { XGIF_EMBEDDING_SSH_TARGET: "muze@m4.example" };
function childProcess() {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = signal => { child.signals.push(signal); child.emit("close", 0); };
  return child;
}

test("SSH forwarding requires explicit safe configuration and loopback endpoints", () => {
  assert.equal(embeddingTunnelConfig(config, {}), null);
  assert.equal(embeddingTunnelConfig(config, env).remotePort, 11434);
  for (const target of ["-oProxyCommand=bad", "user@host;bad", "user@host\n-oBad=yes"]) {
    assert.throws(() => embeddingTunnelConfig(config, { ...env, XGIF_EMBEDDING_SSH_TARGET: target }), /CONFIG_INVALID/);
  }
  for (const remotePort of ["0", "65536", "11434:bad", "-1"]) {
    assert.throws(() => embeddingTunnelConfig(config, { ...env, XGIF_EMBEDDING_SSH_REMOTE_PORT: remotePort }), /CONFIG_INVALID/);
  }
  assert.throws(() => embeddingTunnelConfig({ ...config, endpoint: "https://other.example/api/embed" }, env), /CONFIG_INVALID/);
});

test("an existing service or tunnel is reused without owning or stopping it", async () => {
  let spawns = 0;
  const options = { spawnImpl: () => { spawns++; }, probe: async () => true };
  assert.equal(await withEmbeddingConnection(config, env, async () => 42, options), 42);
  assert.equal(await withEmbeddingConnection(config, {}, async () => 43, options), 43);
  assert.equal(spawns, 0);
});

test("an owned tunnel is closed after success and model failure without losing the result/error", async () => {
  for (const fail of [false, true]) {
    const child = childProcess();
    let spawned = false;
    const options = { probe: async () => spawned, spawnImpl: (file, args, options) => {
      assert.equal(file, "ssh");
      assert.ok(args.includes("BatchMode=yes"));
      assert.ok(args.includes("StrictHostKeyChecking=yes"));
      assert.ok(args.includes("127.0.0.1:11435:127.0.0.1:11434"));
      assert.equal(args.at(-1), "muze@m4.example");
      assert.equal(options.stdio, "ignore");
      spawned = true;
      return child;
    } };
    const run = () => withEmbeddingConnection(config, env, async () => {
      if (fail) throw new Error("model failed");
      return "ready";
    }, options);
    if (fail) await assert.rejects(run(), /model failed/);
    else assert.equal(await run(), "ready");
    assert.deepEqual(child.signals, ["SIGTERM"]);
  }
});

test("failed startup never runs inference and cleanup does not hang", async () => {
  const child = childProcess();
  const options = { probe: async () => false, startupTimeoutMs: 1, spawnImpl: () => child };
  let inferences = 0;
  await assert.rejects(withEmbeddingConnection(config, env, async () => { inferences++; }, options), /TUNNEL_UNAVAILABLE/);
  assert.equal(inferences, 0);
  assert.deepEqual(child.signals, ["SIGTERM"]);
  const failed = childProcess();
  await assert.rejects(withEmbeddingConnection(config, env, async () => { inferences++; }, {
    probe: async () => false,
    spawnImpl: () => { queueMicrotask(() => failed.emit("error", new Error("ssh unavailable"))); return failed; },
  }), /TUNNEL_UNAVAILABLE/);
  assert.equal(inferences, 0);
});

test("port probing detects a live loopback service and a closed listener", async () => {
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = { host: "127.0.0.1", port: server.address().port };
  try { assert.equal(await canConnect(address), true); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await canConnect(address), false);
});
