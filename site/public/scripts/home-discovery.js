(() => {
  const root = document.querySelector("[data-home-discovery]");
  const controls = root?.querySelector("[data-home-views]");
  if (!controls) return;

  const buttons = [...controls.querySelectorAll("[data-home-view]")];
  const items = [...root.querySelectorAll("[data-home-section]")];
  const links = root.querySelectorAll("[data-home-more]");
  const status = root.querySelector("[data-home-status]");
  let selected = null;

  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (button === selected) return;
      selected = button;
      const view = button.dataset.homeView;
      const matches = (kind) => view === "all" || view === kind;
      let count = 0;
      for (const item of items) {
        item.hidden = !matches(item.dataset.homeSection);
        if (!item.hidden) count += 1;
      }
      for (const link of links) link.hidden = !matches(link.dataset.homeMore);
      for (const tab of buttons) tab.setAttribute("aria-pressed", String(tab === button));
      if (status) status.textContent = `${button.textContent.trim()}：显示 ${count} 条更新`;
    });
  }
  controls.hidden = buttons.length < 2;
})();
