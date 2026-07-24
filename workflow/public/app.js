import { importItemMatchesFilter, summarizeImportSelection } from "./import-selection.js";
import { renderMarkdownPreview } from "./markdown-preview.js";
import {
  clearLibrarySelectionState,
  createLibrarySelection,
  isLibraryFileSelected,
  libraryBatchPayload,
  librarySelectionSummary as summarizeLibrarySelection,
  selectAllFiltered,
  setLibraryFileSelected,
  setLibraryPageSelected,
} from "./library-selection.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function localCalendarDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const today = localCalendarDate();
const articleForm = $("#article-form");
const imageForm = $("#image-form");
const articleResult = $("#article-result");
const imageResult = $("#image-result");
const articleDetails = $("#article-details");
const imageDetails = $("#image-details");
const articlePagePreview = $("#article-page-preview");
const contentList = $("#content-list");
const libraryDetail = $("#library-detail");
const libraryResult = $("#library-result");
const libraryEdit = $("#library-edit");
const libraryTransition = $("#library-transition");
const libraryPreview = $("#library-preview");
const libraryOpen = $("#library-open");
const libraryActions = $("#library-actions");
const libraryPanel = $("#library-panel");
const libraryInspector = $("#library-inspector");
const librarySelectionSummary = $("#library-selection-summary");
const libraryPageSummary = $("#library-page-summary");
const libraryPagination = $("#library-pagination");
const trashDialog = $("#trash-dialog");
const trashList = $("#trash-list");
const batchEditDialog = $("#batch-edit-dialog");
const batchEditForm = $("#batch-edit-form");
const contentAuditDialog = $("#content-audit-dialog");
const assetLibraryDialog = $("#asset-library-dialog");
const syncHistoryDialog = $("#sync-history-dialog");
const articlePublishOptions = $("#article-publish-options");
const articleRealPreview = $("#article-real-preview");
const articleNextAction = $("#article-next-action");
const librarySelectionBar = $("#library-selection-bar");
const flomoFileInput = $("#flomo-file");
const flomoReview = $("#flomo-review");
const flomoStats = $("#flomo-stats");
const flomoList = $("#flomo-list");
const flomoResult = $("#flomo-result");
const flomoSelectionSummary = $("#flomo-selection-summary");
const flomoOnlyUnselected = $("#flomo-only-unselected");
const flomoCompleteActions = $("#flomo-complete-actions");
const flomoAiSelected = $("#flomo-ai-selected");
const flomoImportSelected = $("#flomo-import-selected");
let selectedImage = null;
let activeContent = null;
let flomoFileData = "";
let flomoInspection = null;
const flomoAiBodies = new Map();
let flomoImportFilter = "all";
let flomoAiBusy = false;
let flomoImportBusy = false;
let articlePreviewMode = "card";
let imagePreviewMode = "card";
let sitePreviewAvailable = false;
let sitePreviewUrl = "http://127.0.0.1:4321/";
let libraryStatus = "all";
let libraryView = localStorage.getItem("xgif-library-view") === "excerpt" ? "excerpt" : "compact";
let libraryPage = 1;
let libraryPages = 1;
let libraryTotal = 0;
let libraryPageItems = [];
let librarySearchTimer = null;
let recycleBinItems = [];
const recycleSelectedIds = new Set();
const librarySelection = createLibrarySelection();
const librarySelectedItems = new Map();
let lastTrashedItems = [];
let tagMergePlan = null;
let assetLibraryItems = [];
let assetPickerMode = "insert";

try {
  const storedTrash = JSON.parse(localStorage.getItem("xgif-last-trashed-items") || "[]");
  if (Array.isArray(storedTrash)) lastTrashedItems = storedTrash;
} catch {
  lastTrashedItems = [];
}

for (const input of $$("input[type=\"date\"]")) input.value = today;

let csrfTokenPromise = null;

async function getCsrfToken({ refresh = false } = {}) {
  if (refresh) csrfTokenPromise = null;
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.csrfToken) throw new Error(data.error || "无法建立本地发布会话。");
        return data.csrfToken;
      })
      .catch((error) => {
        csrfTokenPromise = null;
        throw error;
      });
  }
  return csrfTokenPromise;
}

async function apiRequest(path, payload, { retrySession = true } = {}) {
  const csrfToken = payload ? await getCsrfToken() : "";
  const response = await fetch(path, {
    method: payload ? "POST" : "GET",
    headers: payload
      ? { "content-type": "application/json", "x-xgif-csrf": csrfToken }
      : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  if (payload && response.status === 403 && retrySession) {
    await getCsrfToken({ refresh: true });
    return apiRequest(path, payload, { retrySession: false });
  }
  if (!response.ok) {
    const detail = data.detail ? `\n${data.detail}` : "";
    throw new Error(`${data.error || "请求失败"}${detail}`);
  }
  return data;
}

async function api(path, payload) {
  return apiRequest(path, payload);
}
function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of $$('input[type="checkbox"]', form)) data[checkbox.name] = checkbox.checked;
  return data;
}

