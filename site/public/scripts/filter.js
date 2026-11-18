import { createPagination, restoreListScroll, trackListScroll, writeListUrl } from "./list-pagination.js";
import { createCatalog } from "./catalog-loader.js";

const input = document.querySelector("[data-filter-input]");
const count = document.querySelector("[data-visible-count]");
const empty = document.querySelector("[data-empty]");
const chips = [...document.querySelectorAll("[data-filter]")];
const mediaChips = [...document.querySelectorAll("[data-media-filter]")];
const sourceOnly = Boolean(document.querySelector('[data-filter-kind="source"]'));
const initialPath = location.pathname;
const status = document.querySelector("[data-catalog-status]");
const message = status?.querySelector("[data-catalog-message]");
const retry = status?.querySelector("[data-catalog-retry]");
let chipFilter = "", mediaFilter = "", generation = 0, pendingDialog = false, retryOptions = {};
const scopes = [...document.querySelectorAll("[data-list-scope]")].map(root => {
  const catalog = createCatalog(root);
  const pager = createPagination(root, scrollY => apply({ push: true, scrollY, scrollRoot: root }));
  return { catalog, pager };
});

function readUrl() {
  const params = new URLSearchParams(location.search);
  // Old image mood links used `source`; show that term in the search field.
  if (input instanceof HTMLInputElement) input.value = params.get("q") || (mediaChips.length ? params.get("source") : "") || "";
  chipFilter = params.get("source") || "";
  if (!chips.some(chip => (chip.dataset.filter || "") === chipFilter)) chipFilter = "";
  mediaFilter = mediaChips.length && ["static", "animated"].includes(params.get("media")) ? params.get("media") : "";
  scopes.forEach(({ pager }) => pager.readUrl());
}

function updateControls() {
  for (const [buttons, value, key] of [[chips, chipFilter, "filter"], [mediaChips, mediaFilter, "mediaFilter"]]) {
    buttons.forEach(button => {
      const active = (button.dataset[key] || "") === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
}

async function apply({ push = false, scrollY, write = true, scrollRoot, restore } = {}) {
  const run = ++generation;
  document.documentElement.removeAttribute("data-catalog-ready");
  const query = input?.value.trim().toLowerCase() || "";
  const filters = { query, source: chipFilter, media: mediaFilter, sourceOnly };
  updateControls();
  try {
    // The default first page is already rendered. Browsing it requires no index request.
    const unchanged = !query && !chipFilter && !mediaFilter && scopes.every(({ pager }) => pager.page() === 1);
    const initial = unchanged && scopes.every(({ catalog }) => !catalog.root.hasAttribute("data-catalog-loaded"));
    let results;
    if (initial) {
      results = scopes.map(scope => ({ ...scope, total: scope.catalog.total, nodes: null }));
    } else {
      if (status) status.hidden = false;
      if (message) message.textContent = "正在加载结果…";
      if (retry) retry.hidden = true;
      scopes.forEach(({ catalog }) => catalog.root.setAttribute("aria-busy", "true"));
      results = await Promise.all(scopes.map(async scope => {
        const matches = await scope.catalog.matches(filters);
        const { start, end } = scope.pager.bounds(matches.length);
        const selected = matches.slice(start, end);
        const ids = [...scope.catalog.grid.children].map(card => card.dataset.catalogId);
        const same = ids.length === selected.length && selected.every((item, index) => item.id === ids[index]);
        return { ...scope, total: matches.length, nodes: same ? null : await scope.catalog.nodes(selected) };
      }));
    }
    if (run !== generation) return;
    if (location.pathname !== initialPath || history.state?.detailDialog) { pendingDialog = true; return; }
    let total = 0, changed = false;
    for (const { catalog, pager, nodes, total: matched } of results) {
      pager.range(matched);
      if (nodes) { catalog.grid.replaceChildren(...nodes); changed = true; }
      if (!initial) catalog.root.dataset.catalogLoaded = "";
      if (catalog.root.hasAttribute("data-search-group")) catalog.root.hidden = matched === 0;
      const groupCount = catalog.root.querySelector("[data-group-count]");
      if (groupCount) groupCount.textContent = String(matched);
      total += matched;
    }
    if (count) count.textContent = String(total);
    if (empty) empty.hidden = total !== 0;
    if (write) {
      const url = new URL(location.href);
      for (const [key, value] of [["q", input?.value.trim()], ["source", chipFilter], ["media", mediaFilter]]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      scopes.forEach(({ pager }) => pager.writeUrl(url));
      writeListUrl(url, push, scrollY);
    }
    if (status) status.hidden = true;
    if (changed) window.dispatchEvent(new CustomEvent("xgif:list-updated"));
    if (scrollRoot) scopes.find(({ catalog }) => catalog.root === scrollRoot).pager.scrollToStart();
    if (restore) restoreListScroll(restore);
  } catch {
    if (run !== generation) return;
    retryOptions = { push, scrollY, write, scrollRoot, restore };
    if (status) status.hidden = false;
    if (message) message.textContent = "加载未完成，当前内容已保留。请重试；如果页面刚更新，也可以刷新后再试。";
    if (retry) retry.hidden = false;
    status?.scrollIntoView({ block: "nearest", behavior: "instant" });
  } finally {
    if (run === generation) {
      scopes.forEach(({ catalog }) => catalog.root.removeAttribute("aria-busy"));
      document.documentElement.removeAttribute("data-filter-pending");
      document.documentElement.setAttribute("data-catalog-ready", "");
    }
  }
}

const resetAndApply = () => { scopes.forEach(({ pager }) => pager.reset()); void apply(); };
input?.addEventListener("input", resetAndApply);
document.querySelector("[data-clear]")?.addEventListener("click", () => {
  input.value = ""; input.focus(); resetAndApply();
});
chips.forEach(chip => chip.addEventListener("click", () => { chipFilter = chip.dataset.filter || ""; resetAndApply(); }));
mediaChips.forEach(chip => chip.addEventListener("click", () => { mediaFilter = chip.dataset.mediaFilter || ""; resetAndApply(); }));
retry?.addEventListener("click", () => { void apply(retryOptions); });
window.addEventListener("popstate", event => {
  if (location.pathname !== initialPath || event.state?.detailDialog) return;
  readUrl(); void apply({ write: false, restore: event.state });
});
window.addEventListener("pageshow", event => {
  if (!event.persisted || location.pathname !== initialPath || history.state?.detailDialog) return;
  readUrl(); void apply();
});
window.addEventListener("xgif:detail-closed", () => {
  if (pendingDialog) { pendingDialog = false; void apply(); }
});
readUrl();
void apply();
trackListScroll();
