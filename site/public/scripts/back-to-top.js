(() => {
  const button = document.querySelector("body > .back-to-top");
  if (!button) return;
  const footer = document.querySelector("body > footer");
  const homeTags = document.querySelector(".tag-library .tag-cloud");
  const mobile = window.matchMedia("(max-width: 900px)");
  const isArticle = Boolean(document.querySelector("main .article-detail"));

  const update = () => {
    const viewport = window.innerHeight;
    const scrollRange = document.documentElement.scrollHeight - viewport;
    const threshold = isArticle
      ? Math.min(viewport * 0.6, scrollRange * 0.75)
      : scrollRange >= viewport ? viewport : scrollRange * 0.75;
    const hidden = (!isArticle && !mobile.matches) || scrollRange < 120 || window.scrollY < threshold;
    if (button.hidden !== hidden) button.hidden = hidden;
    if (!hidden && footer) {
      const footerClearance = Math.max(0, viewport - footer.getBoundingClientRect().top + 8);
      button.style.setProperty("--back-to-top-footer-clearance", `${footerClearance}px`);
    }
    if (!hidden && homeTags) {
      const control = button.getBoundingClientRect();
      const tags = homeTags.getBoundingClientRect();
      button.toggleAttribute("data-obscures-tags", control.bottom > tags.top && control.top < tags.bottom &&
        control.right > tags.left && control.left < tags.right);
    }
  };

  button.addEventListener("click", () => {
    document.querySelector(".site-header .brand")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  window.addEventListener("pageshow", update);
  window.addEventListener("xgif:list-updated", update);
  update();

  const dialog = document.querySelector("[data-detail-dialog]");
  const shell = dialog?.querySelector("[data-detail-shell]");
  const dialogButton = dialog?.querySelector("[data-detail-top]");
  if (!shell || !dialogButton) return;

  const updateDialog = () => {
    const range = shell.scrollHeight - shell.clientHeight;
    dialogButton.hidden = !dialog.open || dialog.dataset.detailKind !== "article" ||
      dialog.getAttribute("aria-busy") === "true" || range < 120 ||
      shell.scrollTop < Math.min(shell.clientHeight * 0.6, range * 0.75);
  };
  shell.addEventListener("scroll", updateDialog, { passive: true });
  window.addEventListener("resize", updateDialog);
  window.addEventListener("xgif:detail-opened", () => requestAnimationFrame(updateDialog));
  window.addEventListener("xgif:detail-closed", updateDialog);
  dialogButton.addEventListener("click", () => {
    const heading = shell.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    shell.scrollTo({ top: 0 });
  });
})();
