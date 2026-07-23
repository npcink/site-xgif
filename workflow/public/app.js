const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const today = new Date().toISOString().slice(0, 10);
const articleForm = $("#article-form");
const imageForm = $("#image-form");
const articleResult = $("#article-result");
const imageResult = $("#image-result");
const articleDetails = $("#article-details");
const articlePagePreview = $("#article-page-preview");
const contentList = $("#content-list");
const libraryDetail = $("#library-detail");
const libraryResult = $("#library-result");
const libraryEdit = $("#library-edit");
const libraryOpen = $("#library-open");
const flomoFileInput = $("#flomo-file");
const flomoReview = $("#flomo-review");
const flomoStats = $("#flomo-stats");
const flomoList = $("#flomo-list");
const flomoResult = $("#flomo-result");
let selectedImage = null;
let activeContent = null;
let flomoFileData = "";
let flomoInspection = null;
let articlePreviewMode = "card";
let imagePreviewMode = "card";

for (const input of $$("input[type=\"date\"]")) input.value = today;

async function api(path, payload) {
  const response = await fetch(path, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail ? `\n${data.detail}` : "";
    throw new Error(`${data.error || "请求失败"}${detail}`);
  }
  return data;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of $$('input[type="checkbox"]', form)) data[checkbox.name] = checkbox.checked;
  return data;
}

