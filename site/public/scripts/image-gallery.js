(() => {
  const select = (gallery, index) => {
    const slides = [...gallery.querySelectorAll("[data-gallery-slide]")];
    index = Math.max(0, Math.min(slides.length - 1, index));
    if (index === Number(gallery.dataset.current)) return;
    gallery.dataset.current = String(index);
    const slide = slides[index];
    const image = slide.querySelector("img");
    const loading = gallery.querySelector("[data-gallery-loading]");
    if (image.hasAttribute("data-gallery-src")) {
      if (image.dataset.gallerySrcset) image.srcset = image.dataset.gallerySrcset;
      image.src = image.dataset.gallerySrc;
      delete image.dataset.gallerySrc;
      delete image.dataset.gallerySrcset;
    }
    slides.forEach((item, position) => {
      item.hidden = position !== index;
      item.removeAttribute("data-gallery-reveal");
    });
    function finish(event) {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      if (Number(gallery.dataset.current) !== index) return;
      loading.hidden = event?.type !== "error" && image.naturalWidth > 0;
      if (loading.hidden) slide.setAttribute("data-gallery-reveal", "");
      else loading.textContent = "图片未能加载";
    }
    if (image.complete) finish();
    else {
      loading.textContent = "正在加载图片…";
      loading.hidden = false;
      image.addEventListener("load", finish);
      image.addEventListener("error", finish);
    }
    gallery.querySelectorAll("[data-gallery-index]").forEach((thumbnail, position) => {
      if (position === index) thumbnail.setAttribute("aria-current", "true");
      else thumbnail.removeAttribute("aria-current");
    });
    gallery.querySelector("[data-gallery-counter]").textContent = `${index + 1} / ${slides.length}`;
    gallery.querySelector('[data-gallery-step="-1"]').disabled = index === 0;
    gallery.querySelector('[data-gallery-step="1"]').disabled = index === slides.length - 1;
    const original = gallery.closest("[data-detail-content]")?.querySelector("[data-gallery-original]");
    const thumbnail = gallery.querySelector(`[data-gallery-index="${index}"]`);
    if (original && thumbnail) original.href = thumbnail.href;
    // Keep the selected thumbnail visible without scrolling the surrounding page.
    const strip = thumbnail?.parentElement;
    if (strip) strip.scrollLeft = thumbnail.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + thumbnail.clientWidth / 2;
  };
  const step = (gallery, delta) => select(gallery, Number(gallery.dataset.current || 0) + delta);
  const enable = (gallery) => {
    gallery.tabIndex = 0;
    gallery.querySelector(".gallery-controls").hidden = false;
  };

  window.addEventListener("xgif:detail-opened", (event) => {
    const gallery = event.detail.root.querySelector("[data-image-gallery]");
    if (!gallery) return;
    enable(gallery);
    if (Number.isInteger(event.detail.galleryIndex)) select(gallery, event.detail.galleryIndex);
  });

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
    else if (event.key === "End") select(gallery, gallery.querySelectorAll("[data-gallery-slide]").length - 1);
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
  document.querySelectorAll("[data-image-gallery]").forEach(enable);
})();
