(() => {
  const dialog = document.querySelector("[data-detail-dialog]");
  const shell = dialog?.querySelector("[data-detail-shell]");
  const body = dialog?.querySelector("[data-detail-body]");
  const loading = dialog?.querySelector("[data-detail-loading]");
  const closeButton = dialog?.querySelector("[data-detail-close]");

  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(shell instanceof HTMLElement) ||
    !(body instanceof HTMLElement) ||
    !(loading instanceof HTMLElement) ||
    typeof dialog.showModal !== "function"
  ) {
    return;
  }

  const detailPath = /^\/\d{8}-[a-z0-9]{4}$/;
  const cache = new Map();
  const initialTitle = document.title;
  let activeRequest = null;
  let closeTimer = null;
  let lastTrigger = null;
  let previousBodyPadding = "";
  let isPageLocked = false;
  let isCloseRequested = false;

  const isDetailUrl = (url) => url.origin === window.location.origin && detailPath.test(url.pathname);

  const lockPage = () => {
    if (isPageLocked) return;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    previousBodyPadding = document.body.style.paddingRight;
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.classList.add("detail-dialog-open");
    isPageLocked = true;
  };

  const unlockPage = () => {
    if (!isPageLocked) return;
    document.body.classList.remove("detail-dialog-open");
    document.body.style.paddingRight = previousBodyPadding;
    isPageLocked = false;
  };

  const setLoading = (isLoading) => {
    loading.hidden = !isLoading;
    body.hidden = isLoading;
    dialog.setAttribute("aria-busy", String(isLoading));
  };

  const readDetail = async (url, signal) => {
    const key = url.pathname;
    if (cache.has(key)) return cache.get(key);

    const response = await fetch(url.href, {
      headers: { "X-Requested-With": "xgif-detail-dialog" },
      signal,
    });

    if (!response.ok) throw new Error(`Detail request failed: ${response.status}`);

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const content = parsed.querySelector("[data-detail-content]");
    const kind = content?.getAttribute("data-detail-kind");

    if (!(content instanceof HTMLElement) || !["article", "image"].includes(kind)) {
      throw new Error("Detail content contract is missing");
    }

    const payload = {
      html: content.outerHTML,
      kind,
      title: parsed.title || initialTitle,
    };
    cache.set(key, payload);
    return payload;
  };

  const revealDialog = () => {
    if (!dialog.open) {
      dialog.showModal();
      lockPage();
    }
    dialog.classList.remove("is-closing");
    window.requestAnimationFrame(() => dialog.classList.add("is-ready"));
  };

  const openDetail = async (url, kindHint = null) => {
    if (!isDetailUrl(url)) return;

    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    isCloseRequested = false;

    if (kindHint === "article" || kindHint === "image") {
      dialog.dataset.detailKind = kindHint;
    } else {
      delete dialog.dataset.detailKind;
    }
    revealDialog();
    setLoading(true);
    shell.scrollTop = 0;

    try {
      const payload = await readDetail(url, request.signal);
      if (request.signal.aborted || activeRequest !== request) return;

      body.innerHTML = payload.html;
      dialog.dataset.detailKind = payload.kind;
      const heading = body.querySelector("h1");
      if (heading instanceof HTMLElement) {
        heading.id = "detail-dialog-heading";
        dialog.setAttribute("aria-labelledby", heading.id);
        dialog.removeAttribute("aria-label");
      }
      document.title = payload.title;
      setLoading(false);
      closeButton?.focus({ preventScroll: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.location.assign(url.href);
    }
  };

  const closeDetail = ({ title = initialTitle, scrollY = null } = {}) => {
    activeRequest?.abort();
    activeRequest = null;
    document.title = title;

    if (!dialog.open) {
      if (Number.isFinite(scrollY)) window.scrollTo({ top: scrollY, behavior: "auto" });
      return;
    }

    dialog.classList.remove("is-ready");
    dialog.classList.add("is-closing");
    closeTimer = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove("is-closing");
      dialog.removeAttribute("aria-labelledby");
      dialog.setAttribute("aria-label", "内容详情");
      delete dialog.dataset.detailKind;
      body.replaceChildren();
      body.hidden = true;
      loading.hidden = false;
      unlockPage();
      if (Number.isFinite(scrollY)) window.scrollTo({ top: scrollY, behavior: "auto" });
      if (lastTrigger instanceof HTMLElement && lastTrigger.isConnected) {
        lastTrigger.focus({ preventScroll: true });
      }
      closeTimer = null;
      isCloseRequested = false;
    }, 180);
  };

  const requestClose = () => {
    if (isCloseRequested) return;
    isCloseRequested = true;
    if (history.state?.detailDialog) {
      const detailDepth = Number(history.state.detailDialogDepth) || 1;
      history.go(-detailDepth);
      return;
    }
    closeDetail();
  };

  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const trigger = event.target instanceof Element ? event.target.closest("a[data-detail-link]") : null;
    if (!(trigger instanceof HTMLAnchorElement) || trigger.target === "_blank" || trigger.hasAttribute("download")) {
      return;
    }

    const url = new URL(trigger.href, window.location.href);
    if (!isDetailUrl(url)) return;

    event.preventDefault();
    const kindHint = trigger.dataset.detailKind;
    if (dialog.open && history.state?.detailDialog) {
      const detailDepth = Number(history.state.detailDialogDepth) || 1;
      history.pushState(
        {
          ...history.state,
          detailDialog: true,
          detailDialogUrl: url.href,
          detailDialogDepth: detailDepth + 1,
          detailDialogKind: kindHint,
        },
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      openDetail(url, kindHint);
      return;
    }

    lastTrigger = trigger;
    const baseState = {
      ...history.state,
      detailDialogBase: true,
      detailDialogBaseTitle: document.title,
      detailDialogScrollY: window.scrollY,
    };
    history.replaceState(baseState, "", window.location.href);
    history.pushState(
      {
        detailDialog: true,
        detailDialogUrl: url.href,
        detailDialogBaseTitle: baseState.detailDialogBaseTitle,
        detailDialogDepth: 1,
        detailDialogKind: kindHint,
      },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    openDetail(url, kindHint);
  });

  closeButton?.addEventListener("click", requestClose);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) requestClose();
  });

  window.addEventListener("popstate", (event) => {
    if (event.state?.detailDialog) {
      openDetail(new URL(window.location.href), event.state.detailDialogKind);
      return;
    }
    closeDetail({
      title: event.state?.detailDialogBaseTitle || initialTitle,
      scrollY: event.state?.detailDialogScrollY,
    });
  });
})();
