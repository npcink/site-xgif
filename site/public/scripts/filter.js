(() => {
  const input = document.querySelector("[data-filter-input]");
  const items = Array.from(document.querySelectorAll("[data-search-item]"));
  const count = document.querySelector("[data-visible-count]");
  const empty = document.querySelector("[data-empty]");
  const chips = Array.from(document.querySelectorAll("[data-filter]"));
  const groups = Array.from(document.querySelectorAll("[data-search-group]"));
  const clear = document.querySelector("[data-clear]");
  const pagination = document.querySelector("[data-pagination]");
  const pageSummary = document.querySelector("[data-page-summary]");
  const pageSize = Number(pagination?.dataset.pageSize || 0);

  if (!(input instanceof HTMLInputElement)) return;

  const params = new URLSearchParams(window.location.search);
  input.value = params.get("q") || "";
  let chipFilter = params.get("source") || "";
  let currentPage = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);

  if (!chips.some((chip) => (chip.dataset.filter || "") === chipFilter)) chipFilter = "";

  const renderPagination = (total, pages) => {
    if (!pagination) return;
    pagination.hidden = pages <= 1;
    const previous = pagination.querySelector("[data-page-prev]");
    const next = pagination.querySelector("[data-page-next]");
    const numbers = pagination.querySelector("[data-page-numbers]");
    if (previous) previous.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= pages;
    if (numbers) {
      numbers.innerHTML = Array.from({ length: pages }, (_, index) => index + 1)
        .map((page) => `<button type="button" data-page="${page}"${page === currentPage ? ' class="active" aria-current="page"' : ""}>${page}</button>`)
        .join("");
    }
    if (pageSummary) {
      const from = total ? (currentPage - 1) * pageSize + 1 : 0;
      const to = Math.min(currentPage * pageSize, total);
      pageSummary.textContent = `显示 ${from}–${to}，共 `;
    }
  };

  const apply = () => {
    const queries = [input.value.trim().toLowerCase(), chipFilter].filter(Boolean);
    const matches = items.filter((item) => {
      const searchable = item.dataset.search || "";
      return queries.every((query) => searchable.includes(query));
    });
    const pages = pageSize ? Math.max(1, Math.ceil(matches.length / pageSize)) : 1;
    currentPage = Math.min(currentPage, pages);
    const pageStart = pageSize ? (currentPage - 1) * pageSize : 0;
    const pageItems = new Set(pageSize ? matches.slice(pageStart, pageStart + pageSize) : matches);

    items.forEach((item) => {
      item.hidden = !pageItems.has(item);
    });

    groups.forEach((group) => {
      const hasVisible = Array.from(group.querySelectorAll("[data-search-item]")).some((item) => !item.hidden);
      group.hidden = !hasVisible;
    });

    if (count) count.textContent = String(matches.length);
    if (empty) empty.hidden = matches.length !== 0;
    renderPagination(matches.length, pages);

    const url = new URL(window.location.href);
    if (input.value.trim()) url.searchParams.set("q", input.value.trim());
    else url.searchParams.delete("q");
    if (chipFilter) url.searchParams.set("source", chipFilter);
    else url.searchParams.delete("source");
    if (pageSize && currentPage > 1) url.searchParams.set("page", String(currentPage));
    else url.searchParams.delete("page");
    window.history.replaceState(window.history.state, "", url);

    chips.forEach((chip) => {
      const active = (chip.dataset.filter || "") === chipFilter;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  };

  input.addEventListener("input", () => {
    currentPage = 1;
    apply();
  });
  clear?.addEventListener("click", () => {
    input.value = "";
    currentPage = 1;
    input.focus();
    apply();
  });
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chipFilter = chip.dataset.filter || "";
      currentPage = 1;
      apply();
    });
  });
  pagination?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-page-prev]")) currentPage -= 1;
    else if (button.matches("[data-page-next]")) currentPage += 1;
    else if (button.dataset.page) currentPage = Number(button.dataset.page);
    apply();
    document.querySelector(".archive-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  apply();
})();
