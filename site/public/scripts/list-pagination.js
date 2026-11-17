// Shared by static filtered lists and the browser-local favorites list.
const scrollPositions = new Map();

export function createPagination(root, onChange) {
  const nav = root.querySelector("[data-pagination]");
  const summary = root.querySelector("[data-page-summary]");
  const size = Number(nav.dataset.pageSize);
  const parameter = nav.dataset.pageParam || "page";
  let current = 1;
  let rendered = 1, busy = false;
  const readUrl = () => {
    const value = Number(new URLSearchParams(location.search).get(parameter) || 1);
    current = Number.isSafeInteger(value) && value > 0 ? value : 1;
  };
  readUrl();

  nav.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.disabled || busy) return;
    current = rendered;
    if (button.hasAttribute("data-page-prev")) current -= 1;
    else if (button.hasAttribute("data-page-next")) current += 1;
    else if (button.dataset.page) current = Number(button.dataset.page);
    else return;
    busy = true;
    Promise.resolve(onChange(window.scrollY)).finally(() => { busy = false; });
  });

  return {
    root,
    readUrl,
    reset: () => { current = 1; },
    page: () => current,
    bounds(total) {
      const page = Math.min(current, Math.max(1, Math.ceil(total / size)));
      return { start: (page - 1) * size, end: Math.min(page * size, total) };
    },
    range(total) {
      const pages = Math.max(1, Math.ceil(total / size));
      current = Math.min(current, pages);
      rendered = current;
      const start = (current - 1) * size;
      const end = Math.min(start + size, total);
      nav.hidden = pages <= 1;
      nav.querySelector("[data-page-prev]").disabled = current <= 1;
      nav.querySelector("[data-page-next]").disabled = current >= pages;
      const visible = [...new Set([1, current - 1, current, current + 1, pages])]
        .filter(page => page >= 1 && page <= pages).sort((a, b) => a - b);
      const numbers = nav.querySelector("[data-page-numbers]");
      const focusedPage = numbers.contains(document.activeElement) ? document.activeElement.dataset.page : null;
      numbers.innerHTML = visible.map((page, index) =>
        `${index && page - visible[index - 1] > 1 ? '<span class="page-gap" aria-hidden="true">…</span>' : ""}<button type="button" data-page="${page}"${page === current ? ' class="active" aria-current="page"' : ""} aria-label="第 ${page} 页">${page}</button>`).join("");
      if (focusedPage && !nav.hidden) {
        (numbers.querySelector(`[data-page="${focusedPage}"]`) || numbers.querySelector('[aria-current="page"]'))
          ?.focus({ preventScroll: true });
      }
      if (summary) summary.textContent = `显示 ${total ? start + 1 : 0}–${end}，共 `;
      return { start, end };
    },
    writeUrl(url) {
      if (current > 1) url.searchParams.set(parameter, String(current));
      else url.searchParams.delete(parameter);
    },
    scrollToStart() {
      (root.querySelector(".archive-toolbar, .content-title, .favorites-toolbar") || root)
        .scrollIntoView({ block: "start", behavior: "instant" });
      history.replaceState({ ...history.state, listScrollY: window.scrollY }, "", location.href);
    },
  };
}

export function writeListUrl(url, push = false, scrollY = window.scrollY) {
  if (url.href === location.href) return;
  if (push) {
    history.replaceState({ ...history.state, detailDialogBase: false, listScrollY: scrollY }, "", location.href);
    history.pushState({ ...history.state, detailDialog: false, detailDialogBase: false, listEntry: crypto.randomUUID(), listScrollY: 0 }, "", url);
  } else history.replaceState(history.state, "", url);
}

export function restoreListScroll(state) {
  // Overlay entries have their own position owner in detail-dialog.js.
  const top = scrollPositions.get(state?.listEntry) ?? state?.listScrollY;
  if (!state?.detailDialogBase && Number.isFinite(top)) {
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" })));
  }
}

export function trackListScroll() {
  const path = location.pathname;
  if (!history.state?.listEntry) history.replaceState({ ...history.state, listEntry: crypto.randomUUID() }, "", location.href);
  const isList = () => location.pathname === path && !history.state?.detailDialog && !document.body.classList.contains("detail-dialog-open");
  // Keep scrolling in memory; replaceState on every frame hits Safari's history rate limit.
  window.addEventListener("scroll", () => {
    if (isList()) scrollPositions.set(history.state?.listEntry, window.scrollY);
  }, { passive: true });
  window.addEventListener("pagehide", () => {
    if (isList()) history.replaceState({ ...history.state, listScrollY: window.scrollY }, "", location.href);
  });
}
