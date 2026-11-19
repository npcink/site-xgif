(() => {
  const button = document.querySelector(".back-to-top");
  if (!button) return;
  const footer = document.querySelector("body > footer");
  const mobile = window.matchMedia("(max-width: 900px)");

  const update = () => {
    const viewport = window.innerHeight;
    const scrollRange = document.documentElement.scrollHeight - viewport;
    const threshold = scrollRange >= viewport ? viewport : scrollRange * 0.75;
    const hidden = !mobile.matches || scrollRange < 120 || window.scrollY < threshold;
    if (button.hidden !== hidden) button.hidden = hidden;
    if (!hidden && footer) {
      const footerClearance = Math.max(0, viewport - footer.getBoundingClientRect().top + 8);
      button.style.setProperty("--back-to-top-footer-clearance", `${footerClearance}px`);
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
})();