function list(value) {
  return String(value || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTags(tags) {
  return list(tags).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("");
}

function renderMarkdownPreview(value) {
  const blocks = String(value || "").trim().split(/\n\s*\n/).filter(Boolean);
  if (!blocks.length) return '<p class="empty-copy">正文内容会在这里显示。</p>';
  return blocks.map((block) => {
    const text = escapeHtml(block.trim()).replace(/\n/g, "<br />");
    if (text.startsWith("## ")) return `<h2>${text.slice(3)}</h2>`;
    if (text.startsWith("# ")) return `<h2>${text.slice(2)}</h2>`;
    if (text.startsWith("&gt; ")) return `<blockquote>${text.slice(5)}</blockquote>`;
    return `<p>${text}</p>`;
  }).join("");
}

function updateArticlePreview() {
  const data = formData(articleForm);
  $("#article-preview").innerHTML = `
    <div class="meta"><span>${escapeHtml(data.source || "来源")}</span><span>${escapeHtml(data.pubDate || today)}</span><span>${escapeHtml(data.readTime || "1 分钟")}</span></div>
    <h2>${escapeHtml(data.title || "文章标题")}</h2>
    <p class="summary">${escapeHtml(data.summary || "文章摘要会显示在这里。")}</p>
    ${data.note ? `<blockquote class="note">${escapeHtml(data.note)}</blockquote>` : ""}
    <div class="tags">${renderTags(data.tags)}</div>`;
  articlePagePreview.innerHTML = `
    <header>
      <div class="meta"><span>${escapeHtml(data.source || "来源")}</span><span>${escapeHtml(data.pubDate || today)}</span><span>${escapeHtml(data.readTime || "1 分钟")}</span></div>
      <h1>${escapeHtml(data.title || "文章标题")}</h1>
      <p class="summary">${escapeHtml(data.summary || "文章摘要会显示在这里。")}</p>
      <div class="tags">${renderTags(data.tags)}</div>
    </header>
    <div class="article-prose">${renderMarkdownPreview(data.body)}</div>`;
}

function updateImagePreview() {
  const data = formData(imageForm);
  const image = selectedImage?.dataUrl || "";
  const source = data.sourceKind === "user_provided"
    ? "图片来源：用户提供 · 已确认可公开发布"
    : `图片来源备注：${data.source || "外部来源待填写"}`;
  $("#image-preview").innerHTML = `
    ${image ? `<img src="${image}" alt="${escapeHtml(data.title || "图片预览")}" />` : ""}
    <div class="copy"><div class="meta"><span>${escapeHtml(data.category || "表情包")}</span><span>${escapeHtml(data.pubDate || today)}</span></div>
    <h2>${escapeHtml(data.title || "图片标题")}</h2><p class="summary">${escapeHtml(data.description || "图片说明会显示在这里。")}</p>
    <div class="tags">${renderTags(data.tags)}</div></div>`;
  $("#image-detail-preview").innerHTML = `
    <figure>${image ? `<img src="${image}" alt="${escapeHtml(data.title || "图片预览")}" />` : ""}</figure>
    <div class="copy"><p class="eyebrow">REACTION / 图片详情</p><h2>${escapeHtml(data.title || "图片标题")}</h2>
    <p class="summary">${escapeHtml(data.description || "图片说明会显示在这里。")}</p>
    <dl><div><dt>分类</dt><dd>${escapeHtml(data.category || "表情包")}</dd></div><div><dt>情绪</dt><dd>${escapeHtml(data.mood || "未分类")}</dd></div><div><dt>场景</dt><dd>${escapeHtml(data.scenes || "通用")}</dd></div></dl>
    <div class="tags">${renderTags(data.tags)}</div><p class="image-source">${escapeHtml(source)}</p></div>`;
}

function syncImageAttribution() {
  const isUserProvided = $('[name="sourceKind"]', imageForm).value === "user_provided";
  for (const field of $$('[data-external-attribution]', imageForm)) field.hidden = isUserProvided;
  for (const field of $$('[data-user-provided-field]', imageForm)) field.hidden = !isUserProvided;
  $("#user-provided-note").hidden = !isUserProvided;
}

function syncArticleAttribution() {
  const sourceKind = $('[name="sourceKind"]', articleForm).value;
  const source = $('[name="source"]', articleForm);
  const sourceUrl = $('[name="sourceUrl"]', articleForm);
  sourceUrl.required = sourceKind !== "original";
  sourceUrl.placeholder = sourceKind === "original" ? "原创内容可留空" : "https://example.com/article";
  if (sourceKind === "original" && !source.value.trim()) source.value = "原创";
}

function showResult(node, data) {
  node.classList.remove("error");
  node.hidden = false;
  node.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function showError(node, error) {
  node.classList.add("error");
  node.hidden = false;
  node.textContent = error.message;
}

function clearResult(node) {
  node.hidden = true;
  node.classList.remove("error");
  node.textContent = "";
}

function draftKey(form) {
  return `xgif-publisher-draft:${form.id}`;
}

function saveLocalDraft(form) {
  const data = formData(form);
  if (!Object.values(data).some((value) => value && value !== false && value !== today)) return;
  localStorage.setItem(draftKey(form), JSON.stringify({ savedAt: Date.now(), data }));
}

function setFormValues(form, data) {
  for (const [key, value] of Object.entries(data || {})) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = Boolean(value);
    else if (typeof value !== "object") field.value = String(value);
  }
}

function restoreLocalDraft(form, stateNode) {
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey(form)) || "null");
    if (!stored?.data || !Object.values(stored.data).some(Boolean)) return;
    setFormValues(form, stored.data);
    stateNode.textContent = "已恢复未发布的本地暂存内容。";
  } catch {
    localStorage.removeItem(draftKey(form));
  }
}

function setEditing(form, item) {
  form.dataset.editFile = item?.file || "";
  const state = form === articleForm ? $("#article-editor-state") : $("#image-editor-state");
  const submit = $('button[type="submit"]', form);
  state.textContent = item ? `正在编辑：${item.file}` : "";
  submit.textContent = item ? "保存修改" : form === articleForm ? "发布文章" : "发布图片";
}

