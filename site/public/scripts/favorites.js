import {
  favoriteKey,
  readFavorites,
  toggleFavorite,
  writeFavorites,
} from "./favorites-store.js";

const read = () => readFavorites(window.localStorage);

function updateInterface() {
  const { favorites, error } = read();
  const keys = new Set(favorites.items.map(favoriteKey));

  document.querySelectorAll("[data-favorites-count]").forEach((count) => {
    count.textContent = String(favorites.items.length);
    count.toggleAttribute("hidden", favorites.items.length === 0);
  });

  document.querySelectorAll("[data-favorite-toggle]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const key = `${button.dataset.contentKind}:${button.dataset.contentId}`;
    const isFavorite = keys.has(key);
    button.setAttribute("aria-pressed", String(isFavorite));
    const mark = button.querySelector(".favorite-toggle-mark");
    const label = button.querySelector("[data-favorite-label]");
    if (mark) mark.textContent = isFavorite ? "♥" : "♡";
    if (label) label.textContent = isFavorite ? "已收藏" : "收藏";
  });

  document.documentElement.toggleAttribute("data-favorites-unavailable", Boolean(error));
}

function announce(message) {
  let region = document.querySelector("[data-favorites-global-status]");
  if (!(region instanceof HTMLElement)) {
    region = document.createElement("p");
    region.className = "sr-only";
    region.dataset.favoritesGlobalStatus = "";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  window.requestAnimationFrame(() => {
    region.textContent = message;
  });
}

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-favorite-toggle]")
    : null;
  if (!(button instanceof HTMLButtonElement)) return;

  const input = {
    contentId: button.dataset.contentId ?? "",
    kind: button.dataset.contentKind ?? "",
    title: button.dataset.contentTitle ?? "",
    href: button.dataset.contentHref ?? "",
  };
  const current = read();
  if (current.error) {
    announce(current.error);
    return;
  }
  const next = toggleFavorite(current.favorites, input);
  const result = writeFavorites(next, window.localStorage);
  if (!result.ok) {
    announce(result.error);
    return;
  }

  updateInterface();
  const isFavorite = result.favorites.items.some((item) => favoriteKey(item) === favoriteKey(input));
  announce(isFavorite ? `已收藏：${input.title}` : `已取消收藏：${input.title}`);
  window.dispatchEvent(new CustomEvent("xgif:favorites-changed"));
});

window.addEventListener("storage", (event) => {
  if (event.key === "xgif:favorites:v1") updateInterface();
});
window.addEventListener("xgif:favorites-changed", updateInterface);

const dialogBody = document.querySelector("[data-detail-body]");
if (dialogBody) {
  new MutationObserver(updateInterface).observe(dialogBody, { childList: true });
}

updateInterface();