function articlePayload() {
  syncPublishMode(articleForm);
  const data = formData(articleForm);
  if (articleForm.dataset.editFile) data.excludeFile = articleForm.dataset.editFile;
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

function updateArticlePreview() {
  const data = formData(articleForm);
  $("#article-preview").innerHTML = `
    ${data.coverImage ? `<img class="article-preview-cover" src="${escapeHtml(data.coverImage)}" alt="" />` : ""}
    <div class="meta"><span>${escapeHtml(data.source || "来源")}</span><span>${escapeHtml(data.pubDate || today)}</span><span>${escapeHtml(data.readTime || "1 分钟")}</span></div>
    <h2>${escapeHtml(data.title || "文章标题")}</h2>
    <p class="summary">${escapeHtml(data.summary || "文章摘要会显示在这里。")}</p>
    ${data.editorNote ? `<blockquote class="note">${escapeHtml(data.editorNote)}</blockquote>` : ""}
    <div class="tags">${renderTags(data.tags)}</div>`;
  articlePagePreview.innerHTML = `
    <header>
      <div class="meta"><span>${escapeHtml(data.source || "来源")}</span><span>${escapeHtml(data.pubDate || today)}</span><span>${escapeHtml(data.readTime || "1 分钟")}</span></div>
      <h1>${escapeHtml(data.title || "文章标题")}</h1>
      <p class="summary">${escapeHtml(data.summary || "文章摘要会显示在这里。")}</p>
      <div class="tags">${renderTags(data.tags)}</div>
    </header>
    ${data.coverImage ? `<img class="article-page-preview-cover" src="${escapeHtml(data.coverImage)}" alt="${escapeHtml(data.coverAlt || data.title || "文章封面")}" />` : ""}
    <div class="article-prose">${renderMarkdownPreview(data.body)}</div>`;
  updateArticleReview(data);
}

function updateImagePreview() {
  const data = formData(imageForm);
  const image = selectedImage?.dataUrl || "";
  const source = data.sourceKind === "user_provided"
    ? "图片来源：用户提供 · 已确认可公开发布"
    : data.sourceKind === "unknown"
      ? "图片来源：群聊转存 · 原作者与授权信息待核实"
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
  updateImageReview(data);
}

function updateArticleReview(data = formData(articleForm)) {
  const tags = list(data.tags);
  $("#article-ai-title").textContent = data.title || "等待整理文章资料";
  $("#article-ai-summary").textContent = data.summary
    ? `${data.summary}${tags.length ? ` · ${tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}` : ""}`
    : "整理后在这里快速复核标题、摘要和标签。";
}

function updateImageReview(data = formData(imageForm)) {
  const tags = list(data.tags);
  $("#image-ai-title").textContent = data.title || "等待选择图片并整理";
  $("#image-ai-summary").textContent = data.description
    ? `${data.description}${tags.length ? ` · ${tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}` : ""}`
    : "整理后在这里快速复核描述、标签和使用场景。";
}

function syncImageAttribution() {
  const sourceKind = $('[name="sourceKind"]', imageForm).value;
  const isUserProvided = sourceKind === "user_provided";
  const isUnknown = sourceKind === "unknown";
  for (const field of $$('[data-external-attribution]', imageForm)) field.hidden = sourceKind !== "original";
  for (const field of $$('[data-user-provided-field]', imageForm)) field.hidden = !isUserProvided;
  $("#user-provided-note").hidden = !isUserProvided;
  $("#unknown-source-note").hidden = !isUnknown;
}

function syncPublishMode(form) {
  const mode = $('input[name="publishMode"]:checked', form)?.value || "publish";
  const draft = $('[name="draft"]', form);
  const publicControl = $('[name="public"]', form);
  draft.checked = mode === "draft";
  if (publicControl) publicControl.checked = mode === "publish";
}

function setPublishMode(form, mode) {
  const radio = $(`input[name="publishMode"][value="${mode}"]`, form);
  if (radio) radio.checked = true;
  syncPublishMode(form);
}

function syncAiAvailability() {
  const articleData = formData(articleForm);
  $('[data-ai-fill="article"]').disabled = ![articleData.title, articleData.sourceUrl, articleData.body]
    .some((value) => String(value || "").trim());
  $('[data-ai-fill="image"]').disabled = !selectedImage?.dataUrl?.startsWith("data:");
}

function syncArticleAttribution() {
  const sourceKind = $('[name="sourceKind"]', articleForm).value;
  const source = $('[name="source"]', articleForm);
  const sourceUrl = $('[name="sourceUrl"]', articleForm);
  sourceUrl.required = ["publication", "editorial"].includes(sourceKind);
  sourceUrl.placeholder = sourceKind === "unknown"
    ? "未识别到来源，可先保存草稿"
    : sourceKind === "original"
      ? "原创内容可留空"
      : "https://example.com/article";
  if (sourceKind === "unknown" && !source.value.trim()) source.value = "来源待确认";
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

function formStateNode(form) {
  return form === articleForm ? $("#article-editor-state") : $("#image-editor-state");
}

function isFormDirty(form) {
  return form.dataset.dirty === "true";
}

function updateFormSaveState(form, message = "") {
  const stateNode = formStateNode(form);
  if (message) {
    stateNode.textContent = message;
    return;
  }
  if (isFormDirty(form)) {
    stateNode.textContent = "有未保存到 Markdown 的修改 · 已在浏览器临时暂存";
  } else if (form.dataset.editFile) {
    stateNode.textContent = "已保存到 Markdown";
  } else {
    stateNode.textContent = "";
  }
}

function markFormDirty(form) {
  form.dataset.dirty = "true";
  updateFormSaveState(form);
}

function markFormClean(form, message = "") {
  form.dataset.dirty = "false";
  updateFormSaveState(form, message);
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
    if (
      form === imageForm
      && stored.data.sourceKind === "original"
      && ![stored.data.sourceUrl, stored.data.author, stored.data.license, stored.data.licenseUrl].some(Boolean)
    ) {
      stored.data.sourceKind = "unknown";
    }
    setFormValues(form, stored.data);
    setPublishMode(form, stored.data.publishMode || (stored.data.draft ? "draft" : "publish"));
    form.dataset.dirty = "true";
    stateNode.textContent = "已恢复浏览器临时暂存 · 尚未保存到 Markdown";
  } catch {
    localStorage.removeItem(draftKey(form));
  }
}

function setEditing(form, item) {
  form.dataset.editFile = item?.file || "";
  markFormClean(form, item ? `已保存到 Markdown · ${item.file}` : "");
  if (item) setPublishMode(form, item.draft ? "draft" : "publish");
  if (form === articleForm) {
    form.dataset.originalDraft = item ? String(Boolean(item.draft)) : "";
    form.dataset.previewUrl = item?.previewUrl || "";
    form.dataset.previewed = "false";
    form.dataset.publicationState = item?.publicationState || (item?.draft ? "draft" : "local");
    syncArticleActionState();
  } else {
    syncImageActionState();
  }
}

function syncArticleActionState() {
  const submit = $('button[type="submit"]', articleForm);
  const editing = Boolean(articleForm.dataset.editFile);
  const originalDraft = articleForm.dataset.originalDraft === "true";
  const draft = $('[name="draft"]', articleForm).checked;
  const dirty = isFormDirty(articleForm);
  const previewed = articleForm.dataset.previewed === "true";
  const isPublishingDraft = editing && originalDraft && !draft;
  const isReturningToDraft = editing && !originalDraft && draft;

  if (isPublishingDraft) submit.textContent = "检查并发布草稿";
  else if (isReturningToDraft) submit.textContent = "退回草稿";
  else if (editing && draft) submit.textContent = "保存草稿修改";
  else if (editing) submit.textContent = "检查并保存修改";
  else submit.textContent = draft ? "保存草稿" : "检查并发布文章";

  let nextAction = draft ? "save" : "publish";
  let nextTitle = draft ? "保存草稿" : "发布到本地";
  let nextDescription = draft
    ? "先保存到 Markdown，再使用真实站点模板预览。"
    : "通过质量检查后进入本地公开站点，云端仍不会立即变化。";

  if (editing && !dirty && originalDraft && !previewed) {
    nextAction = "preview";
    nextTitle = "真实预览";
    nextDescription = sitePreviewAvailable
      ? "使用与线上相同的 Astro 模板检查已保存版本。"
      : "站点预览尚未运行，请先在“系统详情与工具”中检查服务。";
  } else if (editing && !dirty && originalDraft && previewed) {
    nextAction = "publish";
    nextTitle = "发布到本地";
    nextDescription = "预览完成后执行质量检查，并把文章加入本地公开站点。";
  } else if (editing && !dirty && !originalDraft) {
    nextAction = "sync";
    nextTitle = "前往待同步";
    nextDescription = "本地内容已保存；下一步选择内容分支并进入 PR 与云端发布流程。";
  }

  articleNextAction.dataset.action = nextAction;
  articleNextAction.textContent = nextTitle;
  articleNextAction.disabled = nextAction === "preview" && (!articleForm.dataset.previewUrl || !sitePreviewAvailable);
  $("#article-next-step-title").textContent = nextTitle;
  $("#article-next-step-description").textContent = nextDescription;

  const stageIndex = { save: 0, preview: 1, publish: 2, sync: 3 }[nextAction] ?? 0;
  for (const [index, step] of $$("[data-journey-stage]", $("#article-publish-journey")).entries()) {
    step.classList.toggle("done", index < stageIndex);
    step.classList.toggle("current", index === stageIndex);
  }

  articlePublishOptions.hidden = !isPublishingDraft;
  $("#article-original-date").textContent = `沿用 ${$('[name="pubDate"]', articleForm).value || "草稿中的收藏日期"}`;
  $("#article-today-date").textContent = `使用 ${today}，按正式发布当天排序`;
  articleRealPreview.disabled = !editing || !articleForm.dataset.previewUrl || !sitePreviewAvailable;
  $("#article-preview-note").textContent = editing
    ? sitePreviewAvailable
      ? "真实预览显示已保存版本；修改后请先保存草稿。"
      : "站点预览服务尚未运行，请使用上方状态区启动或刷新。"
    : "保存草稿后，可用真实站点模板在新页面预览。";
}

function syncImageActionState() {
  const submit = $('button[type="submit"]', imageForm);
  const editing = Boolean(imageForm.dataset.editFile);
  const draft = $('[name="draft"]', imageForm).checked;
  if (editing && draft) submit.textContent = "保存草稿修改";
  else if (editing) submit.textContent = "检查并保存修改";
  else submit.textContent = draft ? "保存图片草稿" : "检查并发布图片";
}

function switchTab(name) {
  $$(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
  $$(".panel").forEach((item) => item.classList.toggle("active", item.id === `${name}-panel`));
  if (name === "library") loadLibrary();
  return true;
}

function applyArticleSuggestion(suggestion, expectedBody) {
  for (const field of ["title", "summary", "tags", "readTime", "editorNote", "source"]) {
    const input = $(`[name="${field}"]`, articleForm);
    const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
    if (input && value) input.value = value;
  }
  let paragraphFormatting = suggestion.paragraphFormatting || "unchanged";
  const bodyInput = $('[name="body"]', articleForm);
  if (paragraphFormatting === "applied") {
    if (bodyInput.value === expectedBody) bodyInput.value = suggestion.body;
    else paragraphFormatting = "stale";
  }
  articleDetails.open = false;
  updateArticlePreview();
  markFormDirty(articleForm);
  saveLocalDraft(articleForm);
  return paragraphFormatting;
}

function applyImageSuggestion(suggestion) {
  for (const field of ["title", "description", "tags", "category", "mood", "scenes", "ratio"]) {
    const input = $(`[name="${field}"]`, imageForm);
    const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
    if (input && value) input.value = value;
  }
  imageDetails.open = false;
  updateImagePreview();
  markFormDirty(imageForm);
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
  syncPublishMode(imageForm);
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
  flomoStats.innerHTML = entries.filter(([label, value]) => label === "总计" || value > 0).map(([label, value]) => `
    <div class="import-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderFlomoInspection(inspection) {
  flomoInspection = inspection;
  flomoAiBodies.clear();
  renderFlomoStats(inspection.stats);
  const renderItem = (item) => {
    const duplicate = item.duplicate
      ? `<p class="import-duplicate">${escapeHtml(item.duplicate.reason)}${item.duplicate.title ? `：${escapeHtml(item.duplicate.title)}` : ""}${item.duplicate.similarity < 1 ? `（相似度 ${Math.round(item.duplicate.similarity * 100)}%）` : ""}</p>`
      : "";
    const sourceWarning = item.sourceReviewReason
      ? `<p class="import-source-warning">${escapeHtml(item.sourceReviewReason)}</p>`
      : "";
    const importGroups = item.importTags?.length
      ? `<p class="import-item-meta">内部导入分组：${escapeHtml(item.importTags.join("、"))}（不公开展示）</p>`
      : "";
    const opensForReview = item.status === "review" || item.status === "similar";
    const sourceLine = item.sourceUrl
      ? `来源：${escapeHtml(item.source || "外部来源")} · ${escapeHtml(item.sourceUrl)}`
      : `来源：${escapeHtml(item.source || "来源待确认")}`;
    return `
      <article class="import-item" data-import-hash="${item.contentHash}" data-status="${item.status}" data-selected="${item.selectedByDefault && item.status !== "exact"}">
        <div class="import-item-heading">
          <label class="import-item-select">
            <input type="checkbox" data-import-select ${item.selectedByDefault ? "checked" : ""} ${item.status === "exact" ? "disabled" : ""} />
            <span data-import-title>${escapeHtml(item.title)}</span>
          </label>
          <span class="import-status">${importStatusLabels[item.status]}</span>
        </div>
        <div class="import-item-meta">${escapeHtml(item.recordedAt)} · ${item.charCount} 字 · ${escapeHtml(item.readTime)}</div>
        ${duplicate}
        ${sourceWarning}
        ${importGroups}
        <p class="import-item-preview" data-import-preview>${escapeHtml(item.summary || item.body.slice(0, 160))}</p>
        <p class="import-item-source">${sourceLine}</p>
        <div class="import-ai-feedback" data-import-ai-feedback hidden>
          <span class="import-ai-status" data-import-ai-status role="status"></span>
          <button type="button" data-import-ai-retry hidden>重试此条</button>
        </div>
        <details class="import-editor" ${opensForReview ? "open" : ""}>
          <summary>复核并编辑</summary>
          <div class="import-editor-content">
            <div class="import-fields">
              <label>候选标题<input data-import-field="title" value="${escapeHtml(item.title)}" /></label>
              <label>标签<input data-import-field="tags" value="${escapeHtml(item.tags.join(", "))}" /></label>
              <label class="import-summary-field">摘要<textarea rows="2" data-import-field="summary">${escapeHtml(item.summary)}</textarea></label>
              <label>来源链接<input type="url" data-import-field="sourceUrl" value="${escapeHtml(item.sourceUrl)}" placeholder="https://example.com/article" /></label>
              <label>来源名称<input data-import-field="source" value="${escapeHtml(item.source)}" placeholder="例如：煎蛋" /></label>
            </div>
            <details class="import-body"><summary>查看导入正文</summary><pre data-import-body>${escapeHtml(item.body)}</pre></details>
          </div>
        </details>
      </article>`;
  };
  const actionable = inspection.items.filter((item) => item.status !== "exact");
  const exact = inspection.items.filter((item) => item.status === "exact");
  const actionableMarkup = actionable.length
    ? actionable.map(renderItem).join("")
    : `<div class="import-clean-state"><strong>没有需要导入的内容</strong><span>${exact.length} 条内容已经存在，未生成重复草稿。</span></div>`;
  const exactMarkup = exact.length
    ? `<details class="import-duplicates" id="flomo-exact-duplicates">
        <summary>已跳过 ${exact.length} 条精确重复，展开查看</summary>
        <div>${exact.map(renderItem).join("")}</div>
      </details>`
    : "";
  flomoList.innerHTML = actionableMarkup + exactMarkup;
  flomoReview.hidden = false;
  flomoCompleteActions.hidden = true;
  updateFlomoSelectionToggle();
}

function selectableImportCheckboxes() {
  return $$("[data-import-select]:not(:disabled)", flomoList);
}

function importSelectionStates() {
  return $$("[data-import-hash]", flomoList).map((card) => {
    const checkbox = $("[data-import-select]", card);
    return {
      card,
      checked: checkbox.checked,
      disabled: checkbox.disabled,
    };
  });
}

function applyFlomoImportFilter(states) {
  for (const state of states) {
    state.card.hidden = !importItemMatchesFilter(state, flomoImportFilter);
  }
}

function updateFlomoSelectionToggle() {
  const button = $("#flomo-toggle-selection");
  const states = importSelectionStates();
  const summary = summarizeImportSelection(states);

  for (const state of states) state.card.dataset.selected = String(state.checked && !state.disabled);
  applyFlomoImportFilter(states);
  const exactDuplicates = $("#flomo-exact-duplicates");
  if (exactDuplicates && flomoImportFilter === "unselected") exactDuplicates.open = true;

  flomoSelectionSummary.textContent = `已选 ${summary.selected} / 可选 ${summary.selectable} / 总计 ${summary.total}`;
  button.textContent = summary.allSelected ? "取消全选" : "全选";
  button.disabled = summary.selectable === 0;
  flomoAiSelected.textContent = flomoAiBusy ? `AI 整理中（${summary.selected}）` : `AI 整理已选（${summary.selected}）`;
  flomoImportSelected.textContent = flomoImportBusy ? `正在生成（${summary.selected}）` : `生成草稿（${summary.selected}）`;
  flomoAiSelected.disabled = flomoAiBusy || summary.selected === 0;
  flomoImportSelected.disabled = flomoImportBusy || summary.selected === 0;
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
    if (flomoAiBodies.has(item.dataset.importHash)) value.body = flomoAiBodies.get(item.dataset.importHash);
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

function setFlomoAiStatus(item, state, message) {
  const card = $(`[data-import-hash="${item.contentHash}"]`, flomoList);
  if (!card) return;
  const feedback = $("[data-import-ai-feedback]", card);
  const status = $("[data-import-ai-status]", card);
  const retry = $("[data-import-ai-retry]", card);
  feedback.hidden = false;
  feedback.dataset.state = state;
  status.textContent = message;
  retry.hidden = state !== "failed";
}

async function organizeImportItem(item, overrides = collectImportOverrides()) {
  setFlomoAiStatus(item, "processing", "AI 整理中…");
  try {
    const suggestion = (await api("/api/ai/article-suggestion", {
      title: overrides[item.contentHash]?.title || item.title,
      source: overrides[item.contentHash]?.source ?? item.source,
      sourceUrl: overrides[item.contentHash]?.sourceUrl ?? item.sourceUrl,
      body: item.body,
    })).suggestion;
    const card = $(`[data-import-hash="${item.contentHash}"]`, flomoList);
    for (const field of ["title", "summary", "tags"]) {
      const input = $(`[data-import-field="${field}"]`, card);
      const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
      if (input && value) input.value = value;
    }
    if (suggestion.title) $("[data-import-title]", card).textContent = suggestion.title;
    if (suggestion.summary) $("[data-import-preview]", card).textContent = suggestion.summary;
    const paragraphFormatting = suggestion.paragraphFormatting || "unchanged";
    if (paragraphFormatting === "applied") {
      flomoAiBodies.set(item.contentHash, suggestion.body);
      $("[data-import-body]", card).textContent = suggestion.body;
    } else {
      flomoAiBodies.delete(item.contentHash);
    }
    const paragraphMessage = paragraphFormatting === "applied"
      ? "长段落已整理，正文字符未改动。"
      : paragraphFormatting === "rejected"
        ? "段落结果涉及正文字符改动，已保留原文。"
        : paragraphFormatting === "too_long"
          ? "正文超过 12,000 字，本次只整理元数据。"
          : "原有段落保持不变。";
    setFlomoAiStatus(item, "done", `AI 已整理，请复核。${paragraphMessage}`);
    return true;
  } catch (error) {
    setFlomoAiStatus(item, "failed", `整理失败：${error.message}`);
    return false;
  }
}

async function aiOrganizeSelectedImports() {
  const items = selectedImportItems();
  if (!items.length) throw new Error("请先选择需要 AI 整理的内容。");
  if (!window.confirm(`将把选中的 ${items.length} 条正文发送给当前配置的 AI 服务，用于生成标题、摘要和标签，并在必要时仅通过新增空行整理长段落。是否继续？`)) return;
  const overrides = collectImportOverrides();
  let completed = 0;
  let failed = 0;
  items.forEach((item) => setFlomoAiStatus(item, "waiting", "等待 AI 整理…"));
  for (const [index, item] of items.entries()) {
    showResult(flomoResult, `AI 正在整理 ${index + 1} / ${items.length}…`);
    const succeeded = await organizeImportItem(item, overrides);
    if (succeeded) completed += 1;
    else failed += 1;
  }
  if (failed) {
    showError(flomoResult, new Error(`AI 已整理 ${completed} 条，${failed} 条失败。可在对应内容卡片中单独重试。`));
  } else {
    showResult(flomoResult, `AI 已整理 ${completed} 条内容。请复核后再生成草稿。`);
  }
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
  flomoCompleteActions.hidden = false;
  $("#flomo-review-drafts").textContent = `前往内容管理查看 ${result.imported} 篇草稿`;
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
  if (!result || typeof result !== "object") return result;
  const lines = [
    result.file ? `已保存：${result.file}` : "内容已保存。",
    result.workflow ? `状态：${result.workflow.label}。${result.workflow.description}` : "",
    result.git?.commitSha ? `本地提交：${result.git.commitSha}` : "",
    result.storage ? `图片存储：${result.storage}` : "",
    result.indexWarning || "",
  ].filter(Boolean);
  if (result.git?.push?.attempted) {
    lines.push(result.git.push.ok
      ? "远程推送成功。"
      : `远程推送失败：${result.git.push.error || "未配置远程仓库。"}\n可在“内容管理”中点击“重试远程推送”。`);
  }
  return lines.join("\n");
}

function renderLibraryCounts(counts = {}) {
  const countTargets = {
    all: "#library-count-all",
    draft: "#library-count-draft",
    local: "#library-count-local",
    online: "#library-count-online",
  };
  for (const [status, selector] of Object.entries(countTargets)) {
    $(selector).textContent = Number(counts[status] || 0);
  }
}

function renderLibraryView() {
  contentList.dataset.view = libraryView;
  for (const button of $$("[data-library-view]")) {
    const active = button.dataset.libraryView === libraryView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function currentLibraryFilter() {
  return {
    type: $("#library-type").value,
    status: libraryStatus,
    query: $("#library-query").value.trim(),
  };
}

function updateLibrarySelection() {
  const summary = summarizeLibrarySelection(librarySelection);
  const selectedCount = summary.count;
  librarySelectionSummary.textContent = summary.label;
  librarySelectionBar.classList.toggle("has-selection", selectedCount > 0);
  $("#library-bulk-publish").disabled = selectedCount === 0;
  $("#library-bulk-draft").disabled = selectedCount === 0;
  $("#library-bulk-edit").disabled = selectedCount === 0;
  $("#library-bulk-sync").disabled = selectedCount === 0;
  $("#library-bulk-trash").disabled = selectedCount === 0;
  $("#library-undo-trash").hidden = lastTrashedItems.length === 0;
  $("#library-clear-selection").disabled = selectedCount === 0;
  const pageFiles = libraryPageItems.map((item) => item.file);
  const selectedOnPage = pageFiles.filter((file) => isLibraryFileSelected(librarySelection, file)).length;
  const pageToggle = $("#library-select-page");
  if (pageToggle) {
    pageToggle.checked = Boolean(pageFiles.length) && selectedOnPage === pageFiles.length;
    pageToggle.indeterminate = selectedOnPage > 0 && selectedOnPage < pageFiles.length;
    pageToggle.setAttribute("aria-label", pageToggle.checked ? "取消选择当前页全部内容" : "选择当前页全部内容");
  }
  const selectFiltered = $("#library-select-filtered");
  const canExpand = librarySelection.mode === "explicit"
    && Boolean(pageFiles.length)
    && selectedOnPage === pageFiles.length
    && libraryTotal > selectedCount;
  selectFiltered.hidden = !canExpand;
  selectFiltered.textContent = canExpand ? `选择符合筛选的全部 ${libraryTotal} 条` : "";
}

function clearLibrarySelection() {
  clearLibrarySelectionState(librarySelection);
  librarySelectedItems.clear();
}

function closeLibraryInspector() {
  activeContent = null;
  libraryPanel.classList.remove("has-detail");
  libraryInspector.hidden = true;
  libraryActions.hidden = true;
  libraryDetail.innerHTML = '<p class="library-empty">从列表选择一条内容查看详情。</p>';
}

function renderLibraryTable(items) {
  libraryPageItems = items;
  if (!items.length) {
    contentList.innerHTML = '<p class="library-empty">没有找到内容。</p>';
    updateLibrarySelection();
    return;
  }
  contentList.innerHTML = `
    <table class="content-table">
      <thead>
        <tr>
          <th class="content-select-cell"><input id="library-select-page" type="checkbox" aria-label="选择当前页全部内容" /></th>
          <th scope="col">标题</th>
          <th scope="col">状态</th>
          <th scope="col">日期</th>
          <th scope="col">标签</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => {
          const active = activeContent?.file === item.file;
          const selected = isLibraryFileSelected(librarySelection, item.file);
          if (selected) librarySelectedItems.set(item.file, item);
          const typeLabel = item.type === "article" ? "文章" : "图片";
          const summary = item.summary || item.bodyExcerpt || "暂无摘要";
          const tags = list(item.tags).slice(0, 2);
          return `
            <tr class="content-item${active ? " active" : ""}" data-content-file="${escapeHtml(item.file)}" data-content-type="${item.type}">
              <td class="content-select-cell">
                <input type="checkbox" data-content-select="${escapeHtml(item.file)}" aria-label="选择《${escapeHtml(item.title)}》" ${selected ? "checked" : ""} />
              </td>
              <td class="content-title-cell">
                <button class="content-title-button" type="button" data-content-open="${escapeHtml(item.file)}" ${active ? 'aria-current="true"' : ""}>${escapeHtml(item.title)}</button>
                <span class="content-item-meta">${typeLabel} · ${escapeHtml(item.source || "未标注来源")}</span>
                <span class="content-item-summary">${escapeHtml(summary)}</span>
              </td>
              <td>
                <span class="workflow-state compact" data-state="${escapeHtml(item.publication?.state || "unknown")}">${escapeHtml(item.publication?.label || "状态待确认")}</span>
              </td>
              <td class="content-date-cell">${escapeHtml(item.pubDate || "未定")}</td>
              <td class="content-tags-cell">${tags.length ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") : "—"}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  renderLibraryView();
  updateLibrarySelection();
}

function paginationWindow(page, pages) {
  if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

function renderLibraryPagination(pagination) {
  libraryPage = pagination.page;
  libraryPages = pagination.pages;
  libraryTotal = pagination.total;
  if (librarySelection.mode === "filter") {
    librarySelection.filteredTotal = pagination.total;
  }
  libraryPageSummary.textContent = pagination.total
    ? `显示 ${pagination.from}–${pagination.to}，共 ${pagination.total} 条`
    : "共 0 条";
  libraryPagination.hidden = pagination.pages <= 1;
  $("#library-page-prev").disabled = pagination.page <= 1;
  $("#library-page-next").disabled = pagination.page >= pagination.pages;
  $("#library-page-numbers").innerHTML = paginationWindow(pagination.page, pagination.pages).map((page) => `
    <button type="button" data-library-page="${page}" class="${page === pagination.page ? "active" : ""}" ${page === pagination.page ? 'aria-current="page"' : ""}>${page}</button>
  `).join("");
  updateLibrarySelection();
}

function setLibraryStatus(status) {
  libraryStatus = status;
  for (const button of $$("[data-library-status]")) {
    const active = button.dataset.libraryStatus === status;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function resetLibraryNavigation({ clearSelection = true } = {}) {
  libraryPage = 1;
  closeLibraryInspector();
  if (clearSelection) clearLibrarySelection();
}

async function loadLibrary() {
  const params = new URLSearchParams({
    type: $("#library-type").value,
    status: libraryStatus,
    sort: $("#library-sort").value,
    query: $("#library-query").value.trim(),
    page: String(libraryPage),
    pageSize: $("#library-page-size").value,
  });
  try {
    const { items, counts, pagination, indexWarning } = await api(`/api/content?${params}`);
    renderLibraryCounts(counts);
    renderLibraryTable(items);
    renderLibraryPagination(pagination);
    if (indexWarning) showResult(libraryResult, indexWarning);
  } catch (error) {
    libraryPageItems = [];
    contentList.innerHTML = '<p class="library-empty">无法读取内容列表。</p>';
    libraryPageSummary.textContent = "读取失败";
    libraryPagination.hidden = true;
    updateLibrarySelection();
    showError(libraryResult, error);
  }
}

function auditItemDetails(item) {
  return [...item.blockers, ...item.warnings, ...item.notices].join("；") || "检查通过";
}

function renderContentAuditGroup(report, status, label) {
  const items = report.items.filter((item) => item.status === status);
  return `
    <details class="content-audit-group" ${status === "ready" ? "" : "open"}>
      <summary>${label} <span>${items.length}</span></summary>
      <div>
        ${items.length ? items.map((item) => `
          <article data-status="${status}">
            <div><strong>${escapeHtml(item.title)}</strong><span>${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.source || "未标注")}</span></div>
            <p>${escapeHtml(auditItemDetails(item))}</p>
            <code>${escapeHtml(item.file)}</code>
          </article>`).join("") : '<p class="library-empty">无。</p>'}
      </div>
    </details>`;
}

async function openContentAudit() {
  $("#content-audit-summary").textContent = "正在检查全部内容…";
  $("#content-audit-list").innerHTML = '<p class="library-empty">正在读取体检结果…</p>';
  contentAuditDialog.showModal();
  try {
    const [report] = await Promise.all([
      api("/api/content/audit"),
      loadTagGovernance(),
    ]);
    $("#content-audit-summary").textContent =
      `可直接上线 ${report.counts.ready} 条 · 需要确认 ${report.counts.review} 条 · 建议退回草稿 ${report.counts.draft} 条`;
    $("#content-audit-list").innerHTML = [
      renderContentAuditGroup(report, "draft", "建议退回草稿"),
      renderContentAuditGroup(report, "review", "需要人工确认"),
      renderContentAuditGroup(report, "ready", "可直接上线"),
    ].join("");
  } catch (error) {
    $("#content-audit-summary").textContent = `体检失败：${error.message}`;
    $("#content-audit-list").innerHTML = "";
  }
}

function renderTagGovernance(report) {
  $("#tag-governance-summary").textContent =
    `${report.counts.tags} 个使用中标签 · ${report.counts.nonCanonical} 个不在规范词表 · 覆盖 ${report.counts.content} 条内容`;
  $("#tag-merge-source").innerHTML = report.tags
    .map((tag) => `<option value="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}（${tag.total}）</option>`)
    .join("");
  $("#tag-merge-target").innerHTML = report.canonicalTags
    .map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`)
    .join("");
  $("#tag-governance-list").innerHTML = report.tags.length
    ? report.tags.map((tag) => `
      <div class="tag-governance-row" data-state="${tag.canonical ? "canonical" : "attention"}">
        <strong>#${escapeHtml(tag.name)}</strong>
        <span>${tag.total} 条 · 文章 ${tag.articles} · 图片 ${tag.images}</span>
        <small>${tag.canonical ? "规范标签" : "需要合并到规范词表"}${tag.similar.length ? ` · 近似：${escapeHtml(tag.similar.join("、"))}` : ""}</small>
      </div>`).join("")
    : '<p class="library-empty">内容库中还没有标签。</p>';
  tagMergePlan = null;
  $("#tag-merge-plan").hidden = true;
}

async function loadTagGovernance() {
  $("#tag-governance-summary").textContent = "正在读取标签使用情况…";
  const report = await api("/api/tags/governance");
  renderTagGovernance(report);
  return report;
}

async function previewTagMerge() {
  const fromTag = $("#tag-merge-source").value;
  const toTag = $("#tag-merge-target").value;
  const planNode = $("#tag-merge-plan");
  try {
    tagMergePlan = await api("/api/tags/merge", { fromTag, toTag, apply: false });
    planNode.hidden = false;
    planNode.innerHTML = `
      <div>
        <strong>${tagMergePlan.count} 条内容将发生变化</strong>
        <span>${escapeHtml(tagMergePlan.fromTag)} → ${escapeHtml(tagMergePlan.toTag)}</span>
      </div>
      ${tagMergePlan.affected.length
        ? `<ul>${tagMergePlan.affected.slice(0, 12).map((item) => `<li>${escapeHtml(item.title)} <code>${escapeHtml(item.file)}</code></li>`).join("")}</ul>`
        : '<p>没有内容使用这个标签。</p>'}
      <button class="primary" type="button" id="tag-merge-apply" ${tagMergePlan.count ? "" : "disabled"}>确认并应用合并</button>`;
    $("#tag-merge-apply")?.addEventListener("click", applyTagMerge);
  } catch (error) {
    tagMergePlan = null;
    planNode.hidden = false;
    planNode.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function applyTagMerge() {
  if (!tagMergePlan?.count) return;
  if (!window.confirm(
    `将修改 ${tagMergePlan.count} 条 Markdown，把“${tagMergePlan.fromTag}”合并到“${tagMergePlan.toTag}”。是否继续？`,
  )) return;
  const button = $("#tag-merge-apply");
  button.disabled = true;
  button.textContent = "正在合并…";
  try {
    const result = await api("/api/tags/merge", {
      fromTag: tagMergePlan.fromTag,
      toTag: tagMergePlan.toTag,
      apply: true,
      confirmation: tagMergePlan.confirmation,
    });
    $("#tag-merge-plan").innerHTML =
      `<p>已更新 ${result.changedFiles.length} 条内容。${escapeHtml(result.indexWarning || "索引与私有快照已刷新。")}</p>`;
    await Promise.all([loadTagGovernance(), loadLibrary()]);
  } catch (error) {
    $("#tag-merge-plan").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function openSyncHistory() {
  $("#sync-history-list").innerHTML = '<p class="library-empty">正在读取同步记录…</p>';
  syncHistoryDialog.showModal();
  try {
    const result = await api("/api/history?action=sync_content&limit=20");
    $("#sync-history-list").innerHTML = result.items.length
      ? result.items.map((item) => `
          <article class="sync-history-item">
            <div><strong>${escapeHtml(item.details.branch || "未知分支")}</strong><time>${escapeHtml(new Date(item.createdAt).toLocaleString("zh-CN"))}</time></div>
            <p>${Number(item.details.count || 0)} 条内容 · ${item.details.pushOk ? "推送成功" : "推送未完成"}</p>
            ${item.details.commitSha ? `<code>${escapeHtml(item.details.commitSha)}</code>` : ""}
            ${item.details.compareUrl ? `<a href="${escapeHtml(item.details.compareUrl)}" target="_blank" rel="noreferrer">打开 GitHub 比较页 ↗</a>` : ""}
          </article>`).join("")
      : '<p class="library-empty">还没有批量同步记录。</p>';
  } catch (error) {
    $("#sync-history-list").innerHTML = `<p class="library-empty">${escapeHtml(error.message)}</p>`;
  }
}

function assetSearchText(item) {
  return [item.title, item.description, item.source, ...item.tags].join(" ").toLocaleLowerCase("zh-CN");
}

function renderAssetLibrary() {
  const query = $("#asset-library-query").value.trim().toLocaleLowerCase("zh-CN");
  const items = assetLibraryItems.filter((item) => !query || assetSearchText(item).includes(query));
  $("#asset-library-list").innerHTML = items.length
    ? items.map((item) => `
      <article class="asset-library-item" data-state="${item.backup.ok && !item.draft ? "ready" : "attention"}">
        <img src="${escapeHtml(item.image)}" alt="" loading="lazy" />
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.description || item.source || "暂无说明")}</p>
          <div class="tags">${renderTags(item.tags)}</div>
          <small>${item.storage === "r2" ? "R2" : item.storage === "local" ? "本地文件" : "外部地址"} · ${escapeHtml(item.backup.label)}${item.license ? ` · ${escapeHtml(item.license)}` : ""}</small>
        </div>
        <button type="button" data-asset-select="${escapeHtml(item.contentId)}">${assetPickerMode === "cover" ? "设为封面" : "插入正文"}</button>
      </article>`).join("")
    : '<p class="library-empty">没有匹配的素材。</p>';
}

async function loadAssetLibrary({ refresh = false } = {}) {
  if (!refresh && assetLibraryItems.length) {
    renderAssetLibrary();
    return;
  }
  $("#asset-library-list").innerHTML = '<p class="library-empty">正在读取素材目录…</p>';
  const report = await api("/api/assets");
  assetLibraryItems = report.items;
  $("#asset-library-summary").textContent =
    `${report.counts.total} 项素材 · ${report.counts.local} 项本地 · ${report.counts.r2} 项 R2 · ${report.counts.attention} 项需留意`;
  renderAssetLibrary();
}

function formatStatusDate(value) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN");
}

function recoveryState(label, value, detail, ok) {
  return `
    <div class="recovery-status-item" data-state="${ok ? "ready" : "attention"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>`;
}

async function loadRecoveryDashboard() {
  const grid = $("#recovery-dashboard-grid");
  grid.innerHTML = "<p>正在读取备份与恢复状态…</p>";
  try {
    const report = await api("/api/storage/dashboard");
    const latest = report.sqliteBackups.latest;
    const drill = report.recoveryDrill;
    const r2Issues = Object.entries(report.r2.counts || {})
      .filter(([name, count]) => !["references", "ledgerRows"].includes(name) && Number(count) > 0)
      .reduce((sum, [, count]) => sum + Number(count), 0);
    grid.innerHTML = [
      recoveryState(
        "SQLite 备份",
        `${report.sqliteBackups.count} 份`,
        latest ? `最近：${formatStatusDate(latest.modifiedAt)}` : "尚未创建手动备份",
        Boolean(latest),
      ),
      recoveryState(
        "私有内容 Git",
        report.contentHistory.ready ? `${report.contentHistory.files} 个文件` : "待创建",
        report.contentHistory.ready ? `最近：${formatStatusDate(report.contentHistory.committedAt)}` : "未找到可用内容快照",
        report.contentHistory.ready,
      ),
      recoveryState(
        "恢复演练",
        drill.ok ? "通过" : drill.neverRun ? "尚未运行" : "需要检查",
        drill.completedAt ? `最近：${formatStatusDate(drill.completedAt)}` : (drill.error || "使用临时数据库验证损坏重建"),
        drill.ok,
      ),
      recoveryState(
        "R2 本地对账",
        report.r2.ok ? "一致" : `${r2Issues} 项异常`,
        `引用 ${report.r2.counts?.references || 0} · 台账 ${report.r2.counts?.ledgerRows || 0}`,
        report.r2.ok,
      ),
    ].join("");
  } catch (error) {
    grid.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function createSafetyBackup(button, resultNode) {
  button.disabled = true;
  resultNode.textContent = "正在创建 SQLite 与私有内容快照…";
  try {
    const result = await api("/api/storage/backup", {});
    resultNode.textContent =
      `备份完成：SQLite ${result.backup}；内容 Git ${result.contentHistory?.commit?.slice(0, 10) || "已检查"}`;
    await loadRecoveryDashboard();
  } catch (error) {
    resultNode.textContent = `备份失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function runRecoveryVerification() {
  const button = $("#system-run-recovery");
  const resultNode = $("#recovery-dashboard-result");
  button.disabled = true;
  resultNode.textContent = "正在临时数据库中模拟损坏并验证自动重建…";
  try {
    const result = await api("/api/storage/recovery-drill", {});
    resultNode.textContent =
      `恢复演练通过：重建 ${result.content} 条内容、${result.trash} 条回收站记录；真实数据未被修改。`;
    await loadRecoveryDashboard();
  } catch (error) {
    resultNode.textContent = `恢复演练失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function openAssetLibrary(mode = "insert") {
  assetPickerMode = mode;
  $("#asset-library-query").value = "";
  assetLibraryDialog.showModal();
  try {
    await loadAssetLibrary();
  } catch (error) {
    $("#asset-library-list").innerHTML = `<p class="library-empty">${escapeHtml(error.message)}</p>`;
  }
}

function selectReusableAsset(item) {
  if (assetPickerMode === "cover") {
    const cover = $('[name="coverImage"]', articleForm);
    const coverAlt = $('[name="coverAlt"]', articleForm);
    if (cover) cover.value = item.image;
    if (coverAlt && !coverAlt.value) coverAlt.value = item.title;
    cover?.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const body = $('[name="body"]', articleForm);
    const markdown = `![${item.title.replaceAll("]", "\\]")}](${item.image})`;
    const before = body.value.slice(0, body.selectionStart);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = body.value.slice(body.selectionEnd) && !body.value.slice(body.selectionEnd).startsWith("\n")
      ? "\n\n"
      : "\n";
    body.setRangeText(`${prefix}${markdown}${suffix}`, body.selectionStart, body.selectionEnd, "end");
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }
  assetLibraryDialog.close();
}

function renderRecycleBin(items) {
  recycleBinItems = items;
  $("#library-trash-count").textContent = String(items.length);
  if (!items.length) {
    trashList.innerHTML = '<p class="library-empty">回收站为空。</p>';
    updateTrashSelection();
    return;
  }
  trashList.innerHTML = items.map((item, index) => `
    <article class="trash-item">
      <input type="checkbox" data-trash-select="${escapeHtml(item.id)}" aria-label="选择回收站中的《${escapeHtml(item.title)}》" ${recycleSelectedIds.has(item.id) ? "checked" : ""} />
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.type === "article" ? "文章" : "图片")} · ${escapeHtml(new Date(item.deletedAt).toLocaleString("zh-CN"))}</p>
        <code>${escapeHtml(item.file)}</code>
      </div>
      <button type="button" data-trash-restore="${index}">恢复</button>
    </article>
  `).join("");
  updateTrashSelection();
}

function updateTrashSelection() {
  const selected = recycleBinItems.filter((item) => recycleSelectedIds.has(item.id));
  $("#trash-selection-summary").textContent = selected.length ? `已选择 ${selected.length} 条` : "未选择内容";
  $("#trash-restore-selected").disabled = selected.length === 0;
  $("#trash-purge-selected").disabled = selected.length === 0;
  const selectAll = $("#trash-select-all");
  selectAll.checked = Boolean(recycleBinItems.length) && selected.length === recycleBinItems.length;
  selectAll.indeterminate = selected.length > 0 && selected.length < recycleBinItems.length;
}

function selectedTrashItems() {
  return recycleBinItems.filter((item) => recycleSelectedIds.has(item.id));
}

async function loadRecycleBin() {
  const result = await api("/api/trash");
  renderRecycleBin(result.items || []);
  return result;
}

async function openRecycleBin() {
  recycleSelectedIds.clear();
  trashList.innerHTML = '<p class="library-empty">正在读取回收站…</p>';
  trashDialog.showModal();
  try {
    await loadRecycleBin();
  } catch (error) {
    trashList.innerHTML = `<p class="library-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function restoreTrashItems(items) {
  if (!items.length) return;
  const result = await api("/api/content/batch", { action: "restore", items });
  for (const item of result.succeeded) recycleSelectedIds.delete(item.id);
  await Promise.all([loadRecycleBin(), loadLibrary(), loadStatus()]);
  if (result.failed.length) {
    throw new Error(`${result.failed.length} 条恢复失败：\n${batchFailureSummary(result.failed)}`);
  }
}

async function purgeSelectedTrash() {
  const items = selectedTrashItems();
  if (!items.length) return;
  if (!window.confirm(
    `将永久删除回收站中的 ${items.length} 条 Markdown？该操作不能从回收站恢复，但本机私有内容快照中可能仍有历史版本。图片文件和 R2 对象不会删除。`,
  )) return;
  const button = $("#trash-purge-selected");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  $("#storage-backup-result").textContent = "正在永久删除所选内容…";
  try {
    const result = await api("/api/content/batch", {
      action: "purge",
      confirmation: "permanent-delete",
      items,
    });
    for (const item of result.succeeded) recycleSelectedIds.delete(item.id);
    await Promise.all([loadRecycleBin(), loadStatus()]);
    $("#storage-backup-result").textContent = result.failed.length
      ? `已删除 ${result.succeeded.length} 条，${result.failed.length} 条失败。`
      : `已永久删除 ${result.succeeded.length} 条回收站内容。`;
  } catch (error) {
    $("#storage-backup-result").textContent = `永久删除失败：${error.message}`;
  } finally {
    button.removeAttribute("aria-busy");
    updateTrashSelection();
  }
}

function renderWorkflowState(workflow) {
  const state = $("#library-workflow-state");
  const description = $("#library-workflow-description");
  if (!state || !description || !workflow) return;
  state.dataset.state = workflow.state;
  state.textContent = workflow.label;
  description.textContent = workflow.description;
}

function renderPublicationState(publication) {
  const state = $("#library-publication-state");
  const description = $("#library-publication-description");
  if (!state || !description || !publication) return;
  state.dataset.state = publication.state;
  state.textContent = publication.label;
  description.textContent = publication.description;
}

async function refreshDeploymentState(item) {
  if (!item || item.data.draft || item.workflow?.state !== "pending_deploy") return;
  try {
    const deployment = await api(`/api/content/deployment?${new URLSearchParams({ type: item.type, file: item.file })}`);
    if (activeContent?.file !== item.file) return;
    activeContent.publication = deployment.state === "live"
      ? { state: "online", label: "云端已发布", description: "云端页面已经匹配当前内容。" }
      : { state: "local", label: "本地已发布", description: deployment.description || "云端还不是当前版本。" };
    renderPublicationState(activeContent.publication);
  } catch {
    if (activeContent?.file === item.file) {
      renderPublicationState({ state: "local", label: "本地已发布", description: "暂时无法核对云端页面。" });
    }
  }
}

function updateLibraryActions(item) {
  if (!item) {
    libraryActions.hidden = true;
    return;
  }
  libraryActions.hidden = false;
  for (const button of $$("button", libraryActions)) button.classList.remove("primary");
  libraryEdit.hidden = false;
  libraryEdit.textContent = item.data.draft ? "打开复核" : "打开编辑";
  libraryTransition.hidden = item.type !== "article";
  libraryTransition.textContent = item.data.draft ? "复核并发布" : "退回草稿";
  libraryPreview.hidden = item.type !== "article" || !item.data.draft || !item.previewUrl || !sitePreviewAvailable;
  const isPublic = !item.data.draft && (item.type === "article" || item.data.public !== false);
  libraryOpen.hidden = !isPublic || !sitePreviewAvailable;
  libraryOpen.textContent = item.type === "article" ? "打开本地文章" : "打开本地图片";
  $("#retry-push").hidden = item.workflow?.state !== "pending_push";
  if (!$("#retry-push").hidden) $("#retry-push").classList.add("primary");
  else if (item.type === "article" && item.data.draft) libraryTransition.classList.add("primary");
  else if (isPublic && !libraryOpen.hidden) libraryOpen.classList.add("primary");
  else libraryEdit.classList.add("primary");
}

async function selectContent(type, file) {
  try {
    const item = await api(`/api/content/read?${new URLSearchParams({ type, file })}`);
    const listItem = libraryPageItems.find((entry) => entry.file === file);
    item.publication = listItem?.publication || (item.data.draft
      ? { state: "draft", label: "草稿", description: "只保存在本地内容库。" }
      : { state: "local", label: "本地已发布", description: "正在核对云端页面。" });
    activeContent = item;
    libraryPanel.classList.add("has-detail");
    libraryInspector.hidden = false;
    updateLibraryActions(item);
    clearResult(libraryResult);
    const internalNote = item.type === "article" && item.data.internalNote
      ? `<div class="internal-review-note"><strong>内部复核备注</strong><p>${escapeHtml(item.data.internalNote)}</p></div>`
      : "";
    libraryDetail.innerHTML = `<div class="library-detail"><p class="eyebrow">${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.data.pubDate || "")}</p><h2>${escapeHtml(item.data.title || "未命名内容")}</h2><p>${escapeHtml(item.data.summary || item.data.description || "")}</p>${internalNote}<div class="tags">${renderTags(item.data.tags)}</div><div class="workflow-summary"><span class="workflow-state" id="library-publication-state" data-state="${escapeHtml(item.publication.state)}">${escapeHtml(item.publication.label)}</span><p id="library-publication-description">${escapeHtml(item.publication.description)}</p><details class="sync-details"><summary>同步详情</summary><span class="workflow-state" id="library-workflow-state" data-state="${escapeHtml(item.workflow?.state || "unknown")}">${escapeHtml(item.workflow?.label || "状态待确认")}</span><p id="library-workflow-description">${escapeHtml(item.workflow?.description || "正在读取发布状态。")}</p></details></div><p class="content-item-meta">${escapeHtml(item.file)}</p></div>`;
    await loadLibrary();
    refreshDeploymentState(item);
  } catch (error) {
    showError(libraryResult, error);
  }
}

function openActiveContent(nextDraft = null) {
  if (!activeContent) return;
  const { type, file, data, body, previewUrl } = activeContent;
  if (type === "article") {
    setFormValues(articleForm, { ...data, tags: list(data.tags).join(", "), body });
    setPublishMode(articleForm, typeof nextDraft === "boolean" ? (nextDraft ? "draft" : "publish") : (data.draft ? "draft" : "publish"));
    syncArticleAttribution();
    articleDetails.open = true;
    setEditing(articleForm, {
      file,
      draft: Boolean(data.draft),
      previewUrl,
      publicationState: activeContent.publication?.state,
    });
    updateArticlePreview();
    switchTab("article");
    if (typeof nextDraft === "boolean") {
      showResult(
        articleResult,
        nextDraft
          ? "已准备退回草稿。确认内容后点击“退回草稿”。"
          : "已进入发布复核。请选择发布日期，确认内容后点击“发布草稿”。",
      );
      articlePublishOptions.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else {
    setFormValues(imageForm, { ...data, tags: list(data.tags).join(", "), mood: list(data.mood).join(", "), scenes: list(data.scenes).join(", "), body });
    setPublishMode(imageForm, data.draft || data.public === false ? "draft" : "publish");
    syncImageAttribution();
    selectedImage = data.image ? { name: "existing-image", dataUrl: data.image } : null;
    imageForm.dataset.image = data.image || "";
    imageDetails.open = true;
    setEditing(imageForm, { file, draft: data.draft || data.public === false });
    updateImagePreview();
    switchTab("image");
  }
}

for (const tab of $$(".tab")) tab.addEventListener("click", () => switchTab(tab.dataset.tab));

for (const input of $$("input, textarea, select", articleForm)) {
  input.addEventListener("input", () => {
    markFormDirty(articleForm);
    syncPublishMode(articleForm);
    syncArticleAttribution();
    syncArticleActionState();
    syncAiAvailability();
    updateArticlePreview();
    saveLocalDraft(articleForm);
  });
  input.addEventListener("change", () => {
    markFormDirty(articleForm);
    syncPublishMode(articleForm);
    syncArticleAttribution();
    syncArticleActionState();
    syncAiAvailability();
    updateArticlePreview();
    saveLocalDraft(articleForm);
  });
}

for (const input of $$("input, textarea, select", imageForm)) {
  input.addEventListener("input", () => {
    markFormDirty(imageForm);
    syncPublishMode(imageForm);
    syncImageAttribution();
    syncImageActionState();
    updateImagePreview();
    saveLocalDraft(imageForm);
  });
  input.addEventListener("change", () => {
    markFormDirty(imageForm);
    syncPublishMode(imageForm);
    syncImageAttribution();
    syncImageActionState();
    updateImagePreview();
    saveLocalDraft(imageForm);
  });
}

for (const button of $$("[data-open-details]")) {
  button.addEventListener("click", () => {
    const details = button.dataset.openDetails === "article" ? articleDetails : imageDetails;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "center" });
  });
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
    markFormDirty(imageForm);
    syncAiAvailability();
    updateImagePreview();
    saveLocalDraft(imageForm);
  } catch (error) {
    selectedImage = null;
    showError(imageResult, error);
  }
});

$('[data-quality="article"]').addEventListener("click", async () => {
  try { showResult(articleResult, formatQuality(await api("/api/quality/article", articlePayload()))); }
  catch (error) { showError(articleResult, error); }
});

$('[data-quality="image"]').addEventListener("click", async () => {
  try { showResult(imageResult, formatQuality(await api("/api/quality/image", imagePayload()))); }
  catch (error) { showError(imageResult, error); }
});

$('[data-ai-fill="article"]').addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "AI 整理中..."; showResult(articleResult, "正在生成可编辑建议...");
  try {
    const payload = formData(articleForm);
    const suggestion = (await api("/api/ai/article-suggestion", payload)).suggestion;
    const paragraphFormatting = applyArticleSuggestion(suggestion, payload.body);
    const paragraphMessage = paragraphFormatting === "applied"
      ? "不合理的长段落已整理；正文内容未改动。"
      : paragraphFormatting === "rejected"
        ? "AI 段落结果涉及正文字符改动，已自动丢弃并保留原文。"
        : paragraphFormatting === "stale"
          ? "整理期间正文有新的编辑，未覆盖当前正文。"
          : paragraphFormatting === "too_long"
            ? "正文超过 12,000 字，本次只整理了元数据，段落保持不变。"
          : "原有段落保持不变。";
    showResult(articleResult, `AI 已填写建议内容。${paragraphMessage}请检查后再发布。`);
  }
  catch (error) { showError(articleResult, error); }
  finally { button.disabled = false; button.textContent = "AI 整理文章资料"; syncAiAvailability(); }
});

$('[data-ai-fill="image"]').addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "AI 整理中..."; showResult(imageResult, "正在识别图片并生成建议...");
  try {
    if (!selectedImage?.dataUrl?.startsWith("data:")) throw new Error("请选择本地图片后再使用 AI 整理。");
    applyImageSuggestion((await api("/api/ai/image-suggestion", { ...formData(imageForm), fileData: selectedImage.dataUrl })).suggestion);
    showResult(imageResult, "AI 已填写建议内容。请检查后再发布。");
  } catch (error) { showError(imageResult, error); }
  finally { button.disabled = false; button.textContent = "AI 整理图片资料"; syncAiAvailability(); }
});

articleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = articlePayload();
    showResult(articleResult, data.draft ? "正在保存文章草稿..." : "正在检查并发布文章...");
    const originalDraft = articleForm.dataset.originalDraft === "true";
    const isPublishingDraft = Boolean(articleForm.dataset.editFile) && originalDraft && !data.draft;
    const isReturningToDraft = Boolean(articleForm.dataset.editFile) && !originalDraft && data.draft;

    if (isPublishingDraft && data.publishDateMode === "today") {
      data.pubDate = today;
      $('[name="pubDate"]', articleForm).value = today;
      updateArticlePreview();
    }

    if (!data.draft) {
      const quality = await api("/api/quality/article", data);
      if (!quality.ok) {
        showResult(articleResult, formatQuality(quality));
        return;
      }
      const warnings = quality.issues.filter((item) => item.level === "warning");
      if (warnings.length && !window.confirm(`发布前请确认：\n${warnings.map((item) => `- ${item.message}`).join("\n")}`)) {
        showResult(articleResult, "已取消发布，请调整内容后再试。");
        return;
      }
    }

    if (isReturningToDraft && !window.confirm("退回草稿后，下一次站点构建将不再公开这篇文章。是否继续？")) {
      showResult(articleResult, "已取消退回草稿。");
      return;
    }

    const result = articleForm.dataset.editFile
      ? await api("/api/content/update", { type: "article", file: articleForm.dataset.editFile, data })
      : await api("/api/publish/article", data);
    localStorage.removeItem(draftKey(articleForm));
    setEditing(articleForm, {
      file: result.file || articleForm.dataset.editFile,
      draft: Boolean(data.draft),
      previewUrl: result.previewUrl || articleForm.dataset.previewUrl,
      publicationState: data.draft ? "draft" : "local",
    });
    showResult(articleResult, formatPublish(result));
    await loadLibrary();
  } catch (error) { showError(articleResult, error); }
});

imageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = imagePayload();
    showResult(imageResult, data.draft ? "正在保存图片草稿..." : "正在检查并发布图片...");
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
    setEditing(imageForm, {
      file: result.file || imageForm.dataset.editFile,
      draft: Boolean(data.draft),
    });
    showResult(imageResult, formatPublish(result));
    await loadLibrary();
  } catch (error) { showError(imageResult, error); }
});

function selectedBatchItems() {
  return [...librarySelectedItems.values()].map((item) => ({
    type: item.type,
    file: item.file,
  }));
}

function selectedBatchRequest() {
  return libraryBatchPayload(librarySelection, selectedBatchItems());
}

async function inspectSelectedBatch() {
  return api("/api/content/batch", {
    action: "inspect-selection",
    ...selectedBatchRequest(),
  });
}

function batchFailureSummary(items = []) {
  if (!items.length) return "";
  const lines = items.slice(0, 4).map((item) => {
    const message = item.error || item.issues?.find((issue) => issue.level === "error")?.message || "处理失败";
    return `- ${item.title || item.file}：${message}`;
  });
  if (items.length > lines.length) lines.push(`- 另有 ${items.length - lines.length} 条需要处理`);
  return lines.join("\n");
}

function retainBatchFailures(items = []) {
  clearLibrarySelection();
  for (const item of items) {
    setLibraryFileSelected(librarySelection, item.file, true);
    librarySelectedItems.set(item.file, item);
  }
}

async function transitionSelectedContent(target) {
  const selection = summarizeLibrarySelection(librarySelection);
  if (!selection.count) return;
  const button = target === "draft" ? $("#library-bulk-draft") : $("#library-bulk-publish");
  const targetLabel = target === "draft" ? "草稿" : "本地发布";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showResult(libraryResult, "正在检查所选内容…");
  try {
    const inspection = await inspectSelectedBatch();
    const eligible = target === "draft"
      ? inspection.counts.local + inspection.counts.online
      : inspection.counts.draft;
    const skipped = inspection.total - eligible;
    const confirmation = [
      `将 ${eligible} 条内容调整为“${targetLabel}”。`,
      skipped ? `${skipped} 条已经处于目标状态，将自动跳过。` : "",
      target === "draft" && inspection.counts.online
        ? `${inspection.counts.online} 条当前已在云端发布，需继续同步后云端页面才会下架。`
        : "",
      "是否继续？",
    ].filter(Boolean).join("\n");
    if (!eligible || !window.confirm(confirmation)) {
      showResult(libraryResult, eligible ? "已取消批量修改。" : `没有需要调整为“${targetLabel}”的内容。`);
      return;
    }
    showResult(libraryResult, `正在批量调整为“${targetLabel}”…`);
    const result = await api("/api/content/batch", {
      action: "transition",
      target,
      ...selectedBatchRequest(),
    });
    retainBatchFailures(result.failed);
    await loadLibrary();
    showResult(
      libraryResult,
      [
        `已将 ${result.succeeded.length} 条内容调整为“${targetLabel}”。`,
        result.skipped.length ? `${result.skipped.length} 条已经处于目标状态，已跳过。` : "",
        result.failed.length ? `${result.failed.length} 条处理失败：\n${batchFailureSummary(result.failed)}` : "",
        target === "draft"
          ? "云端已发布内容需继续同步后，云端页面才会下架。"
          : "本地站点已更新；云端内容尚未变化。",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    showError(libraryResult, error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    updateLibrarySelection();
  }
}

async function syncSelectedContent() {
  const selection = summarizeLibrarySelection(librarySelection);
  if (!selection.count) return;
  const button = $("#library-bulk-sync");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showResult(libraryResult, "正在检查所选内容…");
  try {
    const inspection = await inspectSelectedBatch();
    const eligible = inspection.counts.local + inspection.counts.online;
    if (!eligible) {
      showResult(libraryResult, "所选内容全部是草稿，没有可同步的公开内容。");
      return;
    }
    if (!window.confirm(
      `将同步 ${eligible} 条已发布内容，${inspection.counts.draft} 条草稿会跳过。\n系统会创建或使用内容分支，只提交所选文件并推送。线上正式站点仍需合并 PR 并等待 Cloudflare 部署，是否继续？`,
    )) {
      showResult(libraryResult, "已取消同步。");
      return;
    }
    showResult(libraryResult, "正在准备内容分支并同步所选内容…");
    const result = await api("/api/content/batch", {
      action: "sync",
      ...selectedBatchRequest(),
    });
    if (result.push?.ok) clearLibrarySelection();
    await Promise.all([loadLibrary(), loadStatus()]);
    showResult(
      libraryResult,
      [
        result.push?.ok
          ? `已推送到远程分支 ${result.branch}。`
          : `已完成本地提交，但推送失败：${result.push?.error || "未知错误"}`,
        result.skipped.length ? `${result.skipped.length} 条草稿未参与同步。` : "",
        result.compareUrl ? `下一步创建并合并 PR：${result.compareUrl}` : "",
        "Cloudflare 部署完成后，列表会自动显示为“云端已发布”。",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    showError(libraryResult, error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    updateLibrarySelection();
  }
}

function collectBatchMetadataChanges() {
  const changes = {};
  if ($('[name="applyTags"]', batchEditForm).checked) {
    changes.tags = {
      mode: $('[name="tagsMode"]', batchEditForm).value,
      values: list($('[name="tags"]', batchEditForm).value),
    };
  }
  for (const [toggle, field] of [
    ["applyCategory", "category"],
    ["applySource", "source"],
    ["applyPubDate", "pubDate"],
  ]) {
    if ($(`[name="${toggle}"]`, batchEditForm).checked) {
      changes[field] = { value: $(`[name="${field}"]`, batchEditForm).value };
    }
  }
  return changes;
}

async function applyBatchMetadata(event) {
  event.preventDefault();
  const selection = summarizeLibrarySelection(librarySelection);
  if (!selection.count) return;
  const changes = collectBatchMetadataChanges();
  if (!Object.keys(changes).length) {
    $("#batch-edit-summary").textContent = "请至少勾选一个需要修改的字段。";
    return;
  }
  if (!window.confirm(`将把这些属性修改应用到 ${selection.count} 条内容，是否继续？`)) return;

  const submit = $('button[type="submit"]', batchEditForm);
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  $("#batch-edit-summary").textContent = "正在批量修改…";
  try {
    const result = await api("/api/content/batch", {
      action: "metadata",
      changes,
      ...selectedBatchRequest(),
    });
    retainBatchFailures(result.failed);
    await loadLibrary();
    batchEditDialog.close();
    showResult(
      libraryResult,
      [
        `已更新 ${result.succeeded.length} 条内容。`,
        result.failed.length ? `${result.failed.length} 条失败并保持选中：\n${batchFailureSummary(result.failed)}` : "",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    $("#batch-edit-summary").textContent = `修改失败：${error.message}`;
  } finally {
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
    updateLibrarySelection();
  }
}

async function trashSelectedContent() {
  const selection = summarizeLibrarySelection(librarySelection);
  if (!selection.count) return;
  const button = $("#library-bulk-trash");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showResult(libraryResult, "正在检查所选内容…");
  try {
    const inspection = await inspectSelectedBatch();
    const published = inspection.counts.local + inspection.counts.online;
    const confirmation = [
      `将 ${inspection.total} 条内容移至本地回收站。`,
      published ? `其中 ${published} 条已发布内容会从本地站点移除；云端页面需同步后才会下架。` : "",
      "图片文件和 R2 对象不会删除。是否继续？",
    ].filter(Boolean).join("\n");
    if (!window.confirm(confirmation)) {
      showResult(libraryResult, "已取消移至回收站。");
      return;
    }
    showResult(libraryResult, "正在移至回收站…");
    const result = await api("/api/content/batch", {
      action: "trash",
      ...selectedBatchRequest(),
    });
    retainBatchFailures(result.failed);
    lastTrashedItems = result.succeeded;
    localStorage.setItem("xgif-last-trashed-items", JSON.stringify(lastTrashedItems));
    await loadLibrary();
    await loadStatus();
    showResult(
      libraryResult,
      [
        `已将 ${result.succeeded.length} 条内容移至回收站。`,
        result.failed.length ? `${result.failed.length} 条未删除：\n${batchFailureSummary(result.failed)}` : "",
        result.succeeded.length ? "可点击“撤销删除”恢复到原位置。" : "",
        result.requiresSync ? "其中包含已发布内容；请完成 Git 与 Cloudflare 同步以更新线上站点。" : "",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    showError(libraryResult, error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    updateLibrarySelection();
  }
}

async function restoreLastTrashedDrafts() {
  if (!lastTrashedItems.length) return;
  const button = $("#library-undo-trash");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showResult(libraryResult, "正在恢复最近删除的草稿…");
  try {
    const restoreItems = [...lastTrashedItems];
    const result = await api("/api/content/batch", { action: "restore", items: restoreItems });
    const failedFiles = new Set(result.failed.map((item) => item.file));
    lastTrashedItems = restoreItems.filter((item) => failedFiles.has(item.file));
    localStorage.setItem("xgif-last-trashed-items", JSON.stringify(lastTrashedItems));
    await loadLibrary();
    await loadStatus();
    showResult(
      libraryResult,
      [
        `已恢复 ${result.succeeded.length} 条草稿。`,
        result.failed.length ? `${result.failed.length} 条恢复失败：\n${batchFailureSummary(result.failed)}` : "",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    showError(libraryResult, error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    updateLibrarySelection();
  }
}

contentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-content-open]");
  const row = button?.closest("[data-content-file]");
  if (button && row) selectContent(row.dataset.contentType, row.dataset.contentFile);
});

contentList.addEventListener("change", (event) => {
  if (event.target.id === "library-select-page") {
    setLibraryPageSelected(
      librarySelection,
      libraryPageItems.map((item) => item.file),
      event.target.checked,
    );
    for (const item of libraryPageItems) {
      if (event.target.checked) librarySelectedItems.set(item.file, item);
      else librarySelectedItems.delete(item.file);
    }
    for (const checkbox of $$("[data-content-select]", contentList)) checkbox.checked = event.target.checked;
    updateLibrarySelection();
    return;
  }
  const file = event.target.dataset.contentSelect;
  if (!file) return;
  if (event.target.checked) {
    const item = libraryPageItems.find((entry) => entry.file === file);
    setLibraryFileSelected(librarySelection, file, true);
    if (item) librarySelectedItems.set(file, item);
  } else {
    setLibraryFileSelected(librarySelection, file, false);
    librarySelectedItems.delete(file);
  }
  updateLibrarySelection();
});

for (const button of $$("[data-library-status]")) {
  button.addEventListener("click", () => {
    resetLibraryNavigation();
    setLibraryStatus(button.dataset.libraryStatus);
    loadLibrary();
  });
}

for (const button of $$("[data-library-view]")) {
  button.addEventListener("click", () => {
    libraryView = button.dataset.libraryView;
    localStorage.setItem("xgif-library-view", libraryView);
    renderLibraryView();
  });
}

$("#library-refresh").addEventListener("click", loadLibrary);
$("#library-audit").addEventListener("click", openContentAudit);
$("#article-open-assets").addEventListener("click", () => openAssetLibrary("insert"));
$("#article-cover-assets").addEventListener("click", () => openAssetLibrary("cover"));
$("#asset-library-close").addEventListener("click", () => assetLibraryDialog.close());
$("#asset-library-refresh").addEventListener("click", () => loadAssetLibrary({ refresh: true }));
$("#asset-library-query").addEventListener("input", renderAssetLibrary);
$("#asset-library-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-asset-select]");
  if (!button) return;
  const item = assetLibraryItems.find((candidate) => candidate.contentId === button.dataset.assetSelect);
  if (item) selectReusableAsset(item);
});
assetLibraryDialog.addEventListener("click", (event) => {
  if (event.target === assetLibraryDialog) assetLibraryDialog.close();
});
$("#tag-governance-refresh").addEventListener("click", loadTagGovernance);
$("#tag-merge-preview").addEventListener("click", previewTagMerge);
$("#library-open-trash").addEventListener("click", openRecycleBin);
$("#open-sync-history").addEventListener("click", openSyncHistory);
$("#content-audit-close").addEventListener("click", () => contentAuditDialog.close());
$("#sync-history-close").addEventListener("click", () => syncHistoryDialog.close());
contentAuditDialog.addEventListener("click", (event) => {
  if (event.target === contentAuditDialog) contentAuditDialog.close();
});
syncHistoryDialog.addEventListener("click", (event) => {
  if (event.target === syncHistoryDialog) syncHistoryDialog.close();
});
$("#trash-dialog-close").addEventListener("click", () => trashDialog.close());
trashDialog.addEventListener("click", (event) => {
  if (event.target === trashDialog) trashDialog.close();
});
trashList.addEventListener("change", (event) => {
  const id = event.target.dataset.trashSelect;
  if (!id) return;
  if (event.target.checked) recycleSelectedIds.add(id);
  else recycleSelectedIds.delete(id);
  updateTrashSelection();
});
trashList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-trash-restore]");
  if (!button) return;
  const item = recycleBinItems[Number(button.dataset.trashRestore)];
  if (!item) return;
  button.disabled = true;
  try {
    await restoreTrashItems([item]);
  } catch (error) {
    $("#storage-backup-result").textContent = `恢复失败：${error.message}`;
    button.disabled = false;
  }
});
$("#trash-select-all").addEventListener("change", (event) => {
  recycleSelectedIds.clear();
  if (event.target.checked) {
    for (const item of recycleBinItems) recycleSelectedIds.add(item.id);
  }
  for (const checkbox of $$("[data-trash-select]", trashList)) checkbox.checked = event.target.checked;
  updateTrashSelection();
});
$("#trash-restore-selected").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  $("#storage-backup-result").textContent = "正在恢复所选内容…";
  try {
    const count = selectedTrashItems().length;
    await restoreTrashItems(selectedTrashItems());
    $("#storage-backup-result").textContent = `已恢复 ${count} 条内容。`;
  } catch (error) {
    $("#storage-backup-result").textContent = `恢复失败：${error.message}`;
  } finally {
    button.removeAttribute("aria-busy");
    updateTrashSelection();
  }
});
$("#trash-purge-selected").addEventListener("click", purgeSelectedTrash);
$("#storage-backup").addEventListener("click", (event) =>
  createSafetyBackup(event.currentTarget, $("#storage-backup-result")));
$("#system-create-backup").addEventListener("click", (event) =>
  createSafetyBackup(event.currentTarget, $("#recovery-dashboard-result")));
$("#system-run-recovery").addEventListener("click", runRecoveryVerification);
$("#recovery-dashboard-refresh").addEventListener("click", loadRecoveryDashboard);
$("#status-details").addEventListener("toggle", (event) => {
  if (event.currentTarget.open) loadRecoveryDashboard();
});
$("#library-query").addEventListener("input", () => {
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(() => {
    resetLibraryNavigation();
    loadLibrary();
  }, 250);
});
$("#library-query").addEventListener("search", () => {
  clearTimeout(librarySearchTimer);
  resetLibraryNavigation();
  loadLibrary();
});
$("#library-type").addEventListener("change", () => {
  resetLibraryNavigation();
  loadLibrary();
});
$("#library-page-size").addEventListener("change", (event) => {
  localStorage.setItem("xgif-library-page-size", event.target.value);
  resetLibraryNavigation();
  loadLibrary();
});
$("#library-sort").addEventListener("change", () => {
  resetLibraryNavigation({ clearSelection: false });
  loadLibrary();
});
$("#library-clear-selection").addEventListener("click", () => {
  clearLibrarySelection();
  for (const checkbox of $$("[data-content-select]", contentList)) checkbox.checked = false;
  updateLibrarySelection();
});
$("#library-select-filtered").addEventListener("click", () => {
  selectAllFiltered(librarySelection, currentLibraryFilter(), libraryTotal);
  librarySelectedItems.clear();
  for (const item of libraryPageItems) librarySelectedItems.set(item.file, item);
  for (const checkbox of $$("[data-content-select]", contentList)) checkbox.checked = true;
  updateLibrarySelection();
});
$("#library-bulk-publish").addEventListener("click", () => transitionSelectedContent("local"));
$("#library-bulk-draft").addEventListener("click", () => transitionSelectedContent("draft"));
$("#library-bulk-edit").addEventListener("click", () => {
  batchEditForm.reset();
  $('[name="pubDate"]', batchEditForm).value = today;
  $("#batch-edit-summary").textContent = `${summarizeLibrarySelection(librarySelection).label}。只会修改勾选的字段。`;
  batchEditDialog.showModal();
});
$("#library-bulk-sync").addEventListener("click", syncSelectedContent);
$("#library-bulk-trash").addEventListener("click", trashSelectedContent);
$("#library-undo-trash").addEventListener("click", restoreLastTrashedDrafts);
$("#batch-edit-close").addEventListener("click", () => batchEditDialog.close());
$("#batch-edit-cancel").addEventListener("click", () => batchEditDialog.close());
batchEditDialog.addEventListener("click", (event) => {
  if (event.target === batchEditDialog) batchEditDialog.close();
});
batchEditForm.addEventListener("submit", applyBatchMetadata);
$("#library-page-prev").addEventListener("click", () => {
  if (libraryPage <= 1) return;
  libraryPage -= 1;
  loadLibrary();
});
$("#library-page-next").addEventListener("click", () => {
  if (libraryPage >= libraryPages) return;
  libraryPage += 1;
  loadLibrary();
});
$("#library-page-numbers").addEventListener("click", (event) => {
  const button = event.target.closest("[data-library-page]");
  if (!button) return;
  libraryPage = Number(button.dataset.libraryPage);
  loadLibrary();
});
libraryEdit.addEventListener("click", () => openActiveContent());
libraryTransition.addEventListener("click", () => {
  if (!activeContent || activeContent.type !== "article") return;
  openActiveContent(!Boolean(activeContent.data.draft));
});
libraryPreview.addEventListener("click", () => {
  if (!activeContent?.previewUrl || libraryPreview.hidden) return;
  window.open(activeContent.previewUrl, "_blank", "noopener");
});
libraryOpen.addEventListener("click", () => {
  if (!activeContent?.publicUrl || libraryOpen.hidden) return;
  window.open(activeContent.publicUrl, "_blank", "noopener");
});

function openArticleRealPreview() {
  if (!articleForm.dataset.previewUrl || articleRealPreview.disabled) return;
  window.open(articleForm.dataset.previewUrl, "_blank", "noopener");
  articleForm.dataset.previewed = "true";
  syncArticleActionState();
}

articleRealPreview.addEventListener("click", openArticleRealPreview);
articleNextAction.addEventListener("click", () => {
  const action = articleNextAction.dataset.action;
  if (action === "preview") {
    openArticleRealPreview();
    return;
  }
  if (action === "sync") {
    $("#library-type").value = "all";
    $("#library-query").value = "";
    resetLibraryNavigation();
    setLibraryStatus("local");
    switchTab("library", { force: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  setPublishMode(articleForm, action === "publish" ? "publish" : "draft");
  syncArticleActionState();
  articleForm.requestSubmit();
});
$("#open-site-preview").addEventListener("click", () => {
  if (!sitePreviewAvailable) return;
  window.open(sitePreviewUrl, "_blank", "noopener");
});
$("#refresh-services").addEventListener("click", loadStatus);
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
  flomoAiBodies.clear();
  flomoImportFilter = "all";
  flomoOnlyUnselected.checked = false;
  flomoReview.hidden = true;
  flomoCompleteActions.hidden = true;
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

$("#flomo-toggle-selection").addEventListener("click", () => {
  const checkboxes = selectableImportCheckboxes();
  const shouldSelect = !checkboxes.every((checkbox) => checkbox.checked);
  for (const checkbox of checkboxes) checkbox.checked = shouldSelect;
  updateFlomoSelectionToggle();
});

flomoList.addEventListener("change", (event) => {
  if (event.target.matches("[data-import-select]")) updateFlomoSelectionToggle();
});

flomoOnlyUnselected.addEventListener("change", () => {
  flomoImportFilter = flomoOnlyUnselected.checked ? "unselected" : "all";
  updateFlomoSelectionToggle();
});

flomoList.addEventListener("click", async (event) => {
  const retry = event.target.closest("[data-import-ai-retry]");
  if (!retry) return;
  const card = retry.closest("[data-import-hash]");
  const item = flomoInspection?.items.find((entry) => entry.contentHash === card.dataset.importHash);
  if (!item) return;
  retry.disabled = true;
  const succeeded = await organizeImportItem(item);
  if (succeeded) showResult(flomoResult, "该条内容已重新整理，请复核后再生成草稿。");
  else showError(flomoResult, new Error("该条内容仍未整理成功，请检查 AI 配置或稍后重试。"));
  retry.disabled = false;
});

flomoAiSelected.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  flomoAiBusy = true;
  updateFlomoSelectionToggle();
  button.setAttribute("aria-busy", "true");
  try { await aiOrganizeSelectedImports(); }
  catch (error) { showError(flomoResult, error); }
  finally {
    flomoAiBusy = false;
    button.removeAttribute("aria-busy");
    updateFlomoSelectionToggle();
  }
});

flomoImportSelected.addEventListener("click", async (event) => {
  flomoImportBusy = true;
  updateFlomoSelectionToggle();
  try { await applyFlomoImport(); }
  catch (error) { showError(flomoResult, error); }
  finally {
    flomoImportBusy = false;
    updateFlomoSelectionToggle();
  }
});

$("#flomo-review-drafts").addEventListener("click", () => {
  $("#library-type").value = "article";
  $("#library-query").value = "";
  resetLibraryNavigation();
  setLibraryStatus("draft");
  switchTab("library");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("#open-pending-content").addEventListener("click", () => {
  $("#library-type").value = "all";
  $("#library-query").value = "";
  resetLibraryNavigation();
  setLibraryStatus("local");
  switchTab("library");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

async function loadStatus() {
  try {
    const status = await api("/api/status");
    const ai = status.ai?.available ? `AI：${status.ai.model}` : "AI：未配置";
    const remote = status.git?.canPush ? "远程：已配置" : "远程：未配置";
    const localIndex = status.localData?.ok ? "索引：正常" : "索引：需重启恢复";
    const gitContent = status.contentSafety?.ok
      ? `内容 Git：${status.contentSafety.currentVersionInGit}/${status.contentSafety.total}`
      : "内容 Git：待检查";
    const privateHistory = status.localContentHistory?.ready ? "私有快照：正常" : "私有快照：待创建";
    $("#status").textContent = `仓库：${status.repoRoot} · 分支：${status.branch} · ${ai} · ${remote} · ${localIndex} · ${gitContent} · ${privateHistory}`;
    $("#library-trash-count").textContent = String(status.localData?.trash || 0);
    const publisher = $("#publisher-service");
    publisher.dataset.state = "ready";
    publisher.textContent = "管理端运行中";
    const preview = $("#site-preview-service");
    sitePreviewAvailable = Boolean(status.services?.sitePreview?.available);
    sitePreviewUrl = status.services?.sitePreview?.url || sitePreviewUrl;
    preview.dataset.state = sitePreviewAvailable ? "ready" : "offline";
    preview.textContent = sitePreviewAvailable ? "站点预览运行中" : "站点预览未运行";
    $("#open-site-preview").disabled = !sitePreviewAvailable;
    const publicPending = Number(status.publicationCounts?.local || 0);
    const syncSummary = $("#content-sync-summary");
    syncSummary.dataset.state = publicPending ? "attention" : "ready";
    syncSummary.textContent = publicPending ? `${publicPending} 条公开内容待同步` : "公开内容已记录";
    $("#open-pending-content").textContent = publicPending ? `查看待同步（${publicPending}）` : "查看待同步";
    const health = $("#publisher-health");
    const healthLabel = $("#publisher-health-label");
    const healthDetail = $("#publisher-health-detail");
    health.dataset.state = !sitePreviewAvailable || publicPending ? "attention" : "ready";
    if (!sitePreviewAvailable) {
      healthLabel.textContent = "发布台可用，站点预览未运行";
      healthDetail.textContent = "打开系统详情检查预览服务后再进行真实预览";
    } else if (publicPending) {
      healthLabel.textContent = `${publicPending} 条内容等待同步`;
      healthDetail.textContent = "本地预览可用；云端仍以 PR、部署与线上核验为准";
    } else {
      healthLabel.textContent = "本地发布环境已就绪";
      healthDetail.textContent = "发布台、站点预览与公开内容状态正常";
    }
    for (const gitControl of $$('input[name="commit"], input[name="push"]')) {
      const description = $(".check-copy small", gitControl.closest("label"));
      description.dataset.defaultText ||= description.textContent;
      if (status.branch === "main") gitControl.checked = false;
      gitControl.disabled = status.branch === "main";
      description.textContent = status.branch === "main"
        ? `${description.dataset.defaultText}（main 分支已停用）`
        : description.dataset.defaultText;
      gitControl.closest("label").title = status.branch === "main"
        ? "main 分支受保护，请先切换到内容分支。"
        : "";
    }
    $("#article-advanced-summary").textContent = status.branch === "main"
      ? "精选 · main 分支不执行 Git 操作"
      : "精选与版本控制";
    $("#image-advanced-summary").textContent = status.branch === "main"
      ? "日期、比例、正文 · main 分支不执行 Git 操作"
      : "日期、比例、正文与版本控制";
    updateLibraryActions(activeContent);
    syncArticleActionState();
  } catch {
    $("#status").textContent = "无法读取 Git 状态，但仍可生成本地内容文件。";
    $("#publisher-health").dataset.state = "error";
    $("#publisher-health-label").textContent = "无法读取完整环境状态";
    $("#publisher-health-detail").textContent = "可继续编辑；发布或同步前请展开系统详情重新检查";
  }
}

restoreLocalDraft(articleForm, $("#article-editor-state"));
restoreLocalDraft(imageForm, $("#image-editor-state"));
syncPublishMode(articleForm);
syncPublishMode(imageForm);
syncArticleAttribution();
syncImageAttribution();
syncArticleActionState();
syncImageActionState();
syncAiAvailability();
const storedLibraryPageSize = localStorage.getItem("xgif-library-page-size");
if (["15", "30", "50"].includes(storedLibraryPageSize)) {
  $("#library-page-size").value = storedLibraryPageSize;
}
setLibraryStatus(libraryStatus);
renderLibraryView();
updateArticlePreview();
updateImagePreview();
loadStatus();

window.addEventListener("beforeunload", (event) => {
  if (!isFormDirty(articleForm) && !isFormDirty(imageForm)) return;
  event.preventDefault();
  event.returnValue = "";
});