function switchTab(name) {
  $$(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
  $$(".panel").forEach((item) => item.classList.toggle("active", item.id === `${name}-panel`));
  if (name === "library") loadLibrary();
}

function applyArticleSuggestion(suggestion) {
  for (const field of ["title", "summary", "tags", "readTime", "note", "source"]) {
    const input = $(`[name="${field}"]`, articleForm);
    const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
    if (input && value) input.value = value;
  }
  articleDetails.open = true;
  updateArticlePreview();
  saveLocalDraft(articleForm);
}

function applyImageSuggestion(suggestion) {
  for (const field of ["title", "description", "tags", "category", "mood", "scenes", "ratio"]) {
    const input = $(`[name="${field}"]`, imageForm);
    const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
    if (input && value) input.value = value;
  }
  updateImagePreview();
  saveLocalDraft(imageForm);
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sha256FromDataUrl(dataUrl) {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("浏览器无法读取这张图片。"));
    image.src = dataUrl;
  });
}

function suggestRatio(width, height) {
  if (width / height >= 1.25) return "wide";
  if (width / height <= 0.8) return "tall";
  return "square";
}

function imagePayload() {
  const data = formData(imageForm);
  if (selectedImage?.dataUrl?.startsWith("data:")) data.fileData = selectedImage.dataUrl;
  if (imageForm.dataset.editFile) data.excludeFile = imageForm.dataset.editFile;
  return data;
}

const importStatusLabels = {
  ready: "可直接导入",
  review: "需要整理",
  similar: "疑似重复",
  exact: "精确重复",
};

