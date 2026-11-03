const MAX_IMAGES = 12;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function createImageGallery({ root, api, onChange }) {
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
      image.src = item.dataUrl || item.src;
      image.draggable = false;
      image.alt = item.altText || item.name || `第 ${index + 1} 张`;
      preview.append(image);
      const name = document.createElement("strong");
      name.textContent = `${index === 0 ? "封面" : index + 1} · ${item.name || "图片"}`;
      const state = document.createElement("small");
      state.textContent = item.error || (item.uploading ? "上传中…" : item.src ? "已上传" : "等待上传");
      const actions = document.createElement("div");
      actions.className = "gallery-item-actions";
      actions.append(button("前移", "previous", index === 0), button("后移", "next", index === items.length - 1), button("移除", "remove"));
      if (index > 0) actions.append(button("设为封面", "cover"));
      if (item.error) actions.append(button("重试", "retry"));
      row.append(preview, name, state, actions);
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
          const item = { id: crypto.randomUUID(), name: file.name, dataUrl, ...dimensions };
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
    if (action === "remove") items.splice(index, 1);
    const destination = action === "cover" ? 0 : action === "previous" ? index - 1 : action === "next" ? index + 1 : -1;
    if (destination >= 0 && destination < items.length) items.splice(destination, 0, ...items.splice(index, 1));
    changed({ previewOnly: action === "preview" });
    const focusRow = items.find((item) => item.id === id) || items[Math.min(index, items.length - 1)];
    const sameAction = list.querySelector(`[data-id="${focusRow?.id}"] [data-gallery-action="${action}"]:not(:disabled)`);
    (sameAction || list.querySelector(`[data-id="${focusRow?.id}"] [data-gallery-action="preview"]`))?.focus();
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
    active,
    pendingCount: () => items.filter((item) => !item.src).length,
    ready: () => !selecting && items.length > 0 && items.every((item) => item.src && !item.uploading && !item.error),
    setLocked(value) { locked = value; render(); },
    restore(images) {
      generation += 1;
      selecting = false;
      feedback.textContent = "";
      items = (images || []).map((image, index) => ({ ...image, id: crypto.randomUUID(), name: `图片 ${index + 1}`, dataUrl: image.src }));
      activeId = items[0]?.id || "";
      render();
      onChange(active(), snapshot(), { restored: true });
    },
  };
}
