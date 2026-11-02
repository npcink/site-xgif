import { readSeen, rememberSeen, unseenRecommendations } from "./discovery-store.js";

let storage;
try { storage = window.sessionStorage; } catch { /* Keep browsing without storage. */ }
const seen = readSeen(storage);

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

function openContent(root) {
  const content = root.querySelector("[data-detail-content][data-content-id]");
  if (content) rememberSeen(seen, content.dataset.contentId, storage);
  updateRecommendations();
}

window.addEventListener("xgif:detail-opened", (event) => openContent(event.detail.root));
window.addEventListener("pageshow", () => openContent(document));
openContent(document);