function renderFlomoStats(stats) {
  const entries = [
    ["总计", stats.total],
    ["可直接导入", stats.ready],
    ["需要整理", stats.review],
    ["疑似重复", stats.similar],
    ["精确重复", stats.exact],
  ];
  flomoStats.innerHTML = entries.map(([label, value]) => `
    <div class="import-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderFlomoInspection(inspection) {
  flomoInspection = inspection;
  renderFlomoStats(inspection.stats);
  flomoList.innerHTML = inspection.items.map((item) => {
    const duplicate = item.duplicate
      ? `<p class="import-duplicate">${escapeHtml(item.duplicate.reason)}${item.duplicate.title ? `：${escapeHtml(item.duplicate.title)}` : ""}${item.duplicate.similarity < 1 ? `（相似度 ${Math.round(item.duplicate.similarity * 100)}%）` : ""}</p>`
      : "";
    return `
      <article class="import-item" data-import-hash="${item.contentHash}" data-status="${item.status}">
        <div class="import-item-heading">
          <label class="import-item-select">
            <input type="checkbox" data-import-select ${item.selectedByDefault ? "checked" : ""} ${item.status === "exact" ? "disabled" : ""} />
            <span>${escapeHtml(item.title)}</span>
          </label>
          <span class="import-status">${importStatusLabels[item.status]}</span>
        </div>
        <div class="import-item-meta">${escapeHtml(item.recordedAt)} · ${item.charCount} 字 · ${escapeHtml(item.readTime)}</div>
        ${duplicate}
        <div class="import-fields">
          <label>候选标题<input data-import-field="title" value="${escapeHtml(item.title)}" /></label>
          <label>标签<input data-import-field="tags" value="${escapeHtml(item.tags.join(", "))}" /></label>
          <label class="import-summary-field">摘要<textarea rows="2" data-import-field="summary">${escapeHtml(item.summary)}</textarea></label>
        </div>
        <details class="import-body"><summary>查看导入正文</summary><pre>${escapeHtml(item.body)}</pre></details>
      </article>`;
  }).join("");
  flomoReview.hidden = false;
}

function selectedImportItems() {
  if (!flomoInspection) return [];
  const selected = new Set($$("[data-import-select]:checked", flomoList).map((input) => input.closest("[data-import-hash]").dataset.importHash));
  return flomoInspection.items.filter((item) => selected.has(item.contentHash));
}

function collectImportOverrides() {
  return Object.fromEntries($$("[data-import-hash]", flomoList).map((item) => {
    const value = {};
    for (const field of $$('[data-import-field]', item)) value[field.dataset.importField] = field.value;
    return [item.dataset.importHash, value];
  }));
}

async function inspectFlomoFile() {
  const file = flomoFileInput.files[0];
  if (!file) throw new Error("请先选择 flomo 导出的 ZIP 文件。");
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("只支持 flomo 导出的 ZIP 文件。");
  const rawDataUrl = await fileToDataUrl(file);
  flomoFileData = rawDataUrl.replace(/^data:[^;]*;/, "data:application/zip;");
  const inspection = await api("/api/import/flomo/inspect", { fileData: flomoFileData });
  renderFlomoInspection(inspection);
  showResult(flomoResult, `已解析 ${inspection.stats.total} 条 memo。默认选中 ${inspection.stats.selectedByDefault} 条，其余请人工确认。`);
}

async function aiOrganizeSelectedImports() {
  const items = selectedImportItems();
  if (!items.length) throw new Error("请先选择需要 AI 整理的内容。");
  if (!window.confirm(`将把选中的 ${items.length} 条正文发送给当前配置的 AI 服务，用于生成标题、摘要和标签。是否继续？`)) return;
  const overrides = collectImportOverrides();
  let completed = 0;
  for (const item of items) {
    showResult(flomoResult, `AI 正在整理 ${completed + 1} / ${items.length}…`);
    const suggestion = (await api("/api/ai/article-suggestion", {
      title: overrides[item.contentHash]?.title || item.title,
      source: "原创",
      sourceUrl: "",
      body: item.body,
    })).suggestion;
    const card = $(`[data-import-hash="${item.contentHash}"]`, flomoList);
    for (const field of ["title", "summary", "tags"]) {
      const input = $(`[data-import-field="${field}"]`, card);
      const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
      if (input && value) input.value = value;
    }
    completed += 1;
  }
  showResult(flomoResult, `AI 已整理 ${completed} 条内容。请复核后再生成草稿。`);
}

async function applyFlomoImport() {
  const items = selectedImportItems();
  if (!items.length) throw new Error("请至少选择一条内容。");
  if (!window.confirm(`将生成 ${items.length} 篇本地 Markdown 草稿，不会提交或推送。是否继续？`)) return;
  const result = await api("/api/import/flomo/apply", {
    fileData: flomoFileData,
    selectedHashes: items.map((item) => item.contentHash),
    overrides: collectImportOverrides(),
  });
  showResult(flomoResult, `已生成 ${result.imported} 篇草稿。${result.skipped.length ? `另有 ${result.skipped.length} 条因重复跳过。` : ""}\n${result.files.map((item) => item.file).join("\n")}`);
  await loadLibrary();
  renderFlomoInspection(await api("/api/import/flomo/inspect", { fileData: flomoFileData }));
}

function formatAsset(asset) {
  if (!asset) return "";
  return `文件：${asset.mime.replace("image/", "").toUpperCase()} · ${asset.width} × ${asset.height} · ${(asset.byteLength / 1024).toFixed(1)} KB · 建议 ${asset.ratio}`;
}

function formatQuality(result) {
  const asset = formatAsset(result.asset);
  const issues = result.issues.map((item) => `${item.level === "error" ? "必须处理" : "建议处理"}：${item.message}`);
  return [asset, issues.length ? issues.join("\n") : "质量检查通过。"].filter(Boolean).join("\n");
}

function formatPublish(result) {
  if (!result?.git?.push?.attempted) return result;
  if (result.git.push.ok) return result;
  return `文件已生成并完成本地提交。\n远程推送失败：${result.git.push.error || "未配置远程仓库。"}\n可在“内容管理”中点击“重试远程推送”。`;
}

async function loadLibrary() {
  const params = new URLSearchParams({
    type: $("#library-type").value,
    status: $("#library-status").value,
    query: $("#library-query").value.trim(),
  });
  try {
    const { items } = await api(`/api/content?${params}`);
    contentList.innerHTML = items.length ? items.map((item) => `
      <button class="content-item${activeContent?.file === item.file ? " active" : ""}" type="button" data-content-file="${escapeHtml(item.file)}" data-content-type="${item.type}">
        <span class="content-item-title">${escapeHtml(item.title)}</span>
        <span class="content-item-meta">${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.pubDate)} · ${item.draft ? "草稿" : "已发布"} · ${escapeHtml(item.source)}</span>
        <span class="content-item-summary">${escapeHtml(item.summary || item.bodyExcerpt)}</span>
      </button>`).join("") : '<p class="library-empty">没有找到内容。</p>';
  } catch (error) {
    contentList.innerHTML = '<p class="library-empty">无法读取内容列表。</p>';
    showError(libraryResult, error);
  }
}

async function selectContent(type, file) {
  try {
    const item = await api(`/api/content/read?${new URLSearchParams({ type, file })}`);
    activeContent = item;
    libraryEdit.disabled = false;
    const isPublic = !item.data.draft && (item.type === "article" || item.data.public !== false);
    libraryOpen.disabled = !isPublic;
    libraryOpen.textContent = item.type === "article" ? "在网站打开文章" : "在网站打开图片";
    libraryOpen.title = isPublic ? "" : item.type === "article" ? "草稿文章尚未公开" : "草稿或未公开图片尚未公开";
    clearResult(libraryResult);
    libraryDetail.innerHTML = `<div class="library-detail"><p class="eyebrow">${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.data.pubDate || "")}</p><h2>${escapeHtml(item.data.title || "未命名内容")}</h2><p>${escapeHtml(item.data.summary || item.data.description || "")}</p><div class="tags">${renderTags(item.data.tags)}</div><p class="content-item-meta">${escapeHtml(item.file)}</p></div>`;
    await loadLibrary();
  } catch (error) {
    showError(libraryResult, error);
  }
}

function openActiveContent() {
  if (!activeContent) return;
  const { type, file, data, body } = activeContent;
  if (type === "article") {
    setFormValues(articleForm, { ...data, tags: list(data.tags).join(", "), body });
    syncArticleAttribution();
    articleDetails.open = true;
    setEditing(articleForm, { file });
    updateArticlePreview();
    switchTab("article");
  } else {
    setFormValues(imageForm, { ...data, tags: list(data.tags).join(", "), mood: list(data.mood).join(", "), scenes: list(data.scenes).join(", "), body });
    syncImageAttribution();
    selectedImage = data.image ? { name: "existing-image", dataUrl: data.image } : null;
    imageForm.dataset.image = data.image || "";
    setEditing(imageForm, { file });
    updateImagePreview();
    switchTab("image");
  }
}

for (const tab of $$(".tab")) tab.addEventListener("click", () => switchTab(tab.dataset.tab));

for (const input of $$("input, textarea, select", articleForm)) {
  input.addEventListener("input", () => { syncArticleAttribution(); updateArticlePreview(); saveLocalDraft(articleForm); });
  input.addEventListener("change", () => { syncArticleAttribution(); updateArticlePreview(); saveLocalDraft(articleForm); });
}

for (const input of $$("input, textarea, select", imageForm)) {
  input.addEventListener("input", () => { syncImageAttribution(); updateImagePreview(); saveLocalDraft(imageForm); });
  input.addEventListener("change", () => { syncImageAttribution(); updateImagePreview(); saveLocalDraft(imageForm); });
}

for (const tab of $$('[data-preview]')) {
  tab.addEventListener("click", () => {
    articlePreviewMode = tab.dataset.preview;
    $$(".preview-tab").forEach((item) => item.classList.toggle("active", item === tab));
    $("#article-preview").classList.toggle("hidden", articlePreviewMode !== "card");
    articlePagePreview.classList.toggle("active", articlePreviewMode === "page");
  });
}

for (const tab of $$('[data-image-preview]')) {
  tab.addEventListener("click", () => {
    imagePreviewMode = tab.dataset.imagePreview;
    $$('[data-image-preview]').forEach((item) => item.classList.toggle("active", item === tab));
    $("#image-preview").hidden = imagePreviewMode !== "card";
    $("#image-detail-preview").hidden = imagePreviewMode !== "detail";
  });
}

$('input[name="file"]', imageForm).addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    const dimensions = await imageDimensions(dataUrl);
    const ratio = suggestRatio(dimensions.width, dimensions.height);
    selectedImage = { name: file.name, dataUrl };
    $('[name="ratio"]', imageForm).value = ratio;
    $("#image-editor-state").textContent = `已读取 ${dimensions.width} × ${dimensions.height} 像素，比例已设为“${ratio}”。`;
    imageForm.dataset.image = "";
    updateImagePreview();
    saveLocalDraft(imageForm);
  } catch (error) {
    selectedImage = null;
    showError(imageResult, error);
  }
});

$('[data-check="article"]').addEventListener("click", async () => {
  try { const result = await api("/api/check/article", formData(articleForm)); showResult(articleResult, result.duplicates.length ? result : "没有发现重复文章。"); }
  catch (error) { showError(articleResult, error); }
});

$('[data-check="image"]').addEventListener("click", async () => {
  try {
    const data = formData(imageForm);
    if (selectedImage?.dataUrl?.startsWith("data:")) data.sha256 = await sha256FromDataUrl(selectedImage.dataUrl);
    const result = await api("/api/check/image", data);
    showResult(imageResult, result.duplicates.length ? result : "没有发现重复图片。");
  } catch (error) { showError(imageResult, error); }
});

$('[data-quality="article"]').addEventListener("click", async () => {
  try { showResult(articleResult, formatQuality(await api("/api/quality/article", formData(articleForm)))); }
  catch (error) { showError(articleResult, error); }
});

$('[data-quality="image"]').addEventListener("click", async () => {
  try { showResult(imageResult, formatQuality(await api("/api/quality/image", imagePayload()))); }
  catch (error) { showError(imageResult, error); }
});

$('[data-ai-fill="article"]').addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "AI 整理中..."; showResult(articleResult, "正在生成可编辑建议...");
  try { applyArticleSuggestion((await api("/api/ai/article-suggestion", formData(articleForm))).suggestion); showResult(articleResult, "AI 已填写建议内容。请检查后再发布。"); }
  catch (error) { showError(articleResult, error); }
  finally { button.disabled = false; button.textContent = "AI 一键填写"; }
});

$('[data-ai-fill="image"]').addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "AI 整理中..."; showResult(imageResult, "正在识别图片并生成建议...");
  try {
    if (!selectedImage?.dataUrl?.startsWith("data:")) throw new Error("请选择本地图片后再使用 AI 整理。");
    applyImageSuggestion((await api("/api/ai/image-suggestion", { ...formData(imageForm), fileData: selectedImage.dataUrl })).suggestion);
    showResult(imageResult, "AI 已填写建议内容。请检查后再发布。");
  } catch (error) { showError(imageResult, error); }
  finally { button.disabled = false; button.textContent = "AI 整理图片"; }
});

articleForm.addEventListener("submit", async (event) => {
  event.preventDefault(); showResult(articleResult, "正在保存文章...");
  try {
    const data = formData(articleForm);
    const result = articleForm.dataset.editFile
      ? await api("/api/content/update", { type: "article", file: articleForm.dataset.editFile, data })
      : await api("/api/publish/article", data);
    localStorage.removeItem(draftKey(articleForm));
    showResult(articleResult, formatPublish(result));
    await loadLibrary();
  } catch (error) { showError(articleResult, error); }
});

imageForm.addEventListener("submit", async (event) => {
  event.preventDefault(); showResult(imageResult, "正在保存图片...");
  try {
    const data = imagePayload();
    if (!imageForm.dataset.editFile && !selectedImage) throw new Error("请选择图片或 GIF。");
    const quality = await api("/api/quality/image", data);
    if (!quality.ok) {
      showResult(imageResult, formatQuality(quality));
      return;
    }
    const warnings = quality.issues.filter((item) => item.level === "warning");
    if (warnings.length && !window.confirm(`发布前请确认：\n${warnings.map((item) => `- ${item.message}`).join("\n")}`)) {
      showResult(imageResult, "已取消发布，请调整内容后再试。");
      return;
    }
    const result = imageForm.dataset.editFile
      ? await api("/api/content/update", { type: "image", file: imageForm.dataset.editFile, data: { ...data, image: imageForm.dataset.image } })
      : await api("/api/publish/image", { ...data, fileName: selectedImage?.name, fileData: selectedImage?.dataUrl });
    localStorage.removeItem(draftKey(imageForm));
    showResult(imageResult, formatPublish(result));
    await loadLibrary();
  } catch (error) { showError(imageResult, error); }
});

contentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-content-file]");
  if (button) selectContent(button.dataset.contentType, button.dataset.contentFile);
});

$("#library-refresh").addEventListener("click", loadLibrary);
$("#library-query").addEventListener("search", loadLibrary);
$("#library-type").addEventListener("change", loadLibrary);
$("#library-status").addEventListener("change", loadLibrary);
libraryEdit.addEventListener("click", openActiveContent);
libraryOpen.addEventListener("click", () => {
  if (!activeContent?.publicUrl || libraryOpen.disabled) return;
  window.open(activeContent.publicUrl, "_blank", "noopener");
});
$("#retry-push").addEventListener("click", async () => {
  showResult(libraryResult, "正在推送...");
  try {
    const result = await api("/api/git/push", {});
    showResult(libraryResult, result.ok ? "推送成功。" : `推送失败：${result.error}`);
    loadStatus();
  } catch (error) { showError(libraryResult, error); }
});

flomoFileInput.addEventListener("change", () => {
  flomoFileData = "";
  flomoInspection = null;
  flomoReview.hidden = true;
  clearResult(flomoResult);
});

$("#flomo-inspect").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "解析中…";
  showResult(flomoResult, "正在本机解析 ZIP 并与现有文章查重…");
  try { await inspectFlomoFile(); }
  catch (error) { showError(flomoResult, error); }
  finally { button.disabled = false; button.textContent = "解析并检查重复"; }
});

$("#flomo-select-ready").addEventListener("click", () => {
  for (const item of $$("[data-import-hash]", flomoList)) {
    const checkbox = $("[data-import-select]", item);
    checkbox.checked = item.dataset.status === "ready";
  }
});

$("#flomo-clear-selection").addEventListener("click", () => {
  for (const checkbox of $$("[data-import-select]", flomoList)) checkbox.checked = false;
});

$("#flomo-ai-selected").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await aiOrganizeSelectedImports(); }
  catch (error) { showError(flomoResult, error); }
  finally { button.disabled = false; }
});

$("#flomo-import-selected").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await applyFlomoImport(); }
  catch (error) { showError(flomoResult, error); }
  finally { button.disabled = false; }
});

async function loadStatus() {
  try {
    const status = await api("/api/status");
    const ai = status.ai?.available ? `AI：${status.ai.model}` : "AI：未配置";
    const remote = status.git?.canPush ? "远程：已配置" : "远程：未配置";
    $("#status").textContent = `仓库：${status.repoRoot} · 分支：${status.branch} · ${ai} · ${remote}`;
  } catch { $("#status").textContent = "无法读取 Git 状态，但仍可生成本地内容文件。"; }
}

restoreLocalDraft(articleForm, $("#article-editor-state"));
restoreLocalDraft(imageForm, $("#image-editor-state"));
syncArticleAttribution();
syncImageAttribution();
updateArticlePreview();
updateImagePreview();
loadStatus();
