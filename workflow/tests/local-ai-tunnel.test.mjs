import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { LocalAiTunnel } from "../local-ai-tunnel.js";

test("a working local endpoint is reused without starting SSH", async () => {
  const tunnel = new LocalAiTunnel({ baseUrl: "http://127.0.0.1:11436/v1", host: "muze@m4",
    fetchImpl: async () => ({ ok: true }), spawnImpl: () => { throw new Error("must not spawn"); } });
  await tunnel.ensure();
  tunnel.close();
});

test("concurrent requests share one reconnect and only its own process is stopped", async () => {
  let alive = false, spawns = 0, kills = 0;
  const tunnel = new LocalAiTunnel({ baseUrl: "http://127.0.0.1:11436/v1", host: "muze@m4",
    fetchImpl: async () => ({ ok: alive }),
    spawnImpl: (command, args, options) => {
      assert.equal(command, "ssh");
      assert.ok(args.includes("127.0.0.1:11436:127.0.0.1:11434"));
      assert.equal(options.stdio, "ignore");
      spawns++; alive = true;
      const child = new EventEmitter();
      child.kill = () => { kills++; alive = false; child.emit("exit", 0); };
      return child;
    },
  });
  await Promise.all([tunnel.ensure(), tunnel.ensure()]);
  assert.equal(spawns, 1);
  tunnel.close(); assert.equal(kills, 1);
  await tunnel.ensure(); assert.equal(spawns, 2);
  tunnel.close();
});

test("SSH settings cannot select external endpoints or inject command options", async () => {
  for (const [baseUrl, host] of [["https://example.com/v1", "muze@m4"], ["http://127.0.0.1:11436/v1", "-o ProxyCommand=bad"]]) {
    const tunnel = new LocalAiTunnel({ baseUrl, host, spawnImpl: () => { throw new Error("must not spawn"); } });
    await assert.rejects(tunnel.ensure(), /隧道配置无效/);
  }
});
