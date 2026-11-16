const reply = (status, code) => new Response(code ? JSON.stringify({ error: { code } }) : null, {
  status, headers: { "cache-control": "no-store", "content-type": "application/json", "x-content-type-options": "nosniff" },
});

async function smallJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256) { await reader.cancel(); return null; }
      chunks.push(...value);
    }
    return JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)));
  } catch { return null; }
}

export async function recordFavorite(request, env, now = new Date()) {
  const url = new URL(request.url);
  if (url.origin !== env.METRICS_ORIGIN || request.headers.get("origin") !== url.origin
    || ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) return reply(403, "ORIGIN_NOT_ALLOWED");
  if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415, "JSON_REQUIRED");
  const event = await smallJson(request);
  if (!event || typeof event !== "object" || Array.isArray(event)
    || Object.keys(event).sort().join(",") !== "action,contentId,kind"
    || !/^\d{8}-[a-z0-9]{4}$/u.test(event.contentId)
    || !["article", "image"].includes(event.kind) || !["add", "remove"].includes(event.action)) return reply(400, "INVALID_EVENT");
  if (!env.FAVORITE_STATS || !env.ASSETS) return reply(503, "METRICS_UNAVAILABLE");
  try {
    const catalog = await env.ASSETS.fetch(new Request(new URL("/favorite-catalog.json", url)));
    if (!catalog.ok) return reply(503, "CATALOG_UNAVAILABLE");
    const published = await catalog.json();
    if (published[event.contentId] !== event.kind) return reply(404, "CONTENT_NOT_PUBLISHED");
    // One indexed daily aggregate, with no visitor ID, IP, title, query or referrer.
    const added = event.action === "add" ? 1 : 0;
    await env.FAVORITE_STATS.prepare(`INSERT INTO favorite_daily (day, kind, content_id, adds, removes)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, kind, content_id)
      DO UPDATE SET adds = adds + excluded.adds, removes = removes + excluded.removes`)
      .bind(now.toISOString().slice(0, 10), event.kind, event.contentId, added, 1 - added).run();
    return reply(204);
  } catch { return reply(503, "METRICS_UNAVAILABLE"); }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/favorites/events") return recordFavorite(request, env);
    return env.ASSETS.fetch(request);
  },
};
