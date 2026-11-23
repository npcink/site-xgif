import { createPagination, restoreListScroll, trackListScroll, writeListUrl } from "./list-pagination.js";
import { createCatalog } from "./catalog-loader.js";

const input = document.querySelector("[data-filter-input]");
const count = document.querySelector("[data-visible-count]");
const empty = document.querySelector("[data-empty]");
const sourceSelect = document.querySelector("[data-source-filter]");
const mediaChips = [...document.querySelectorAll("[data-media-filter]")];
const initialPath = location.pathname;
const status = document.querySelector("[data-catalog-status]");
const message = status?.querySelector("[data-catalog-message]");
const retry = status?.querySelector("[data-catalog-retry]");
const queryRequired = document.querySelector("[data-query-required]");
const browse = queryRequired?.querySelector("[data-search-browse]");
const jump = queryRequired?.querySelector("[data-search-jump]");
const announcement = queryRequired?.querySelector("[data-search-announcement]");
let shownQuery = "";
let appliedFilters = { query: "", source: "", media: "" };
let mediaFilter = "", generation = 0, pendingDialog = false, retryOptions = {};
const scopes = [...document.querySelectorAll("[data-list-scope]")].map(root => {
  const catalog = createCatalog(root);
  const pager = createPagination(root, (scrollY, focusResults) => apply({ push: true, scrollY, scrollRoot: root, focusResults }));
  return { catalog, pager };
});

function readUrl() {
  const params = new URLSearchParams(location.search);
  // Old image mood links used `source`; show that term in the search field.
  if (input instanceof HTMLInputElement) input.value = params.get("q") || (mediaChips.length ? params.get("source") : "") || "";
  if (sourceSelect) {
    sourceSelect.value = params.get("source") || "";
    if (sourceSelect.selectedIndex < 0) sourceSelect.value = "";
  }
  mediaFilter = mediaChips.length && ["static", "animated"].includes(params.get("media")) ? params.get("media") : "";
  scopes.forEach(({ pager }) => pager.readUrl());
}

