(() => {
  const select = (gallery, index) => {
    const slides = [...gallery.querySelectorAll("[data-gallery-slide]")];
    index = Math.max(0, Math.min(slides.length - 1, index));
    gallery.dataset.current = String(index);
    slides.forEach((slide, position) => { slide.hidden = position !== index; });
    gallery.querySelectorAll("[data-gallery-index]").forEach((thumbnail, position) => {
      if (position === index) thumbnail.setAttribute("aria-current", "true");
      else thumbnail.removeAttribute("aria-current");
    });
    gallery.querySelector("[data-gallery-counter]").textContent = `${index + 1} / ${slides.length}`;
    gallery.querySelector('[data-gallery-step="-1"]').disabled = index === 0;
    gallery.querySelector('[data-gallery-step="1"]').disabled = index === slides.length - 1;
    const original = gallery.closest("[data-detail-content]")?.querySelector("[data-gallery-original]");
    if (original) original.href = slides[index].href;
    // Keep the selected thumbnail visible without scrolling the surrounding page.
    const thumbnail = gallery.querySelector(`[data-gallery-index="${index}"]`);
    const strip = thumbnail?.parentElement;
    if (strip) strip.scrollLeft = thumbnail.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + thumbnail.clientWidth / 2;
  };
  const step = (gallery, delta) => select(gallery, Number(gallery.dataset.current || 0) + delta);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest("[data-gallery-step], [data-gallery-index]");
    const gallery = trigger?.closest("[data-image-gallery]");
    if (!gallery || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (trigger.hasAttribute("data-gallery-index")) select(gallery, Number(trigger.dataset.galleryIndex));
    else step(gallery, Number(trigger.dataset.galleryStep));
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const gallery = event.target.closest("[data-image-gallery]");
    if (!gallery) return;
    event.preventDefault();
    if (event.key === "Home") select(gallery, 0);
    else if (event.key === "End") select(gallery, 11);
    else step(gallery, event.key === "ArrowLeft" ? -1 : 1);
  });
  let touch = null;
  document.addEventListener("touchstart", (event) => {
    const gallery = event.target instanceof Element ? event.target.closest("[data-gallery-stage]")?.closest("[data-image-gallery]") : null;
    touch = gallery && event.touches.length === 1 ? { gallery, x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (!touch || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touch.x;
    const dy = event.changedTouches[0].clientY - touch.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(touch.gallery, dx < 0 ? 1 : -1);
    touch = null;
  }, { passive: true });
  document.addEventListener("touchcancel", () => { touch = null; }, { passive: true });
})();
