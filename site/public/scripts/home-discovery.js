(() => {
  const root = document.querySelector("[data-home-discovery]");
  if (!root) return;

  const input = root.querySelector("[data-home-filter-input]");
  const clear = root.querySelector("[data-home-filter-clear]");
  const tabs = Array.from(root.querySelectorAll("[data-home-view]"));
  const sections = Array.from(document.querySelectorAll("[data-home-section]"));
  const note = document.querySelector("[data-home-result-note]");
  const queryLabel = document.querySelector("[data-home-query]");
  const visibleCount = document.querySelector("[data-home-visible-count]");
  const empty = document.querySelector("[data-home-empty]");
  const reset = document.querySelector("[data-home-reset]");

  if (!(input instanceof HTMLInputElement)) return;

  let view = "all";

  const apply = () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;

    sections.forEach((section) => {
      const kind = section.dataset.homeSection;
      const viewMatches = view === "all" || view === kind;
      const sectionCards = Array.from(section.querySelectorAll("[data-search-item]"));
      let sectionVisible = 0;

      sectionCards.forEach((card) => {
        const matches = !query || (card.dataset.search || "").includes(query);
        card.hidden = !viewMatches || !matches;
        if (viewMatches && matches) sectionVisible += 1;
      });

      section.hidden = !viewMatches || sectionVisible === 0;
      visible += sectionVisible;
    });

    clear.hidden = !query;
    if (note) note.hidden = !query;
    if (queryLabel) queryLabel.textContent = input.value.trim();
    if (visibleCount) visibleCount.textContent = String(visible);
    if (empty) empty.hidden = visible !== 0;
  };

  input.addEventListener("input", apply);
  clear?.addEventListener("click", () => {
    input.value = "";
    input.focus();
    apply();
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      view = tab.dataset.homeView || "all";
      tabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      apply();
    });
  });
  reset?.addEventListener("click", () => {
    input.value = "";
    view = "all";
    tabs.forEach((tab) => {
      const active = tab.dataset.homeView === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    input.focus();
    apply();
  });
  apply();
})();
