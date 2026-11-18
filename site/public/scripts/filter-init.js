(() => {
  const params = new URLSearchParams(location.search);
  const filtered = ["q", "source"].some(key => params.get(key)?.trim())
    || ["static", "animated"].includes(params.get("media"));
  const paginated = ["page", "articlesPage", "imagesPage"].some(key => {
    const page = Number(params.get(key));
    return Number.isSafeInteger(page) && page > 1;
  });
  // The default first page is already correct HTML; only hide pending URL results.
  if (!filtered && !paginated) return;
  const root = document.documentElement;
  root.setAttribute("data-filter-pending", "");
  // A missing/failed filter script must never leave the static index invisible.
  window.setTimeout(() => root.removeAttribute("data-filter-pending"), 4000);
})();
