(() => {
  const input = document.querySelector("[data-filter-input]");
  const items = Array.from(document.querySelectorAll("[data-search-item]"));
  const count = document.querySelector("[data-visible-count]");
  const empty = document.querySelector("[data-empty]");
  const chips = Array.from(document.querySelectorAll("[data-filter]"));
  const groups = Array.from(document.querySelectorAll("[data-search-group]"));
  const clear = document.querySelector("[data-clear]");

  if (!(input instanceof HTMLInputElement)) return;

  const params = new URLSearchParams(window.location.search);
  input.value = params.get("q") || "";
  let chipFilter = "";

  const apply = () => {
    const queries = [input.value.trim().toLowerCase(), chipFilter].filter(Boolean);
    let visible = 0;

    items.forEach((item) => {
      const searchable = item.dataset.search || "";
      const matches = queries.every((query) => searchable.includes(query));
      item.hidden = !matches;
      if (matches) visible += 1;
    });

    groups.forEach((group) => {
      const hasVisible = Array.from(group.querySelectorAll("[data-search-item]")).some((item) => !item.hidden);
      group.hidden = !hasVisible;
    });

    if (count) count.textContent = String(visible);
    if (empty) empty.hidden = visible !== 0;

    const url = new URL(window.location.href);
    if (input.value.trim()) url.searchParams.set("q", input.value.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  };

  input.addEventListener("input", apply);
  clear?.addEventListener("click", () => {
    input.value = "";
    input.focus();
    apply();
  });
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chipFilter = chip.dataset.filter || "";
      chips.forEach((item) => item.classList.toggle("active", item === chip));
      apply();
    });
  });

  apply();
})();
