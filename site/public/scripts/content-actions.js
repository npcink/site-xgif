document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-copy-url]") : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const copy = button.closest(".image-detail-copy");
  const status = copy?.querySelector("[data-copy-status]");
  const fallback = copy?.querySelector("[data-copy-fallback]");
  const url = new URL(button.dataset.copyUrl, window.location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    if (status) status.textContent = "链接已复制";
    if (fallback) fallback.hidden = true;
  } catch {
    if (fallback instanceof HTMLInputElement) {
      fallback.value = url;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
    if (status) status.textContent = "请复制下面的链接";
  }
});
