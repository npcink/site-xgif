(() => {
  const button = document.querySelector(".back-to-top");
  if (!button) return;
  const mobile = window.matchMedia("(max-width: 900px)");

  const update = () => {
    const hidden = !mobile.matches || window.scrollY < window.innerHeight;
    if (button.hidden !== hidden) button.hidden = hidden;
  };

  button.addEventListener("click", () => {
    document.querySelector(".site-header .brand")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  window.addEventListener("pageshow", update);
  update();
})();
