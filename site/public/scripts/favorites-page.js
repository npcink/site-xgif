import {
  favoriteKey,
  importFavoritesText,
  readFavorites,
  serializeFavorites,
  writeFavorites,
} from "./favorites-store.js";

const root = document.querySelector("[data-favorites-page]");
const catalogNode = document.querySelector("[data-favorites-catalog]");

if (root instanceof HTMLElement && catalogNode instanceof HTMLScriptElement) {
  const list = root.querySelector("[data-favorites-list]");
  const empty = root.querySelector("[data-favorites-empty]");
  const summary = root.querySelector("[data-favorites-summary]");
  const status = root.querySelector("[data-favorites-status]");
  const fileInput = root.querySelector("[data-favorites-file]");
  const exportButton = root.querySelector("[data-favorites-export]");
  const importButtons = root.querySelectorAll("[data-favorites-import]");
  const clearUnavailable = root.querySelector("[data-favorites-clear-unavailable]");
  const catalog = JSON.parse(catalogNode.textContent || "[]");
  const catalogByKey = new Map(catalog.map((item) => [favoriteKey(item), item]));
  const knownKeys = new Set(catalogByKey.keys());
  let importMode = "merge";

  const setStatus = (message, type = "info") => {
    if (!(status instanceof HTMLElement)) return;
    status.textContent = message;
    status.dataset.statusType = type;
    status.hidden = !message;
  };

  const render = () => {
    if (!(list instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;
    const { favorites, error } = readFavorites(window.localStorage);
    list.replaceChildren();

    for (const saved of favorites.items) {
      const current = catalogByKey.get(favoriteKey(saved));
      const item = current ?? saved;
      const row = document.createElement("article");
      row.className = "favorite-row";
      if (!current) row.dataset.favoriteUnavailable = "";

      const copy = document.createElement("div");
      copy.className = "favorite-row-copy";
      const meta = document.createElement("p");
      meta.className = "favorite-row-meta";
      meta.textContent = current
        ? `${item.kind === "article" ? "文章" : "图片"} · 收藏于 ${new Date(saved.savedAt).toLocaleDateString("zh-CN")}`
        : "原内容当前不可用 · 保留导入时的标题";
      const heading = document.createElement("h2");
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.title;
      if (!current) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
      heading.append(link);
      copy.append(meta, heading);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "favorite-row-remove";
      remove.dataset.favoriteRemove = favoriteKey(saved);
      remove.textContent = "移除";
      remove.setAttribute("aria-label", `从收藏中移除：${item.title}`);
      row.append(copy, remove);
      list.append(row);
    }

    const unavailableCount = favorites.items.filter((item) => !knownKeys.has(favoriteKey(item))).length;
    empty.hidden = favorites.items.length > 0;
    if (summary instanceof HTMLElement) {
      summary.textContent = favorites.items.length
        ? `${favorites.items.length} 项收藏${unavailableCount ? ` · ${unavailableCount} 项原内容不可用` : ""}`
        : "还没有收藏";
    }
    if (clearUnavailable instanceof HTMLButtonElement) {
      clearUnavailable.hidden = unavailableCount === 0;
    }
    if (error) setStatus(error, "error");
  };

  list?.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-favorite-remove]")
      : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const { favorites } = readFavorites(window.localStorage);
    favorites.items = favorites.items.filter((item) => favoriteKey(item) !== button.dataset.favoriteRemove);
    const result = writeFavorites(favorites, window.localStorage);
    setStatus(result.ok ? "已移除 1 项收藏。" : result.error, result.ok ? "success" : "error");
    if (result.ok) window.dispatchEvent(new CustomEvent("xgif:favorites-changed"));
    render();
  });

  exportButton?.addEventListener("click", () => {
    const { favorites, error } = readFavorites(window.localStorage);
    if (error) {
      setStatus(error, "error");
      return;
    }
    const blob = new Blob([serializeFavorites(favorites)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xgif-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`已导出 ${favorites.items.length} 项收藏。`, "success");
  });

  importButtons.forEach((button) => {
    button.addEventListener("click", () => {
      importMode = button.getAttribute("data-favorites-import") || "merge";
      if (fileInput instanceof HTMLInputElement) fileInput.click();
    });
  });

  fileInput?.addEventListener("change", async () => {
    if (!(fileInput instanceof HTMLInputElement) || !fileInput.files?.[0]) return;
    const file = fileInput.files[0];
    try {
      if (
        importMode === "replace" &&
        !window.confirm("覆盖导入会移除当前收藏，只保留文件中的有效项目。确定继续吗？")
      ) {
        return;
      }
      const result = importFavoritesText(await file.text(), readFavorites(window.localStorage).favorites, {
        mode: importMode,
        knownKeys,
      });
      const written = writeFavorites(result.favorites, window.localStorage);
      if (!written.ok) throw new Error(written.error);
      const parts = [
        `${importMode === "replace" ? "覆盖导入" : "合并导入"}完成：现有 ${result.stats.total} 项`,
        `新增 ${result.stats.added} 项`,
      ];
      if (result.stats.duplicates) parts.push(`重复 ${result.stats.duplicates} 项`);
      if (result.stats.invalid) parts.push(`无效 ${result.stats.invalid} 项`);
      if (result.stats.unavailable) parts.push(`原内容不可用 ${result.stats.unavailable} 项`);
      setStatus(`${parts.join("，")}。`, result.stats.invalid ? "warning" : "success");
      window.dispatchEvent(new CustomEvent("xgif:favorites-changed"));
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败。", "error");
    } finally {
      fileInput.value = "";
    }
  });

  clearUnavailable?.addEventListener("click", () => {
    const { favorites } = readFavorites(window.localStorage);
    const next = { ...favorites, items: favorites.items.filter((item) => knownKeys.has(favoriteKey(item))) };
    const removed = favorites.items.length - next.items.length;
    const result = writeFavorites(next, window.localStorage);
    setStatus(result.ok ? `已清理 ${removed} 项不可用收藏。` : result.error, result.ok ? "success" : "error");
    if (result.ok) window.dispatchEvent(new CustomEvent("xgif:favorites-changed"));
    render();
  });

  window.addEventListener("storage", render);
  window.addEventListener("xgif:favorites-changed", render);
  render();
}
