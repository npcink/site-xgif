// Aggregate successful explicit actions only; never upload the local collection.
export function trackFavoriteAction(item, action, { window: browser = window, document: page = document, navigator: agent = navigator } = {}) {
  const origin = page.querySelector('meta[name="xgif-favorite-metrics-origin"]')?.content;
  if (!origin || browser.location.origin !== origin || browser.location.pathname.startsWith("/preview/")
    || agent.doNotTrack === "1" || agent.globalPrivacyControl === true
    || !/^\d{8}-[a-z0-9]{4}$/u.test(item.contentId)
    || !["article", "image"].includes(item.kind) || !["add", "remove"].includes(action)) return;
  try {
    // No retries: analytics failure must not delay or undo a local favorite.
    const pending = browser.fetch("/api/favorites/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: item.contentId, kind: item.kind, action }),
      credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
    });
    pending.catch(() => {});
  } catch { /* Local favorites remain usable when reporting is unavailable. */ }
}
