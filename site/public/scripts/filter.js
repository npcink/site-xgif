import { createPagination, restoreListScroll, trackListScroll, writeListUrl } from "./list-pagination.js";

const input = document.querySelector("[data-filter-input]");
const items = Array.from(document.querySelectorAll("main [data-search-item]"));
const count = document.querySelector("[data-visible-count]");
const empty = document.querySelector("[data-empty]");
const chips = Array.from(document.querySelectorAll("[data-filter]"));
const mediaChips = Array.from(document.querySelectorAll("[data-media-filter]"));
const groups = Array.from(document.querySelectorAll("[data-search-group]"));
const sourceOnly = Boolean(document.querySelector('[data-filter-kind="source"]'));
const initialPath = location.pathname;
let chipFilter = "", mediaFilter = "";
const pagers = Array.from(document.querySelectorAll("[data-list-scope]")).map(root =>
  createPagination(root, (scrollY) => {
    apply({ push: true, scrollY });
    pagers.find(pager => pager.root === root).scrollToStart();
  }));
// Capture original membership: dialog recommendations are outside these lists.
const scopedItems = new Map(pagers.map(pager => [pager, items.filter(item => pager.root.contains(item))]));

function readUrl() {
  const params = new URLSearchParams(location.search);
  if (input instanceof HTMLInputElement) input.value = params.get("q") || "";
  chipFilter = params.get("source") || "";
  if (!chips.some(chip => (chip.dataset.filter || "") === chipFilter)) chipFilter = "";
  mediaFilter = mediaChips.length && ["static", "animated"].includes(params.get("media")) ? params.get("media") : "";
  pagers.forEach(pager => pager.readUrl());
}

function apply({ push = false, scrollY, write = true } = {}) {
  const query = input?.value.trim().toLowerCase() || "";
  const matches = items.filter(item => {
    const searchable = item.dataset.search || "";
    return searchable.includes(query) && (!chipFilter
      || (sourceOnly ? item.dataset.source === chipFilter : searchable.includes(chipFilter)))
      && (!mediaFilter || (item.dataset.mediaTypes || "").split(" ").includes(mediaFilter));
  });
  const visible = new Set(matches);
  for (const pager of pagers) {
    const members = scopedItems.get(pager);
    const filtered = matches.filter(item => members.includes(item));
    const { start, end } = pager.range(filtered.length);
    const pageItems = new Set(filtered.slice(start, end));
    members.forEach(item => { if (!pageItems.has(item)) visible.delete(item); });
    const groupCount = pager.root.querySelector("[data-group-count]");
    if (groupCount) groupCount.textContent = String(filtered.length);
  }
  items.forEach(item => { item.hidden = !visible.has(item); });
  groups.forEach(group => { group.hidden = !items.some(item => visible.has(item) && group.contains(item)); });
  if (count) count.textContent = String(matches.length);
  if (empty) empty.hidden = matches.length !== 0;

  if (write) {
    const url = new URL(location.href);
    if (query) url.searchParams.set("q", input.value.trim());
    else url.searchParams.delete("q");
    if (chipFilter) url.searchParams.set("source", chipFilter);
    else url.searchParams.delete("source");
    if (mediaFilter) url.searchParams.set("media", mediaFilter);
    else url.searchParams.delete("media");
    pagers.forEach(pager => pager.writeUrl(url));
    writeListUrl(url, push, scrollY);
  }
  mediaChips.forEach(chip => {
    const active = (chip.dataset.mediaFilter || "") === mediaFilter;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  chips.forEach(chip => {
    const active = (chip.dataset.filter || "") === chipFilter;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
}

const resetAndApply = () => { pagers.forEach(pager => pager.reset()); apply(); };
input?.addEventListener("input", resetAndApply);
document.querySelector("[data-clear]")?.addEventListener("click", () => {
  input.value = "";
  input.focus();
  resetAndApply();
});
chips.forEach(chip => chip.addEventListener("click", () => {
  chipFilter = chip.dataset.filter || "";
  resetAndApply();
}));
mediaChips.forEach(chip => chip.addEventListener("click", () => {
  mediaFilter = chip.dataset.mediaFilter || "";
  resetAndApply();
}));
window.addEventListener("popstate", event => {
  if (location.pathname !== initialPath || event.state?.detailDialog) return;
  readUrl();
  apply({ write: false });
  restoreListScroll(event.state);
});
window.addEventListener("pageshow", () => {
  if (location.pathname !== initialPath || history.state?.detailDialog) return;
  readUrl();
  apply();
});
readUrl();
apply();
trackListScroll();
document.documentElement.removeAttribute("data-filter-pending");
