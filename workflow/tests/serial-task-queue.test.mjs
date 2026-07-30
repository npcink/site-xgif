import assert from "node:assert/strict";
import test from "node:test";
import { SerialTaskQueue } from "../serial-task-queue.js";

test("serial task queue prevents overlapping mutations and continues after failure", async () => {
  const queue = new SerialTaskQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.run(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    throw new Error("expected failure");
  });
  const second = queue.run(async () => {
    events.push("second:start");
    events.push("second:end");
    return "ok";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await assert.rejects(first, /expected failure/u);
  assert.equal(await second, "ok");
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.pending, 0);
});
