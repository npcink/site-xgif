(() => {
  if (!("ResizeObserver" in window)) return;

  document.querySelectorAll(".home-feed, .article-grid").forEach((grid) => {
    const items = Array.from(grid.children);
    let frame = 0;

    const layout = () => {
      frame = 0;
      const styles = getComputedStyle(grid);
      // Explicit desktop placement can temporarily create implicit tracks on mobile.
      // Read the responsive column contract rather than those stale computed tracks.
      const columns = Number(styles.getPropertyValue("--masonry-columns"));
      const gap = Number.parseFloat(styles.columnGap) || 0;
      if (columns < 2 || grid.getBoundingClientRect().width === 0) {
        grid.removeAttribute("data-masonry-ready");
        items.forEach((item) => {
          item.style.gridRow = "";
          item.style.gridColumn = "";
        });
        return;
      }

      // Read natural heights before writing placement. DOM and keyboard order stay intact.
      const heights = items.map((item) => item.hidden ? 0 : item.getBoundingClientRect().height);
      const ends = Array(columns).fill(1);
      grid.setAttribute("data-masonry-ready", "");
      items.forEach((item, index) => {
        if (!heights[index]) return;
        const column = ends.indexOf(Math.min(...ends));
        const span = Math.ceil(heights[index] + gap);
        // CSSOM property assignments work under style-src 'self'; no style text is injected.
        item.style.gridColumn = String(column + 1);
        item.style.gridRow = `${ends[column]} / span ${span}`;
        ends[column] += span;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };
    const sizes = new ResizeObserver(schedule);
    sizes.observe(grid);
    items.forEach((item) => sizes.observe(item));
    // Filtering and pagination hide cards without changing their source order.
    new MutationObserver(schedule).observe(grid, {
      attributes: true, attributeFilter: ["hidden"], subtree: true,
    });
    document.fonts.ready.then(schedule);
    window.addEventListener("pageshow", schedule);
    schedule();
  });
})();
