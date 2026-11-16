import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker, { recordFavorite } from "../worker/index.mjs";
import { trackFavoriteAction } from "../public/scripts/favorite-metrics.js";

const origin = "https://www.xgif.cn", id = "20261112-8jzn";
const valid = { contentId: id, kind: "image", action: "add" };
const request = (body = valid, headers = {}, method = "POST", host = origin) => new Request(`${host}/api/favorites/events`, {
  method, headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.1", ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
async function fixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(await readFile(new URL("../migrations/0001_favorite_daily.sql", import.meta.url), "utf8"));
  const allow = { limit: async () => ({ success: true }) };
  const env = { METRICS_ORIGIN: origin, FAVORITE_METRICS_ENABLED: "true",
    FAVORITE_IP_LIMIT: allow, FAVORITE_CONTENT_LIMIT: allow, FAVORITE_WRITE_LIMIT: allow,
    ASSETS: { fetch: async () => Response.json({ [id]: "image" }) },
    FAVORITE_STATS: { prepare: sql => ({ bind: (...args) => ({ run: () => db.prepare(sql).run(...args) }) }) },
  };
  return { db, env };
}

test("favorite events aggregate by UTC day and content with no visitor fields", async t => {
  const { db, env } = await fixture(t);
  const when = new Date("2026-11-16T23:59:00Z");
  for (const action of ["add", "remove", "add"]) assert.equal((await recordFavorite(request({ ...valid, action }), env, when)).status, 204);
  assert.deepEqual({ ...db.prepare("SELECT * FROM favorite_daily").get() }, { day: "2026-11-16", kind: "image", content_id: id, adds: 2, removes: 1 });
  await recordFavorite(request(), env, new Date("2026-11-17T00:01:00Z"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorite_daily").get().n, 2);
});

test("the event API rejects unpublished IDs, forged origins, malformed and oversized payloads before writing", async t => {
  const { db, env } = await fixture(t);
  for (const [req, status] of [
    [request(valid, { origin: "https://evil.example" }), 403],
    [request(valid, {}, "POST", "https://preview.workers.dev"), 403],
    [request(valid, { "sec-fetch-site": "cross-site" }), 403],
    [request(valid, {}, "GET"), 405],
    [new Request(origin + "/api/favorites/events?ignored=1", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(valid) }), 400],
    [request(valid, { "content-type": "text/plain" }), 415],
    [request({ ...valid, contentId: "20990101-drft" }), 404],
    [request({ ...valid, kind: "article" }), 404],
    [request({ ...valid, action: "like" }), 400],
    [request({ ...valid, title: "private" }), 400],
    [request(null), 400], [request([valid]), 400],
    [request({ ...valid, contentId: [id] }), 400],
    [request({ ...valid, extra: "a".repeat(500) }), 400],
  ]) assert.equal((await recordFavorite(req, env)).status, status);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorite_daily").get().n, 0);
});

test("statistics errors remain explicit while static assets retain their routing", async t => {
  const { env } = await fixture(t);
  assert.equal((await recordFavorite(request(), { ...env, FAVORITE_STATS: undefined })).status, 503);
  const failed = await recordFavorite(request(), { ...env, FAVORITE_STATS: { prepare() { throw new Error("private credentials"); } } });
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("private"));
  const page = new Request(origin + "/images");
  assert.equal(await (await worker.fetch(page, { ASSETS: { fetch: async req => new Response(new URL(req.url).pathname) } })).text(), "/images");
});

test("client reports only action metadata on production and keeps local favorites independent of delivery", () => {
  const sent = [];
  const page = { querySelector: () => ({ content: origin }) };
  const browser = { location: { origin, pathname: "/images" }, fetch: (url, config) => { sent.push({ url, config }); return Promise.reject(new Error("offline")); } };
  const options = { document: page, window: browser, navigator: {} };
  trackFavoriteAction({ ...valid, title: "not sent", href: "/private" }, "add", options);
  assert.equal(sent.length, 1); assert.deepEqual(JSON.parse(sent[0].config.body), valid);
  assert.equal(sent[0].config.credentials, "omit"); assert.equal(sent[0].config.referrerPolicy, "no-referrer");
  for (const location of [{ origin: "http://localhost:4321", pathname: "/images" }, { origin, pathname: "/preview/articles/20990101-drft" }]) {
    trackFavoriteAction(valid, "remove", { ...options, window: { ...browser, location } });
  }
  for (const navigator of [{ doNotTrack: "1" }, { globalPrivacyControl: true }]) trackFavoriteAction(valid, "add", { ...options, navigator });
  assert.equal(sent.length, 1);
  assert.doesNotThrow(() => trackFavoriteAction(valid, "remove", { ...options, window: { ...browser, fetch() { throw new Error("blocked"); } } }));
});

test("rate limits reject bursts before D1 writes, with independent address and content keys", async t => {
  const { db, env } = await fixture(t);
  const counters = new Map();
  const limiter = (name, limit) => ({ limit: async ({ key }) => {
    const bucket = `${name}:${key}`;
    const n = (counters.get(bucket) || 0) + 1; counters.set(bucket, n);
    return { success: n <= limit };
  } });
  env.FAVORITE_IP_LIMIT = limiter("ip", 30);
  env.FAVORITE_CONTENT_LIMIT = limiter("content", 6);
  env.FAVORITE_WRITE_LIMIT = limiter("writes", 120);
  for (let n = 0; n < 6; n++) assert.equal((await recordFavorite(request(), env)).status, 204);
  const blocked = await recordFavorite(request(), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.equal(db.prepare("SELECT adds FROM favorite_daily").get().adds, 6);
  assert.equal((await recordFavorite(request(valid, { "cf-connecting-ip": "192.0.2.2" }), env)).status, 204);
  assert.ok(![...counters.keys()].some(key => key.includes("forwarded")));
  env.FAVORITE_IP_LIMIT = { limit: async () => ({ success: false }) };
  env.ASSETS = { fetch: () => { throw new Error("must not fetch catalog"); } };
  assert.equal((await recordFavorite(request(), env)).status, 429);
  assert.equal(db.prepare("SELECT adds FROM favorite_daily").get().adds, 7);
});

test("aggregate write throttle, unavailable protection and emergency stop never write to D1", async t => {
  const { db, env } = await fixture(t);
  const deny = { limit: async () => ({ success: false }) };
  for (const binding of ["FAVORITE_IP_LIMIT", "FAVORITE_CONTENT_LIMIT", "FAVORITE_WRITE_LIMIT"]) {
    assert.equal((await recordFavorite(request(), { ...env, [binding]: deny })).status, 429);
    assert.equal((await recordFavorite(request(), { ...env, [binding]: undefined })).status, 503);
    const response = await recordFavorite(request(), { ...env, [binding]: { limit() { throw new Error("private token"); } } });
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private"));
  }
  for (const enabled of [undefined, "false"]) assert.equal((await recordFavorite(request(), { ...env, FAVORITE_METRICS_ENABLED: enabled })).status, 503);
  const missingAddress = new Request(origin + "/api/favorites/events", { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.3" }, body: JSON.stringify(valid) });
  assert.equal((await recordFavorite(missingAddress, env)).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorite_daily").get().n, 0);
});

test("the address limit applies to invalid payloads and cannot be reset with X-Forwarded-For", async t => {
  const { db, env } = await fixture(t);
  const keys = [];
  env.FAVORITE_IP_LIMIT = { limit: async ({ key }) => { keys.push(key); return { success: keys.length <= 30 }; } };
  for (let n = 0; n < 30; n++) assert.equal((await recordFavorite(request(null, { "x-forwarded-for": `198.51.100.${n}` }), env)).status, 400);
  assert.equal((await recordFavorite(request(null, { "x-forwarded-for": "203.0.113.99" }), env)).status, 429);
  assert.deepEqual([...new Set(keys)], ["favorites:192.0.2.1"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorite_daily").get().n, 0);
});
