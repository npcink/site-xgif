import assert from "node:assert/strict";
import test from "node:test";
import { updateOrphanObservations } from "../r2-orphan-policy.js";

const row = {
  objectKey: `memes/${"a".repeat(64)}.webp`,
  publicUrl: `https://img.xgif.cn/memes/${"a".repeat(64)}.webp`,
};

test("new R2 orphans are observed but cannot be deleted immediately", () => {
  const result = updateOrphanObservations({
    orphanRows: [row],
    now: new Date("2026-07-24T00:00:00Z"),
  });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.observations[row.objectKey].firstSeenAt, "2026-07-24T00:00:00.000Z");
});

test("only continuously observed R2 orphans become eligible after 30 days", () => {
  const result = updateOrphanObservations({
    current: {
      [row.objectKey]: { ...row, firstSeenAt: "2026-07-01T00:00:00.000Z" },
      "memes/gone.webp": { objectKey: "memes/gone.webp", firstSeenAt: "2026-01-01T00:00:00.000Z" },
    },
    orphanRows: [row],
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.deepEqual(result.eligible.map((item) => item.objectKey), [row.objectKey]);
  assert.equal("memes/gone.webp" in result.observations, false);
});
