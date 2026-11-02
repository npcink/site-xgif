export const METRICS_KEY = "xgif:discovery-metrics:v1";
const FIELDS = ["articleViews", "imageViews", "repeatViews", "recommendationImpressions", "recommendationClicks", "reachedEnd"];

export function readMetrics(storage) {
  let value = {};
  try { value = JSON.parse(storage.getItem(METRICS_KEY) || "{}"); } catch { /* Start a fresh local session. */ }
  return Object.fromEntries(FIELDS.map((key) => [key,
    Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? Math.min(value[key], 1_000_000) : 0,
  ]));
}

export function incrementMetric(metrics, key, storage) {
  if (!FIELDS.includes(key)) return;
  metrics[key] = Math.min(metrics[key] + 1, 1_000_000);
  try { storage.setItem(METRICS_KEY, JSON.stringify(metrics)); } catch { /* Counts remain available in memory. */ }
}
