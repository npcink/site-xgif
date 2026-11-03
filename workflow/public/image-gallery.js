import { createPendingImageStore } from "./pending-images.js";

const MAX_IMAGES = 12;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function createImageGallery({ root, api, onChange, scope = () => "new" }) {
  const list = root.querySelector("#image-gallery-list");
  const status = root.querySelector("#image-gallery-status");
  const feedback = root.querySelector("#image-gallery-feedback");
  const input = root.querySelector('input[name="file"]');
  const stage = root.querySelector(".image-stage");
  let items = [];
  let activeId = "";
  let dragId = "";
  let locked = false;
  let selecting = false;
  let generation = 0;
  let analysis = new Map();
  const pendingStore = createPendingImageStore();
  const snapshot = () => items.filter((item) => item.src).map(({ src, width, height, altText }) => ({ src, width, height, altText }));
  const active = () => items.find((item) => item.id === activeId) || items[0] || null;
  const button = (label, action, disabled = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.dataset.galleryAction = action;
    node.disabled = locked || disabled;
    return node;
  };

  function render() {
    list.replaceChildren();
    status.textContent = `已选 ${items.length} / ${MAX_IMAGES} · 首张为封面`;
    input.disabled = locked || selecting || items.length >= MAX_IMAGES;
    for (const [index, item] of items.entries()) {
      const row = document.createElement("li");
      row.dataset.id = item.id;
      row.draggable = !locked;
      row.classList.toggle("is-active", item === active());
      const preview = button("", "preview");
      preview.className = "gallery-thumbnail";
      preview.setAttribute("aria-label", `预览第 ${index + 1} 张${index === 0 ? "，封面" : ""}`);
      preview.setAttribute("aria-pressed", String(item === active()));
      const image = document.createElement("img");
      if (item.dataUrl || item.src) image.src = item.dataUrl || item.src;
      image.draggable = false;
      image.alt = item.altText || item.name || `第 ${index + 1} 张`;
      preview.append(image);
      const name = document.createElement("strong");
      name.textContent = `${index === 0 ? "封面" : index + 1} · ${item.name || "图片"}`;
      const state = document.createElement("small");
      state.textContent = item.error || (item.loading ? "正在恢复本地文件…" : item.uploading ? "上传中…" : item.src ? "已上传" : "等待上传");
      const actions = document.createElement("div");
      actions.className = "gallery-item-actions";
      actions.append(button("前移", "previous", index === 0), button("后移", "next", index === items.length - 1), button("移除", "remove"));
      if (index > 0) actions.append(button("设为封面", "cover"));
      if (item.error && item.dataUrl) actions.append(button("重试", "retry"));
      const aiState = document.createElement("small");
      aiState.className = "gallery-ai-item-state";
      aiState.textContent = analysis.get(item.src) || "";
      const alt = document.createElement("label");
      alt.className = "gallery-alt-field";
      alt.textContent = "图片描述";
      const altInput = document.createElement("textarea");
      altInput.dataset.galleryAlt = item.id;
      altInput.value = item.altText || "";
      altInput.rows = 2;
      altInput.maxLength = 160;
      altInput.disabled = locked;
      altInput.placeholder = "AI 自动填写，可修改";
      alt.append(altInput);
      row.append(preview, name, state, aiState, actions, alt);
      list.append(row);
    }
  }

  function changed(options = {}) {
    render();
    onChange(active(), snapshot(), options);
  }

  async function upload(item) {
    if (item.uploading || item.src || !item.dataUrl) return;
    item.uploading = true;
    item.error = "";
    render();
    try {
      const result = await api("/api/assets/upload", { purpose: "image-gallery", fileName: item.name, fileData: item.dataUrl });
      Object.assign(item, { src: result.url, width: result.width, height: result.height });
      if (!item.removed) await pendingStore.complete(item).catch(() => {});
    } catch (error) {
      item.error = `上传失败：${error.message}`;
    } finally {
      item.uploading = false;
      if (items.includes(item)) changed();
    }
  }

  async function add(files) {
    if (locked || selecting) return;
    files = [...files];
    if (files.length > MAX_IMAGES - items.length) {
      feedback.textContent = `最多 ${MAX_IMAGES} 张，还能添加 ${MAX_IMAGES - items.length} 张。请重新选择。`;
      return;
    }
    const selectionGeneration = generation;
    const selectionScope = scope();
    selecting = true;
    feedback.textContent = "";
    render();
    const added = [];
    const errors = [];
    try {
      for (const file of files) {
        try {
          if (!MIME_TYPES.has(file.type)) throw new Error("仅支持 JPG、PNG、WebP 和 GIF");
          if (file.size > 8 * 1024 * 1024) throw new Error("单张不能超过 8 MB");
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("无法读取图片"));
            reader.readAsDataURL(file);
          });
          if (selectionGeneration !== generation) return;
          if (items.some((item) => item.dataUrl === dataUrl)) throw new Error("已选过相同图片");
          const dimensions = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error("图片无法打开"));
            image.src = dataUrl;
          });
          if (selectionGeneration !== generation) return;
          const item = { id: crypto.randomUUID(), scope: selectionScope, name: file.name, dataUrl, ...dimensions };
          try { await pendingStore.put(item, selectionScope); item.persisted = true; }
          catch { item.persisted = false; errors.push(`${file.name}：浏览器无法暂存，请在关闭页面前完成上传`); }
          if (selectionGeneration !== generation) { void pendingStore.remove(item.id).catch(() => {}); return; }
          items.push(item);
          added.push(item);
          if (!activeId) activeId = item.id;
        } catch (error) { errors.push(`${file.name}：${error.message}`); }
      }
    } finally {
      if (selectionGeneration === generation) {
        selecting = false;
        feedback.textContent = errors.join("；");
        changed();
      }
    }
    // Keep requests small and failures isolated; completed uploads survive retries.
    for (const item of added) if (items.includes(item)) await upload(item);
  }

  input.addEventListener("change", () => { const files = [...input.files]; input.value = ""; add(files); });
  stage.addEventListener("dragover", (event) => {
    if ([...event.dataTransfer.types].includes("Files")) { event.preventDefault(); stage.classList.add("is-dragging-image"); }
  });
  stage.addEventListener("dragleave", () => stage.classList.remove("is-dragging-image"));
  stage.addEventListener("drop", (event) => {
    stage.classList.remove("is-dragging-image");
    if (event.dataTransfer.files.length) { event.preventDefault(); add(event.dataTransfer.files); }
  });
  list.addEventListener("click", (event) => {
    const action = event.target.closest("[data-gallery-action]")?.dataset.galleryAction;
    const id = event.target.closest("li")?.dataset.id;
    const index = items.findIndex((item) => item.id === id);
    if (locked || index < 0 || !action) return;
    const item = items[index];
    if (action === "preview") activeId = id;
    if (action === "retry") { upload(item); return; }
    if (action === "remove") { item.removed = true; items.splice(index, 1); void pendingStore.remove(item.id).catch(() => {}); }
    const destination = action === "cover" ? 0 : action === "previous" ? index - 1 : action === "next" ? index + 1 : -1;
    if (destination >= 0 && destination < items.length) items.splice(destination, 0, ...items.splice(index, 1));
    changed({ previewOnly: action === "preview" });
    const focusRow = items.find((item) => item.id === id) || items[Math.min(index, items.length - 1)];
    const sameAction = list.querySelector(`[data-id="${focusRow?.id}"] [data-gallery-action="${action}"]:not(:disabled)`);
    (sameAction || list.querySelector(`[data-id="${focusRow?.id}"] [data-gallery-action="preview"]`))?.focus();
  });
  list.addEventListener("input", (event) => {
    const item = items.find((item) => item.id === event.target.dataset.galleryAlt);
    if (!item || locked) return;
    item.altText = event.target.value;
    item.altEdited = true;
    onChange(active(), snapshot(), { altOnly: true });
  });
  list.addEventListener("dragstart", (event) => {
    if (locked || event.target.closest(".gallery-item-actions")) { event.preventDefault(); return; }
    dragId = event.target.closest("li")?.dataset.id;
    event.dataTransfer.setData("text/plain", dragId);
  });
  list.addEventListener("dragover", (event) => { if (dragId && !locked) event.preventDefault(); });
  list.addEventListener("dragend", () => { dragId = ""; });
  list.addEventListener("drop", (event) => {
    if (!dragId || locked) return;
    const from = items.findIndex((item) => item.id === dragId);
    const to = items.findIndex((item) => item.id === event.target.closest("li")?.dataset.id);
    event.preventDefault();
    if (from >= 0 && to >= 0) items.splice(to, 0, ...items.splice(from, 1));
    dragId = "";
    changed();
  });

  return {
    snapshot,
    draftSnapshot: () => items.map((item) => item.src
      ? { src: item.src, width: item.width, height: item.height, altText: item.altText }
      : { pendingId: item.id, name: item.name, width: item.width, height: item.height, altText: item.altText, persisted: item.persisted }),
    active,
    select(src) {
      const item = items.find((item) => item.src === src);
      if (item) { activeId = item.id; changed({ previewOnly: true }); }
    },
    setCover(src) {
      const index = items.findIndex((item) => item.src === src);
      if (locked || index <= 0) return;
      items.unshift(...items.splice(index, 1));
      changed();
    },
    setAnalysis(job) {
      analysis = new Map();
      let updated = false;
      for (const row of job?.items || []) {
        const item = items.find((item) => item.src === row.src);
        if (!item) continue;
        analysis.set(row.src, row.state === "done" ? row.result?.warnings?.length ? "AI 已识别 · 需检查" : "AI 已识别" : row.state === "error" ? "AI 识别失败，可重试" : row.state === "running" ? "AI 识别中…" : "等待 AI 识别");
        const node = list.querySelector(`[data-id="${item.id}"]`);
        if (node) node.querySelector(".gallery-ai-item-state").textContent = analysis.get(row.src);
        if (!item.altText && !item.altEdited && row.result?.altText) {
          item.altText = row.result.altText.slice(0, 160);
          const input = node?.querySelector("textarea");
          if (input && document.activeElement !== input) input.value = item.altText;
          updated = true;
        }
      }
      if (updated) onChange(active(), snapshot(), { analysisOnly: true });
    },
    pendingCount: () => items.filter((item) => !item.src).length,
    ready: () => !selecting && items.length > 0 && items.every((item) => item.src && !item.uploading && !item.error),
    setLocked(value) { locked = value; render(); },
    restore(images) {
      generation += 1;
      analysis.clear();
      selecting = false;
      feedback.textContent = "";
      items = (images || []).map((image, index) => ({ ...image, scope: scope(), altEdited: image.altText === "", id: image.pendingId || crypto.randomUUID(), name: image.name || `图片 ${index + 1}`, dataUrl: image.src, loading: Boolean(image.pendingId) }));
      activeId = items[0]?.id || "";
      render();
      onChange(active(), snapshot(), { restored: true });
      const restoredGeneration = generation;
      const restoredScope = scope();
      void (async () => {
        for (const item of items.filter((item) => item.pendingId)) {
          try {
            const saved = await pendingStore.read(item.pendingId, restoredScope);
            if (restoredGeneration !== generation) return;
            if (!items.includes(item)) continue;
            if (!saved?.dataUrl && !saved?.src) throw new Error("待上传文件未能恢复，请移除后重新添加");
            Object.assign(item, { dataUrl: saved.dataUrl || saved.src, src: saved.src, width: saved.width, height: saved.height, loading: false, persisted: true });
            changed();
            await upload(item);
          } catch {
            if (restoredGeneration !== generation) return;
            if (!items.includes(item)) continue;
            item.loading = false;
            item.error = "待上传文件未能恢复，请移除后重新添加";
            changed({ restored: true });
          }
        }
      })();
    },
  };
}
