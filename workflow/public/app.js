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
let selectedImage = null;
let activeContent = null;
let articlePreviewMode = "card";

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
  $("#image-preview").innerHTML = `
    ${image ? `<img src="${image}" alt="${escapeHtml(data.title || "图片预览")}" />` : ""}
    <div class="copy"><div class="meta"><span>${escapeHtml(data.category || "表情包")}</span><span>${escapeHtml(data.pubDate || today)}</span></div>
    <h2>${escapeHtml(data.title || "图片标题")}</h2><p class="summary">${escapeHtml(data.description || "图片说明会显示在这里。")}</p>
    <div class="tags">${renderTags(data.tags)}</div></div>`;
}

function syncImageAttribution() {
  const isUserProvided = $('[name="sourceKind"]', imageForm).value === "user_provided";
  for (const field of $$('[data-external-attribution]', imageForm)) field.hidden = isUserProvided;
  $("#user-provided-note").hidden = !isUserProvided;
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

function formatQuality(result) {
  if (!result.issues.length) return "质量检查通过。";
  return result.issues.map((item) => `${item.level === "error" ? "必须处理" : "建议处理"}：${item.message}`).join("\n");
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
  input.addEventListener("input", () => { updateArticlePreview(); saveLocalDraft(articleForm); });
  input.addEventListener("change", () => { updateArticlePreview(); saveLocalDraft(articleForm); });
}

for (const input of $$("input, textarea, select", imageForm)) {
  input.addEventListener("input", () => { syncImageAttribution(); updateImagePreview(); saveLocalDraft(imageForm); });
  input.addEventListener("change", () => { syncImageAttribution(); updateImagePreview(); saveLocalDraft(imageForm); });
}

for (const tab of $$(".preview-tab")) {
  tab.addEventListener("click", () => {
    articlePreviewMode = tab.dataset.preview;
    $$(".preview-tab").forEach((item) => item.classList.toggle("active", item === tab));
    $("#article-preview").classList.toggle("hidden", articlePreviewMode !== "card");
    articlePagePreview.classList.toggle("active", articlePreviewMode === "page");
  });
}

$('input[name="file"]', imageForm).addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  selectedImage = { name: file.name, dataUrl: await fileToDataUrl(file) };
  imageForm.dataset.image = "";
  updateImagePreview();
  saveLocalDraft(imageForm);
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
  try { showResult(imageResult, formatQuality(await api("/api/quality/image", formData(imageForm)))); }
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
    const data = formData(imageForm);
    if (!imageForm.dataset.editFile && !selectedImage) throw new Error("请选择图片或 GIF。");
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
syncImageAttribution();
updateArticlePreview();
updateImagePreview();
loadStatus();
