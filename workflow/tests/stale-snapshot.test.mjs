import assert from "node:assert/strict";
import test from "node:test";
import { StaleSnapshot } from "../stale-snapshot.js";

test("stale snapshots return cached state immediately and refresh in the background", async () => {
  let now = 1_000;
  let loads = 0;
  let releaseRefresh;
  const snapshot = new StaleSnapshot({
    ttlMs: 100,
    now: () => now,
    load: async () => {
      loads += 1;
      if (loads === 1) return { version: 1 };
      await new Promise((resolve) => { releaseRefresh = resolve; });
      return { version: 2 };
    },
  });

  const first = await snapshot.get();
  assert.equal(first.version, 1);
  assert.deepEqual(first.statusMeta, {
    checkedAt: new Date(1_000).toISOString(),
    stale: false,
    refreshing: false,
  });

  now = 1_200;
  const stale = await snapshot.get();
  assert.equal(stale.version, 1);
  assert.equal(stale.statusMeta.stale, true);
  assert.equal(stale.statusMeta.refreshing, true);
  assert.equal(loads, 2);

  releaseRefresh();
  await snapshot.pending;
  const refreshed = await snapshot.get();
  assert.equal(refreshed.version, 2);
  assert.equal(refreshed.statusMeta.stale, false);
});

test("explicit refresh waits for current facts and invalidation removes old state", async () => {
  let now = 2_000;
  let version = 0;
  const snapshot = new StaleSnapshot({
    ttlMs: 1_000,
    now: () => now,
    load: async () => ({ version: ++version }),
  });

  assert.equal((await snapshot.get()).version, 1);
  assert.equal((await snapshot.get({ refresh: true })).version, 2);
  snapshot.invalidate();
  now = 3_000;
  const afterInvalidation = await snapshot.get();
  assert.equal(afterInvalidation.version, 3);
  assert.equal(afterInvalidation.statusMeta.checkedAt, new Date(3_000).toISOString());
});

test("invalidation during refresh cannot restore a pre-mutation snapshot", async () => {
  let loads = 0;
  let releaseOldLoad;
  const snapshot = new StaleSnapshot({
    ttlMs: 1_000,
    load: async () => {
      loads += 1;
      if (loads === 1) {
        await new Promise((resolve) => { releaseOldLoad = resolve; });
        return { version: "before-mutation" };
      }
      return { version: "after-mutation" };
    },
  });

  const initialRefresh = snapshot.get();
  await Promise.resolve();
  snapshot.invalidate();
  const currentRefresh = snapshot.get();
  releaseOldLoad();

  assert.equal((await currentRefresh).version, "after-mutation");
  assert.equal((await initialRefresh).version, "after-mutation");
  assert.equal((await snapshot.get()).version, "after-mutation");
  assert.equal(loads, 2);
});
