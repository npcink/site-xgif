(() => {
  if (/^\/search\/?$/.test(location.pathname) && !new URLSearchParams(location.search).get("q")?.trim()) return;
  const root = document.documentElement;
  root.setAttribute("data-filter-pending", "");
  // A missing/failed filter script must never leave the static index invisible.
  window.setTimeout(() => root.removeAttribute("data-filter-pending"), 4000);
})();
