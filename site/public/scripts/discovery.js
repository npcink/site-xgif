import { readSeen, rememberSeen, unseenRecommendations } from "./discovery-store.js";
import { readMetrics, incrementMetric } from "./discovery-metrics.js";

let storage;
try { storage = window.sessionStorage; } catch { /* Keep browsing without storage. */ }
const seen = readSeen(storage);
const metrics = readMetrics(storage);
const opened = new WeakSet();
const exposed = new WeakSet();
const clicked = new WeakSet();
const completed = new WeakSet();
const count = (key) => incrementMetric(metrics, key, storage);
const active = (element) => {
  const dialog = document.querySelector("[data-detail-dialog][open]");
  return document.visibilityState === "visible" && (!dialog || dialog.contains(element));
};

const impressionObserver = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting, intersectionRatio } of entries) {
    if (!isIntersecting || intersectionRatio < 0.5 || !active(target) || exposed.has(target)) continue;
    exposed.add(target);
    impressionObserver.unobserve(target);
    count("recommendationImpressions");
  }
}, { threshold: 0.5 });

const endTimers = new Map();
const endObserver = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting, intersectionRatio } of entries) {
    clearTimeout(endTimers.get(target));
    endTimers.delete(target);
    if (!isIntersecting || intersectionRatio < 1 || !active(target) || completed.has(target)) continue;
    endTimers.set(target, setTimeout(() => {
      endTimers.delete(target);
      if (!target.isConnected || !active(target)) return;
      completed.add(target);
      endObserver.unobserve(target);
      const card = target.closest("[data-inline-content-id]");
      if (card && !opened.has(card)) {
        opened.add(card);
        if (seen.has(card.dataset.inlineContentId)) count("repeatViews");
        rememberSeen(seen, card.dataset.inlineContentId, storage);
        count("articleViews");
      }
      count("reachedEnd");
    }, 1500));
  }
}, { threshold: 1 });

function updateRecommendations(root = document) {
  root.querySelectorAll("[data-recommendations]").forEach((section) => {
    const items = [...section.querySelectorAll("[data-recommendation-id]")];
    const selected = new Set(unseenRecommendations(
      items.map((item) => item.dataset.recommendationId),
      seen,
      Number(section.dataset.recommendationLimit) || 3,
    ));
    items.forEach((item) => { item.hidden = !selected.has(item.dataset.recommendationId); });

    const empty = section.querySelector("[data-recommendations-empty]");
    if (empty) empty.hidden = selected.size > 0;
  });
}

function refreshObservers() {
  impressionObserver.disconnect();
  endObserver.disconnect();
  for (const timer of endTimers.values()) clearTimeout(timer);
  endTimers.clear();
  if (document.visibilityState !== "visible") return;
  const root = document.querySelector("[data-detail-dialog][open]") || document;
  root.querySelectorAll("[data-recommendation-id]:not([hidden])").forEach((item) => {
    if (!exposed.has(item)) impressionObserver.observe(item);
  });
  root.querySelectorAll("[data-reading-end]").forEach((end) => {
    if (!completed.has(end)) endObserver.observe(end);
  });
}

function openContent(root) {
  const content = root.querySelector("[data-detail-content][data-content-id]");
  if (content && !opened.has(content)) {
    opened.add(content);
    if (seen.has(content.dataset.contentId)) count("repeatViews");
    rememberSeen(seen, content.dataset.contentId, storage);
    count(content.dataset.detailKind === "image" ? "imageViews" : "articleViews");
  }
  updateRecommendations();
  refreshObservers();
}

window.addEventListener("xgif:detail-opened", (event) => openContent(event.detail.root));
window.addEventListener("xgif:detail-closed", () => { updateRecommendations(); refreshObservers(); });
document.addEventListener("visibilitychange", refreshObservers);
window.addEventListener("pagehide", () => {
  impressionObserver.disconnect();
  endObserver.disconnect();
  for (const timer of endTimers.values()) clearTimeout(timer);
  endTimers.clear();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && storage) {
    for (const id of readSeen(storage)) seen.add(id);
    Object.assign(metrics, readMetrics(storage));
  }
  openContent(document);
});
openContent(document);

document.addEventListener("click", (event) => {
  const item = event.target instanceof Element ? event.target.closest("a[data-recommendation-id]") : null;
  if (!item || clicked.has(item)) return;
  clicked.add(item);
  if (!exposed.has(item)) {
    exposed.add(item);
    count("recommendationImpressions");
  }
  count("recommendationClicks");
});
