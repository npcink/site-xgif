export const HISTORY_KEY = "xgif:seen:v1";
const CONTENT_ID = /^\d{8}-[a-z0-9]{4}$/;
const MAX_HISTORY = 200;

export function readSeen(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && CONTENT_ID.test(id)).slice(-MAX_HISTORY) : []);
  } catch {
    return new Set();
  }
}

export function rememberSeen(seen, id, storage) {
  if (!CONTENT_ID.test(id || "")) return;
  seen.delete(id);
  seen.add(id);
  while (seen.size > MAX_HISTORY) seen.delete(seen.values().next().value);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify([...seen]));
  } catch {
    // The in-memory set still prevents loops when storage is unavailable.
  }
}

export function unseenRecommendations(ids, seen, limit) {
  return [...new Set(ids)].filter((id) => CONTENT_ID.test(id) && !seen.has(id)).slice(0, limit);
}