function updateControls() {
  for (const button of mediaChips) {
    const active = (button.dataset.mediaFilter || "") === mediaFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function writeFilters(push = false, scrollY) {
  const url = new URL(location.href);
  for (const [key, value] of [["q", input?.value.trim()], ["source", sourceSelect?.value], ["media", mediaFilter]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  scopes.forEach(({ pager }) => pager.writeUrl(url));
  writeListUrl(url, push, scrollY);
}

async function apply({ push = false, scrollY, write = true, scrollRoot, restore, focusResults, fromRetry = false } = {}) {
  const run = ++generation;
  const isCurrent = () => run === generation;
  document.documentElement.removeAttribute("data-catalog-ready");
  const query = input?.value.trim().toLowerCase() || "";
  const idle = queryRequired && !query;
  const source = sourceSelect?.value || "";
  const filters = { query, source, media: mediaFilter, sourceOnly: Boolean(sourceSelect) };
  const changingFilters = query !== appliedFilters.query || source !== appliedFilters.source || mediaFilter !== appliedFilters.media;
  updateControls();
  try {
    if (browse) browse.hidden = !idle;
    if (queryRequired && query !== shownQuery) {
      scopes.forEach(({ catalog }) => { catalog.root.hidden = true; });
      jump.hidden = true;
      announcement.hidden = true;
      empty.hidden = true;
    }
    // The default first page is already rendered. Browsing it requires no index request.
    const unchanged = !queryRequired && !query && !source && !mediaFilter && scopes.every(({ pager }) => pager.page() === 1);
    const initial = unchanged && scopes.every(({ catalog }) => !catalog.root.hasAttribute("data-catalog-loaded"));
    let results;
    if (idle) {
      results = scopes.map(scope => ({ ...scope, total: 0, nodes: scope.catalog.grid.childElementCount ? [] : null }));
    } else if (initial) {
      results = scopes.map(scope => ({ ...scope, total: scope.catalog.total, nodes: null }));
    } else {
      if (status) status.hidden = false;
      if (message) message.textContent = changingFilters && !queryRequired && !document.documentElement.hasAttribute("data-filter-pending") && !document.documentElement.hasAttribute("data-filter-unavailable")
        ? "正在加载结果，暂显示上次结果…" : "正在加载结果…";
      if (retry) {
        retry.hidden = !fromRetry;
        retry.setAttribute("aria-disabled", "true");
      }
      scopes.forEach(({ catalog, pager }) => {
        catalog.root.setAttribute("aria-busy", "true");
        pager.setBusy(true);
      });
      results = await Promise.all(scopes.map(async scope => {
        const matches = await scope.catalog.matches(filters);
        if (!isCurrent()) return null;
        const { start, end } = scope.pager.bounds(matches.length);
        const selected = matches.slice(start, end);
        const ids = [...scope.catalog.grid.children].map(card => card.dataset.catalogId);
        const same = ids.length === selected.length && selected.every((item, index) => item.id === ids[index]);
        return { ...scope, total: matches.length, nodes: same ? null : await scope.catalog.nodes(selected, isCurrent) };
      }));
    }
    if (run !== generation) return;
    if (location.pathname !== initialPath || history.state?.detailDialog) { pendingDialog = true; return; }
    const moveFocus = focusResults && (scrollRoot?.querySelector("[data-pagination]")?.contains(document.activeElement) || document.activeElement === retry);
    let total = 0, changed = false;
    for (const { catalog, pager, nodes, total: matched } of results) {
      const searchGroup = catalog.root.hasAttribute("data-search-group");
      pager.range(matched);
      if (nodes) { catalog.grid.replaceChildren(...nodes); changed = true; }
      if (!initial && !idle) catalog.root.dataset.catalogLoaded = "";
      if (searchGroup) {
        catalog.root.hidden = matched === 0;
        catalog.root.querySelector("[data-group-count]").textContent = String(matched);
      }
      total += matched;
    }
    if (count) count.textContent = String(total);
    if (empty) empty.hidden = Boolean(idle) || total !== 0;
    if (queryRequired) {
      shownQuery = query;
      jump.hidden = !results.every(({ total }) => total > 0);
      announcement.hidden = Boolean(idle);
    }
    if (write) writeFilters(push, scrollY);
    appliedFilters = filters;
    document.documentElement.removeAttribute("data-filter-unavailable");
    if (status) status.hidden = true;
    if (changed) window.dispatchEvent(new CustomEvent("xgif:list-updated"));
    if (scrollRoot) scopes.find(({ catalog }) => catalog.root === scrollRoot).pager.scrollToStart(moveFocus);
    if (restore) restoreListScroll(restore);
  } catch {
    if (run !== generation) return;
    retryOptions = { push, scrollY, write, scrollRoot, restore };
    if (status) status.hidden = false;
    document.documentElement.toggleAttribute("data-filter-unavailable", changingFilters);
    if (message) message.textContent = changingFilters
      ? queryRequired ? "搜索结果加载失败，请重试。" : "筛选结果加载失败，当前筛选尚未生效。请重试。"
      : "加载未完成，当前内容已保留。请重试；如果页面刚更新，也可以刷新后再试。";
    if (retry) retry.hidden = false;
    status?.scrollIntoView({ block: "nearest", behavior: "instant" });
  } finally {
    if (run === generation) {
      scopes.forEach(({ catalog, pager }) => {
        catalog.root.removeAttribute("aria-busy");
        pager.setBusy(false);
      });
      retry?.removeAttribute("aria-disabled");
      document.documentElement.removeAttribute("data-filter-pending");
      document.documentElement.setAttribute("data-catalog-ready", "");
    }
  }
}

const resetAndApply = () => {
  scopes.forEach(({ pager }) => pager.reset());
  // Preserve requested filters even if their indexes fail to load. Page changes
  // still commit their URL only after their cards are ready.
  writeFilters();
  void apply();
};
jump?.addEventListener("click", event => {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target || target.hidden) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
});
input?.addEventListener("input", resetAndApply);
document.querySelector("[data-clear]")?.addEventListener("click", () => {
  input.value = ""; input.focus(); resetAndApply();
});
sourceSelect?.addEventListener("change", resetAndApply);
mediaChips.forEach(chip => chip.addEventListener("click", () => { mediaFilter = chip.dataset.mediaFilter || ""; resetAndApply(); }));
retry?.addEventListener("click", event => {
  if (retry.getAttribute("aria-disabled") === "true") return;
  const focusResults = event.detail === 0;
  const scrollRoot = retryOptions.scrollRoot || (focusResults && scopes.length === 1 ? scopes[0].catalog.root : undefined);
  void apply({ ...retryOptions, scrollRoot, focusResults, fromRetry: true });
});
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
// The server cards are page one. Set up their controls before reading a requested URL page.
if (!queryRequired) scopes.forEach(({ catalog, pager }) => {
  pager.reset();
  pager.range(catalog.total);
});
readUrl();
document.querySelectorAll("[data-filter-controls]").forEach(control => { control.hidden = false; });
if (sourceSelect) sourceSelect.hidden = false;
void apply();
trackListScroll();
