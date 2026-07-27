import { importItemMatchesFilter, summarizeImportSelection } from "./import-selection.js";
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
import {
  libraryItemPresentation,
  libraryTaskPresentation,
} from "./library-presentation.js";

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
const articleBody = $("#article-body");
const articleTitleAi = $("#article-title-ai");
const articleTitleSuggestions = $("#article-title-suggestions");
const articleTitleCandidateList = $("#article-title-candidate-list");
const articleTitleAiStatus = $("#article-title-ai-status");
const articleAuditGuidance = $("#article-audit-guidance");
const articleAuditIssues = $("#article-audit-issues");
const articleAuditNextStep = $("#article-audit-next-step");
const workspacePageTitle = $("#workspace-page-title");
const contentList = $("#content-list");
const libraryDetail = $("#library-detail");
const libraryResult = $("#library-result");
const libraryFeedback = $("#library-feedback");
const libraryEdit = $("#library-edit");
const libraryDuplicate = $("#library-duplicate");
const libraryReturnDraft = $("#library-return-draft");
const librarySyncCurrent = $("#library-sync-current");
const libraryPreview = $("#library-preview");
const libraryOpen = $("#library-open");
const libraryActions = $("#library-actions");
const libraryPanel = $("#library-panel");
const libraryMain = $(".library-main", libraryPanel);
const libraryInspector = $("#library-inspector");
const libraryInspectorDialogQuery = window.matchMedia("(max-width: 1280px)");
const librarySelectionSummary = $("#library-selection-summary");
const libraryPageSummary = $("#library-page-summary");
const libraryPagination = $("#library-pagination");
const trashDialog = $("#trash-dialog");
const trashList = $("#trash-list");
const batchEditDialog = $("#batch-edit-dialog");
const batchEditForm = $("#batch-edit-form");
const assetLibraryDialog = $("#asset-library-dialog");
const versionHistoryDialog = $("#version-history-dialog");
const articlePublishOptions = $("#article-publish-options");
const articleRealPreview = $("#article-real-preview");
const articleNextAction = $("#article-next-action");
const articleSaveDraft = $("#article-save-draft");
const imageRealPreview = $("#image-real-preview");
const imageNextAction = $("#image-next-action");
const imageSaveDraft = $("#image-save-draft");
const articleCoverAltField = $("#article-cover-alt-field");
const librarySelectionBar = $("#library-selection-bar");
const flomoFileInput = $("#flomo-file");
const flomoReview = $("#flomo-review");
const flomoStats = $("#flomo-stats");
const flomoList = $("#flomo-list");
const flomoResult = $("#flomo-result");
const flomoSelectionSummary = $("#flomo-selection-summary");
const flomoOnlyUnselected = $("#flomo-only-unselected");
const flomoCompleteActions = $("#flomo-complete-actions");
const flomoPublishSelected = $("#flomo-publish-selected");
const flomoImportSelected = $("#flomo-import-selected");
let selectedImage = null;
let activeContent = null;
let flomoFileData = "";
let flomoInspection = null;
const flomoAiBodies = new Map();
let flomoImportFilter = "all";
let flomoImportBusy = false;
let sitePreviewAvailable = false;
let sitePreviewUrl = "http://127.0.0.1:4321/";
let publisherStatus = null;
let aiAvailable = null;
let aiModel = "";
let libraryStatus = "all";
let libraryView = localStorage.getItem("xgif-library-view") === "excerpt" ? "excerpt" : "compact";
let libraryPage = 1;
let libraryPages = 1;
let libraryTotal = 0;
let libraryPageItems = [];
let libraryCounts = {
  all: 0,
  draft: 0,
  local: 0,
  pending: 0,
  unknown: 0,
  online: 0,
  unverified: 0,
  cloud: 0,
  attention: 0,
};
let libraryBatchMode = false;
let librarySearchTimer = null;
let libraryRequestController = null;
let libraryRequestSequence = 0;
let contentAuditItemsByFile = new Map();
let recycleBinItems = [];
let trashReturnFocus = null;
const recycleSelectedIds = new Set();
const librarySelection = createLibrarySelection();
const librarySelectedItems = new Map();
let lastTrashedItems = [];
let libraryUndoAvailableForFeedback = false;
let tagMergePlan = null;
let assetLibraryItems = [];
let assetPickerMode = "insert";
let versionHistoryForm = articleForm;

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

async function apiRequest(path, payload, { retrySession = true, signal } = {}) {
  const csrfToken = payload ? await getCsrfToken() : "";
  const response = await fetch(path, {
    method: payload ? "POST" : "GET",
    headers: payload
      ? { "content-type": "application/json", "x-xgif-csrf": csrfToken }
      : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (payload && response.status === 403 && retrySession) {
    await getCsrfToken({ refresh: true });
    return apiRequest(path, payload, { retrySession: false, signal });
  }
  if (!response.ok) {
    const detail = data.detail ? `\n${data.detail}` : "";
    throw new Error(`${data.error || "请求失败"}${detail}`);
  }
  return data;
}

async function api(path, payload, options) {
  return apiRequest(path, payload, options);
}
function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of $$('input[type="checkbox"]', form)) data[checkbox.name] = checkbox.checked;
  return data;
}

function articlePayload() {
  syncPublishMode(articleForm);
  const data = formData(articleForm);
  data.commit = false;
  data.push = false;
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

function formatDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) return "尚未核对";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setArticleInspectorTab(name = "details") {
  const tabs = ["details", "source", "cover", "preview"];
  const selected = tabs.includes(name) ? name : "details";
  for (const button of $$("[data-article-inspector-tab]")) {
    const active = button.dataset.articleInspectorTab === selected;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of $$("[data-article-inspector-panel]")) {
    panel.hidden = panel.dataset.articleInspectorPanel !== selected;
  }
}

function setImageInspectorTab(name = "details") {
  const tabs = ["details", "source", "settings"];
  const selected = tabs.includes(name) ? name : "details";
  for (const button of $$("[data-image-inspector-tab]")) {
    const active = button.dataset.imageInspectorTab === selected;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of $$("[data-image-inspector-panel]")) {
    panel.hidden = panel.dataset.imageInspectorPanel !== selected;
  }
}

function updateImageInspectorStatus(data = formData(imageForm)) {
  const detailsReady = ["title", "description", "tags"]
    .every((field) => String(data[field] || "").trim());
  $("#image-details-tab-status").textContent = detailsReady ? "已填写" : "待完善";
  const hasSourceUrl = Boolean(String(data.sourceUrl || "").trim());
  let sourceStatus = "待核实";
  if (data.sourceKind === "original") {
    sourceStatus = hasSourceUrl ? "已填写" : "待补充";
  } else if (data.sourceKind === "user_provided") {
    sourceStatus = "用户提供";
  }
  $("#image-source-tab-status").textContent = sourceStatus;
  $("#image-settings-tab-status").textContent = data.pubDate || "自动";
  const ratioLabels = { square: "方图", wide: "宽图", tall: "长图" };
  $("#image-ratio-summary").textContent = selectedImage
    ? `${ratioLabels[data.ratio] || "自动识别"} · 根据图片尺寸生成`
    : "选择图片后自动识别";
}

function updateArticleInspectorStatus(data = formData(articleForm)) {
  const summaryReady = String(data.summary || "").trim() && String(data.tags || "").trim();
  $("#article-details-tab-status").textContent = summaryReady ? "已填写" : "待完善";

  const sourceKind = String(data.sourceKind || "unknown");
  const sourceUrl = String(data.sourceUrl || "").trim();
  $("#article-source-tab-status").textContent = sourceKind === "original"
    ? "原创"
    : sourceKind === "publication" && sourceUrl
      ? "已填写"
      : sourceKind === "publication"
        ? "缺链接"
        : "待确认";

  const sourceName = String(data.source || "").trim() || "来源待确认";
  $("#article-source-summary-text").textContent =
    `${sourceName} · ${sourceUrl ? "已有原文链接" : "未填写原文链接"}`;
  $("#article-cover-tab-status").textContent = String(data.coverImage || "").trim() ? "已设置" : "可选";
}

function updateArticlePreview() {
  updateArticleBodyTools();
  const data = formData(articleForm);
  $("#article-preview").innerHTML = `
    ${data.coverImage ? `<img class="article-preview-cover" src="${escapeHtml(data.coverImage)}" alt="" />` : ""}
    <div class="meta"><span>${escapeHtml(data.source || "来源")}</span><span>${escapeHtml(data.pubDate || today)}</span><span>${escapeHtml(data.readTime || "1 分钟")}</span></div>
    <h2>${escapeHtml(data.title || "文章标题")}</h2>
    <p class="summary">${escapeHtml(data.summary || "文章摘要会显示在这里。")}</p>
    ${data.editorNote ? `<blockquote class="note">${escapeHtml(data.editorNote)}</blockquote>` : ""}
    <div class="tags">${renderTags(data.tags)}</div>`;
  updateArticleReview(data);
  articleCoverAltField.hidden = !String(data.coverImage || "").trim();
  updateArticleInspectorStatus(data);
  if (activeContent?.audit) renderArticleAuditGuidance(activeContent.audit, data);
}

function updateArticleBodyTools() {
  const body = articleBody.value;
  const characters = Array.from(body.replace(/\s/gu, "")).length;
  const paragraphs = body.split(/\n\s*\n/gu).filter((item) => item.trim()).length;
  $('[name="readTime"]', articleForm).value = `${Math.max(1, Math.ceil(characters / 500))} 分钟`;
  $("#article-body-stats").textContent = `${characters} 字，${paragraphs} 段`;
  const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gmu)];
  $("#article-outline").innerHTML = headings.length
    ? `<strong>目录</strong>${headings.map((match) => `
        <button type="button" data-outline-position="${match.index}" style="--outline-level:${match[1].length}">${escapeHtml(match[2].trim())}</button>
      `).join("")}`
    : '<span>添加 Markdown 标题后，这里会生成目录。</span>';
}

function replaceArticleSelection(text, selectionStart = null, selectionEnd = null) {
  const start = selectionStart ?? articleBody.selectionStart;
  const end = selectionEnd ?? articleBody.selectionEnd;
  articleBody.setRangeText(text, start, end, "select");
  articleBody.focus();
  articleBody.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyMarkdownAction(action) {
  const selected = articleBody.value.slice(articleBody.selectionStart, articleBody.selectionEnd);
  const fallback = selected || {
    heading: "小标题",
    bold: "重点内容",
    italic: "强调内容",
    quote: "引用内容",
    bullet: "列表项目",
    link: "链接文字",
  }[action] || "";
  const transformed = {
    heading: `## ${fallback}`,
    bold: `**${fallback}**`,
    italic: `*${fallback}*`,
    quote: fallback.split("\n").map((line) => `> ${line}`).join("\n"),
    bullet: fallback.split("\n").map((line) => `- ${line}`).join("\n"),
    link: `[${fallback}](https://)`,
  }[action];
  if (transformed) replaceArticleSelection(transformed);
}

function findArticleText({ replace = false, replaceAll = false } = {}) {
  const query = $("#article-find").value;
  const replacement = $("#article-replace").value;
  const status = $("#article-find-status");
  if (!query) {
    status.textContent = "请输入要查找的内容。";
    return;
  }
  if (replaceAll) {
    const matches = articleBody.value.split(query).length - 1;
    if (!matches) {
      status.textContent = "没有找到匹配内容。";
      return;
    }
    articleBody.value = articleBody.value.split(query).join(replacement);
    articleBody.dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent = `已替换 ${matches} 处。`;
    return;
  }
  let index = articleBody.value.indexOf(query, articleBody.selectionEnd);
  if (index < 0) index = articleBody.value.indexOf(query);
  if (index < 0) {
    status.textContent = "没有找到匹配内容。";
    return;
  }
  if (replace) {
    replaceArticleSelection(replacement, index, index + query.length);
    status.textContent = "已替换当前匹配。";
    return;
  }
  articleBody.focus();
  articleBody.setSelectionRange(index, index + query.length);
  status.textContent = `已定位到第 ${index + 1} 个字符。`;
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("无法读取图片文件。")));
    reader.readAsDataURL(file);
  });
}

async function uploadArticleImage(file) {
  if (!file?.type?.startsWith("image/")) return;
  updateFormSaveState(articleForm, "正在保存正文图片…");
  try {
    const result = await api("/api/assets/upload", {
      fileName: file.name,
      fileData: await fileDataUrl(file),
    });
    const alt = file.name.replace(/\.[^.]+$/u, "") || "正文图片";
    replaceArticleSelection(`![${alt}](${result.url})`);
    updateFormSaveState(articleForm, `图片已保存到 ${result.storage === "local" ? "本地站点" : "R2"}，正文尚未保存到 Markdown`);
  } catch (error) {
    updateFormSaveState(articleForm, `图片保存失败：${error.message}`);
  }
}

function updateImagePreview() {
  const data = formData(imageForm);
  const image = selectedImage?.dataUrl || "";
  $("#image-preview-stage").dataset.empty = String(!image);
  $("#image-preview").innerHTML = `
    ${image ? `<img src="${image}" alt="${escapeHtml(data.title || "图片预览")}" />` : ""}
    <div class="copy"><div class="meta"><span>${escapeHtml(data.category || "表情包")}</span><span>${escapeHtml(data.pubDate || today)}</span></div>
    <h2>${escapeHtml(data.title || "图片标题")}</h2><p class="summary">${escapeHtml(data.description || "图片说明会显示在这里。")}</p>
    <div class="tags">${renderTags(data.tags)}</div></div>`;
  updateImageReview(data);
  updateImageInspectorStatus(data);
}

function updateArticleReview(data = formData(articleForm)) {
  const tags = list(data.tags);
  $("#article-ai-title").textContent = data.title || "等待整理文章资料";
  $("#article-ai-summary").textContent = data.summary
    ? `${data.summary}${tags.length ? ` · ${tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}` : ""}`
    : "整理后在这里快速复核标题、摘要和标签。";
}

function articleTitleSuggestionPayload() {
  const data = formData(articleForm);
  return {
    title: data.title,
    summary: data.summary,
    source: data.source,
    sourceUrl: data.sourceUrl,
    body: data.body,
  };
}

function renderArticleTitleSuggestions(titles) {
  articleTitleCandidateList.replaceChildren();
  for (const title of titles) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.titleCandidate = title;
    button.setAttribute("aria-pressed", "false");
    button.textContent = title;
    articleTitleCandidateList.append(button);
  }
  articleTitleSuggestions.hidden = false;
  articleTitleAi.textContent = "再生成一组";
  articleTitleAiStatus.dataset.state = "ready";
  articleTitleAiStatus.textContent = "已生成 3 个候选标题，请选择一个。";
}

function syncArticleTitleCandidateSelection() {
  const currentTitle = $('[name="title"]', articleForm).value.trim();
  for (const button of $$("[data-title-candidate]", articleTitleCandidateList)) {
    button.setAttribute("aria-pressed", String(button.dataset.titleCandidate === currentTitle));
  }
}

function applyArticleTitleSuggestion(title) {
  const titleInput = $('[name="title"]', articleForm);
  titleInput.value = title;
  markFormDirty(articleForm);
  syncArticleActionState();
  syncAiAvailability();
  updateArticlePreview();
  saveLocalDraft(articleForm);
  syncArticleTitleCandidateSelection();
  articleTitleAiStatus.dataset.state = "applied";
  articleTitleAiStatus.textContent = "已采用候选标题，尚未保存到 Markdown。";
}

function resetArticleTitleSuggestions() {
  articleTitleCandidateList.replaceChildren();
  articleTitleSuggestions.hidden = true;
  articleTitleAi.textContent = "AI 标题建议";
  articleTitleAiStatus.dataset.state = "";
  articleTitleAiStatus.textContent = "";
}

function invalidateArticleTitleSuggestions() {
  if (articleTitleSuggestions.hidden) return;
  articleTitleCandidateList.replaceChildren();
  articleTitleSuggestions.hidden = true;
  articleTitleAi.textContent = "只生成标题";
  articleTitleAiStatus.dataset.state = "stale";
  articleTitleAiStatus.textContent = "文章资料已修改，请重新生成候选标题。";
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
  const articleSourceAvailable = [articleData.title, articleData.sourceUrl, articleData.body]
    .some((value) => String(value || "").trim());
  const articleAi = $('[data-ai-fill="article"]');
  articleAi.disabled = aiAvailable !== true || !articleSourceAvailable;
  $("#article-ai-availability").textContent = aiAvailable === null
    ? "正在检查 AI 配置"
    : aiAvailable === false
      ? "AI 未配置，可在系统状态中查看"
      : articleSourceAvailable
        ? `将发送当前文章资料到 ${aiModel || "已配置模型"}`
        : "先填写正文、标题或来源链接";
  const titleSourceAvailable = [articleData.body, articleData.summary, articleData.sourceUrl]
    .some((value) => String(value || "").trim());
  const titleAiBusy = articleTitleAi.getAttribute("aria-busy") === "true";
  articleTitleAi.disabled = titleAiBusy || aiAvailable !== true || !titleSourceAvailable;
  if (aiAvailable === false && articleTitleAiStatus.dataset.state !== "busy") {
    articleTitleAiStatus.dataset.state = "hint";
    articleTitleAiStatus.textContent = "AI 未配置，请先在系统状态中检查模型服务。";
  } else if (!titleSourceAvailable && articleTitleAiStatus.dataset.state !== "busy") {
    articleTitleAiStatus.dataset.state = "hint";
    articleTitleAiStatus.textContent = "填写正文、摘要或来源链接后可生成候选标题。";
  } else if (titleSourceAvailable && articleTitleAiStatus.dataset.state === "hint") {
    articleTitleAiStatus.dataset.state = "";
    articleTitleAiStatus.textContent = "";
  }
  const imageAi = $('[data-ai-fill="image"]');
  const localImageAvailable = Boolean(selectedImage?.dataUrl?.startsWith("data:"));
  imageAi.disabled = aiAvailable !== true || !localImageAvailable;
  $("#image-ai-availability").textContent = aiAvailable === null
    ? "正在检查 AI 配置"
    : aiAvailable === false
      ? "AI 未配置，可在系统状态中查看。"
      : localImageAvailable
        ? `将发送当前图片到 ${aiModel || "已配置模型"}`
        : "选择本地图片后可以使用 AI 整理。";
}

function syncArticleAttribution() {
  const sourceKind = $('[name="sourceKind"]', articleForm).value;
  const source = $('[name="source"]', articleForm);
  const sourceUrl = $('[name="sourceUrl"]', articleForm);
  sourceUrl.required = ["publication", "editorial"].includes(sourceKind);
  sourceUrl.placeholder = sourceKind === "unknown"
    ? "没有具体原文可留空并正常发布"
    : sourceKind === "original"
      ? "原创内容可留空"
      : "https://example.com/article";
  if (sourceKind === "unknown" && !source.value.trim()) source.value = "来源待确认";
  if (sourceKind === "original" && !source.value.trim()) source.value = "原创";
}

function syncInternalReviewState() {
  const note = $('[name="internalNote"]', articleForm);
  const status = $('[name="internalReviewStatus"]', articleForm);
  const resolvedAt = $('[name="internalReviewResolvedAt"]', articleForm);
  const confirmation = $('[name="internalReviewConfirmed"]', articleForm);
  const confirmationPanel = $("#article-review-confirmation");
  confirmationPanel.hidden = !note.value.trim();
  if (!note.value.trim()) {
    status.value = "unresolved";
    resolvedAt.value = "";
    confirmation.checked = false;
    confirmation.disabled = true;
    return;
  }
  confirmation.disabled = false;
  if (status.value === "resolved") confirmation.checked = true;
  status.value = confirmation.checked ? "resolved" : "unresolved";
  if (status.value === "resolved" && !resolvedAt.value) resolvedAt.value = new Date().toISOString();
  if (status.value !== "resolved") resolvedAt.value = "";
}

function updateLibraryUndoVisibility() {
  $("#library-undo-trash").hidden = !(libraryUndoAvailableForFeedback && lastTrashedItems.length);
}

function showResult(node, data, { undoTrash = false } = {}) {
  node.classList.remove("error");
  node.hidden = false;
  node.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (node === libraryResult) {
    libraryUndoAvailableForFeedback = undoTrash;
    libraryFeedback.hidden = false;
    updateLibraryUndoVisibility();
  }
}

function showError(node, error) {
  node.classList.add("error");
  node.hidden = false;
  node.textContent = error.message;
  if (node === libraryResult) {
    libraryUndoAvailableForFeedback = false;
    libraryFeedback.hidden = false;
    updateLibraryUndoVisibility();
  }
}

function clearResult(node) {
  node.hidden = true;
  node.classList.remove("error");
  node.textContent = "";
  if (node === libraryResult) {
    libraryUndoAvailableForFeedback = false;
    libraryFeedback.hidden = true;
    updateLibraryUndoVisibility();
  }
}

function draftScope(form) {
  return form.dataset.editFile || "new";
}

function draftKey(form) {
  return `xgif-publisher-draft:${form.id}:${encodeURIComponent(draftScope(form))}`;
}

function draftRevisionKey(form) {
  return `xgif-publisher-revisions:${form.id}:${encodeURIComponent(draftScope(form))}`;
}

function readDraftRevisions(form) {
  try {
    const revisions = JSON.parse(localStorage.getItem(draftRevisionKey(form)) || "[]");
    return Array.isArray(revisions) ? revisions : [];
  } catch {
    return [];
  }
}

function saveLocalDraft(form, { checkpoint = false } = {}) {
  const data = formData(form);
  if (!Object.values(data).some((value) => value && value !== false && value !== today)) return;
  const savedAt = Date.now();
  localStorage.setItem(draftKey(form), JSON.stringify({ savedAt, data }));
  const revisions = readDraftRevisions(form);
  const latest = revisions[0];
  const serialized = JSON.stringify(data);
  const shouldCheckpoint = checkpoint
    || !latest
    || (savedAt - Number(latest.savedAt || 0) >= 60_000 && latest.serialized !== serialized);
  if (!shouldCheckpoint) return;
  revisions.unshift({ savedAt, data, serialized });
  localStorage.setItem(
    draftRevisionKey(form),
    JSON.stringify(revisions.slice(0, 20)),
  );
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
  const normalizedData = form === articleForm && data?.sourceKind === "editorial"
    ? { ...data, sourceKind: "publication" }
    : data;
  for (const [key, value] of Object.entries(normalizedData || {})) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = Boolean(value);
    else if (typeof value !== "object") field.value = String(value);
  }
}

function restoreLocalDraft(form, stateNode) {
  try {
    const scopedKey = draftKey(form);
    const legacyKey = `xgif-publisher-draft:${form.id}`;
    const scopedValue = localStorage.getItem(scopedKey);
    const legacyValue = draftScope(form) === "new" ? localStorage.getItem(legacyKey) : null;
    const stored = JSON.parse(scopedValue || legacyValue || "null");
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
    if (!scopedValue && legacyValue) {
      localStorage.setItem(scopedKey, legacyValue);
      localStorage.removeItem(legacyKey);
    }
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
    form.dataset.originalDraft = item ? String(Boolean(item.draft)) : "";
    form.dataset.previewUrl = item?.previewUrl || "";
    form.dataset.previewed = "false";
    syncImageActionState();
  }
}

function restoreFormSnapshot(form, data) {
  setFormValues(form, data);
  setPublishMode(form, data.publishMode || (data.draft ? "draft" : "publish"));
  if (form === articleForm) {
    syncArticleAttribution();
    syncInternalReviewState();
    syncArticleActionState();
    syncAiAvailability();
    updateArticlePreview();
  } else {
    syncImageAttribution();
    syncImageActionState();
    updateImagePreview();
  }
  markFormDirty(form);
  saveLocalDraft(form, { checkpoint: true });
}

function renderVersionHistory({ browserItems = [], savedItems = [] } = {}) {
  const browserSection = browserItems.length
    ? browserItems.map((item, index) => `
        <article class="version-history-item">
          <div>
            <strong>浏览器自动保存</strong>
            <time datetime="${new Date(item.savedAt).toISOString()}">${escapeHtml(formatDateTime(item.savedAt))}</time>
          </div>
          <button type="button" data-browser-version="${index}">恢复此版本</button>
        </article>`).join("")
    : '<p class="library-empty">当前内容还没有浏览器自动保存记录。</p>';
  const savedSection = savedItems.length
    ? savedItems.map((item) => `
        <article class="version-history-item">
          <div>
            <strong>${escapeHtml(item.message || "内容安全快照")}</strong>
            <time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatDateTime(item.createdAt))}</time>
            <code>${escapeHtml(item.commit.slice(0, 10))}</code>
          </div>
          <button type="button" data-saved-version="${escapeHtml(item.commit)}">恢复到 Markdown</button>
        </article>`).join("")
    : '<p class="library-empty">当前内容还没有已保存的 Markdown 快照。</p>';
  $("#version-history-list").innerHTML = `
    <section><h3>未保存修改</h3>${browserSection}</section>
    <section><h3>已保存版本</h3>${savedSection}</section>`;
}

async function openVersionHistory(form) {
  versionHistoryForm = form;
  $("#version-history-result").textContent = "";
  $("#version-history-summary").textContent = form.dataset.editFile
    ? `当前内容：${form.dataset.editFile}`
    : "当前是新内容，只显示浏览器自动保存记录。";
  renderVersionHistory({ browserItems: readDraftRevisions(form), savedItems: [] });
  versionHistoryDialog.showModal();
  if (!form.dataset.editFile) return;
  try {
    const type = form === articleForm ? "article" : "image";
    const result = await api(`/api/content/history?${new URLSearchParams({
      type,
      file: form.dataset.editFile,
      limit: "20",
    })}`);
    renderVersionHistory({
      browserItems: readDraftRevisions(form),
      savedItems: result.items,
    });
  } catch (error) {
    $("#version-history-result").textContent = `无法读取已保存版本：${error.message}`;
  }
}

async function restoreSavedVersion(commit) {
  const form = versionHistoryForm;
  const file = form.dataset.editFile;
  if (!file || !window.confirm("将当前 Markdown 恢复到所选私有快照。现有版本仍会保留在历史中，是否继续？")) return;
  const type = form === articleForm ? "article" : "image";
  $("#version-history-result").textContent = "正在恢复并重新建立索引…";
  try {
    await api("/api/content/history/restore", { type, file, commit });
    const item = await api(`/api/content/read?${new URLSearchParams({ type, file })}`);
    activeContent = item;
    if (type === "article") {
      setFormValues(articleForm, { ...item.data, tags: list(item.data.tags).join(", "), body: item.body });
      setEditing(articleForm, {
        file,
        draft: Boolean(item.data.draft),
        previewUrl: item.previewUrl,
        publicationState: "local",
      });
      syncArticleAttribution();
      syncInternalReviewState();
      updateArticlePreview();
    } else {
      setFormValues(imageForm, {
        ...item.data,
        tags: list(item.data.tags).join(", "),
        mood: list(item.data.mood).join(", "),
        scenes: list(item.data.scenes).join(", "),
        body: item.body,
      });
      setEditing(imageForm, {
        file,
        draft: item.data.draft || item.data.public === false,
        previewUrl: item.previewUrl,
      });
      syncImageAttribution();
      updateImagePreview();
    }
    localStorage.removeItem(draftKey(form));
    await loadLibrary();
    $("#version-history-result").textContent = "已恢复到所选版本，并保存了恢复前后的私有快照。";
  } catch (error) {
    $("#version-history-result").textContent = `恢复失败：${error.message}`;
  }
}

function syncArticleActionState() {
  const submit = $('button[type="submit"]', articleForm);
  const editing = Boolean(articleForm.dataset.editFile);
  const originalDraft = articleForm.dataset.originalDraft === "true";
  const dirty = isFormDirty(articleForm);
  const alreadyPublished = editing && !originalDraft;
  const canPreview = editing && !dirty && Boolean(articleForm.dataset.previewUrl) && sitePreviewAvailable;

  submit.textContent = alreadyPublished ? "检查并保存修改" : "检查并发布草稿";
  articleSaveDraft.hidden = false;
  articleSaveDraft.textContent = alreadyPublished ? "保存修改" : "保存草稿";
  articleSaveDraft.disabled = !dirty;

  articleRealPreview.disabled = !canPreview;
  articleNextAction.dataset.action = "publish";
  articleNextAction.textContent = "发布";
  articleNextAction.disabled = articleForm.dataset.publishing === "true";
  $("#article-next-step-title").textContent = alreadyPublished
    ? dirty ? "保存公开修改" : "已发布到本地"
    : "发布到本地站点";
  $("#article-next-step-description").textContent = alreadyPublished
    ? dirty
      ? "点击发布会保存修改并重新执行内容检查。"
      : "可继续预览，云端更新请前往“同步上线”。"
    : dirty || !editing
      ? "点击发布会保存当前内容并执行发布检查。"
      : "点击发布会执行内容检查；真实预览是建议步骤，不再阻止发布。";

  articlePublishOptions.hidden = !(editing && originalDraft);
  $("#article-original-date").textContent = `沿用 ${$('[name="pubDate"]', articleForm).value || "草稿中的收藏日期"}`;
  $("#article-today-date").textContent = `使用 ${today}，按正式发布当天排序`;
  $("#article-preview-note").textContent = editing
    ? sitePreviewAvailable
      ? dirty
        ? "当前有未保存修改；保存后才能打开真实预览。"
        : "真实预览显示已保存版本；修改后请重新保存并预览。"
      : "站点预览服务尚未运行，请使用上方状态区启动或刷新。"
    : "保存草稿后，可用真实站点模板在新页面预览。";
}

function syncImageActionState() {
  const editing = Boolean(imageForm.dataset.editFile);
  const originalDraft = imageForm.dataset.originalDraft === "true";
  const alreadyPublished = editing && !originalDraft;
  const dirty = isFormDirty(imageForm);
  const canPreview = editing
    && !dirty
    && Boolean(imageForm.dataset.previewUrl)
    && sitePreviewAvailable;

  imageSaveDraft.textContent = alreadyPublished ? "保存修改" : "保存草稿";
  imageSaveDraft.disabled = !dirty;
  imageRealPreview.disabled = !canPreview;
  imageNextAction.disabled = imageForm.dataset.publishing === "true";
  imageNextAction.textContent = "发布";

  $("#image-next-step-title").textContent = selectedImage
    ? alreadyPublished && !dirty ? "已发布到本地" : "发布到本地站点"
    : "选择图片";
  $("#image-next-step-description").textContent = selectedImage
    ? alreadyPublished && !dirty
      ? "可继续预览，云端更新请前往“同步上线”。"
      : "发布会保存当前资料并执行重复与质量检查。"
    : "选择图片后填写资料并发布。";
}

function switchTab(name, { skipRoute = false, systemView = "status" } = {}) {
  const titles = {
    article: articleForm.dataset.editFile ? "编辑文章" : "新建文章",
    image: imageForm.dataset.editFile ? "编辑图片" : "新建图片",
    import: "导入内容",
    library: "内容库",
    audit: "待处理内容",
    sync: "同步上线",
    system: "系统",
  };
  $$(".tab").forEach((item) => {
    const active = item.dataset.tab === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $$(".workspace-nav-section").forEach((section) => {
    section.classList.toggle("is-current", Boolean($(".tab.active", section)));
  });
  const createMenu = $(".workspace-create-menu");
  if (createMenu) createMenu.open = name === "article" || name === "image";
  $$(".panel").forEach((item) => item.classList.toggle("active", item.id === `${name}-panel`));
  workspacePageTitle.textContent = titles[name] || "本地发布助手";
  window.scrollTo({ top: 0, behavior: "auto" });
  if (!skipRoute) updateWorkspaceRoute(name, { systemView });
  if (name === "library") loadLibrary();
  if (name === "audit") loadContentAudit();
  if (name === "sync") loadSyncWorkspace();
  if (name === "system") setSystemView(systemView, { updateRoute: false });
  return true;
}

function workspaceRoute(name, systemView = "status") {
  return name === "system" && systemView !== "status" ? `#system/${systemView}` : `#${name}`;
}

function updateWorkspaceRoute(name, { replace = false, systemView = "status" } = {}) {
  const next = workspaceRoute(name, systemView);
  if (window.location.hash === next) return;
  window.history[replace ? "replaceState" : "pushState"]({ workspace: name, systemView }, "", next);
}

function setSystemView(view, { updateRoute = true } = {}) {
  const next = ["status", "recovery", "tags"].includes(view) ? view : "status";
  for (const button of $$("[data-system-view]")) {
    const active = button.dataset.systemView === next;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const section of $$("[data-system-section]")) {
    const active = section.dataset.systemSection === next;
    section.classList.toggle("active", active);
    section.hidden = !active;
  }
  if (updateRoute) updateWorkspaceRoute("system", { systemView: next });
  if (next === "status") loadStatus();
  if (next === "recovery") loadRecoveryDashboard();
  if (next === "tags") loadTagGovernance();
}

function restoreWorkspaceRoute({ replace = false } = {}) {
  const [name, detail] = window.location.hash.slice(1).split("/");
  const workspace = ["article", "image", "import", "library", "audit", "sync", "system"].includes(name)
    ? name
    : "library";
  switchTab(workspace, { skipRoute: true, systemView: detail || "status" });
  if (replace || !window.location.hash) {
    window.history.replaceState(
      { workspace, systemView: detail || "status" },
      "",
      workspaceRoute(workspace, detail || "status"),
    );
  }
}

function applyArticleSuggestion(suggestion, expectedBody) {
  for (const field of ["title", "summary", "tags", "readTime", "source"]) {
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
  $("#article-ai-review").hidden = false;
  articleDetails.open = true;
  setArticleInspectorTab("details");
  updateArticlePreview();
  markFormDirty(articleForm);
  saveLocalDraft(articleForm);
  return paragraphFormatting;
}

function applyImageSuggestion(suggestion) {
  for (const field of ["title", "description", "tags", "category", "mood", "scenes"]) {
    const input = $(`[name="${field}"]`, imageForm);
    const value = Array.isArray(suggestion[field]) ? suggestion[field].join(", ") : suggestion[field];
    if (input && value) input.value = value;
  }
  $("#image-ai-review").hidden = false;
  setImageInspectorTab("details");
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
  data.commit = false;
  data.push = false;
  if (selectedImage?.dataUrl?.startsWith("data:")) data.fileData = selectedImage.dataUrl;
  if (imageForm.dataset.editFile) data.excludeFile = imageForm.dataset.editFile;
  return data;
}

const importStatusLabels = {
  ready: "可直接发布",
  review: "需处理",
  similar: "疑似重复",
  exact: "已存在",
};

function renderFlomoStats(stats) {
  const entries = [
    ["总计", stats.total],
    ["可直接发布", stats.ready],
    ["需处理", stats.review],
    ["疑似重复", stats.similar],
    ["已存在", stats.exact],
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
    const reviewReason = item.sourceReviewReason
      || (item.needsTitle ? "候选标题需要确认" : "")
      || (item.status === "review" && item.charCount < 120 ? "正文较短，请确认内容完整" : "");
    const sourceWarning = reviewReason
      ? `<p class="import-source-warning">${escapeHtml(reviewReason)}</p>`
      : "";
    const importGroups = item.importTags?.length
      ? `<p class="import-item-meta">内部导入分组：${escapeHtml(item.importTags.join("、"))}（不公开展示）</p>`
      : "";
    const opensForReview = item.status === "review" || item.status === "similar";
    const sourceLine = item.sourceUrl
      ? `来源：${escapeHtml(item.source || "外部来源")} · ${escapeHtml(item.sourceUrl)}`
      : `来源：${escapeHtml(item.source || "来源待确认")}`;
    return `
      <article class="import-item" data-import-hash="${item.contentHash}" data-status="${item.status}" data-selected="${item.status === "ready"}">
        <div class="import-item-heading">
          <label class="import-item-select">
            <input type="checkbox" data-import-select ${item.status === "ready" ? "checked" : ""} ${item.status === "exact" ? "disabled" : ""} />
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

function importSelectionStates() {
  return $$("[data-import-hash]", flomoList).map((card) => {
    const checkbox = $("[data-import-select]", card);
    return {
      card,
      checked: checkbox.checked,
      disabled: checkbox.disabled,
      status: card.dataset.status,
    };
  });
}

function applyFlomoImportFilter(states) {
  for (const state of states) {
    state.card.hidden = !importItemMatchesFilter(state, flomoImportFilter);
  }
}

function updateFlomoSelectionToggle() {
  const states = importSelectionStates();
  const summary = summarizeImportSelection(states);

  for (const state of states) state.card.dataset.selected = String(state.checked && !state.disabled);
  applyFlomoImportFilter(states);
  const exactDuplicates = $("#flomo-exact-duplicates");
  if (exactDuplicates) exactDuplicates.open = false;

  flomoSelectionSummary.textContent = `已选 ${summary.selected} / 可选 ${summary.selectable} / 总计 ${summary.total}`;
  flomoPublishSelected.textContent = flomoImportBusy ? `正在检查并发布（${summary.selected}）` : `检查并发布 ${summary.selected} 条`;
  flomoImportSelected.textContent = flomoImportBusy ? `正在保存（${summary.selected}）` : "保存所选为草稿";
  flomoPublishSelected.disabled = flomoImportBusy || summary.selected === 0;
  flomoImportSelected.disabled = flomoImportBusy || summary.selected === 0;
}

function selectedImportItems() {
  if (!flomoInspection) return [];
  const selected = new Set($$("[data-import-select]:checked", flomoList).map((input) => input.closest("[data-import-hash]").dataset.importHash));
  return flomoInspection.items.filter((item) => selected.has(item.contentHash));
}

function hasOverlongMarkdownParagraph(body, maxCharacters = 180) {
  return String(body || "")
    .split(/\n[ \t]*\n/gu)
    .some((paragraph) => [...paragraph.replace(/\s/gu, "")].length > maxCharacters);
}

async function ensureImportParagraphsBeforePublish(items) {
  const candidates = items.filter((item) => hasOverlongMarkdownParagraph(flomoAiBodies.get(item.contentHash) || item.body));
  if (!candidates.length) return;

  const overrides = collectImportOverrides();
  for (const [index, item] of candidates.entries()) {
    showResult(flomoResult, `正在安全分段 ${index + 1} / ${candidates.length}…`);
    const succeeded = await organizeImportItem(item, overrides);
    if (!succeeded || hasOverlongMarkdownParagraph(flomoAiBodies.get(item.contentHash) || item.body)) {
      throw new Error(`“${item.title || "未命名内容"}”仍有超过 180 字的长段落，已停止发布。请在卡片中重试 AI 整理或保存为草稿后手动编辑。`);
    }
  }
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

async function applyFlomoImport(mode = "draft") {
  const items = selectedImportItems();
  if (!items.length) throw new Error("请至少选择一条内容。");
  const publishing = mode === "publish";
  const action = publishing ? "先由 AI 安全分段后发布到本地" : "保存为本地 Markdown 草稿";
  if (!window.confirm(`将${action} ${items.length} 条选中内容，不会提交或推送。是否继续？`)) return;
  if (publishing) await ensureImportParagraphsBeforePublish(items);
  const result = await api("/api/import/flomo/apply", {
    fileData: flomoFileData,
    selectedHashes: items.map((item) => item.contentHash),
    overrides: collectImportOverrides(),
    mode,
  });
  const completedLabel = publishing ? "已发布到本地" : "已保存为草稿";
  const blocked = result.blocked?.length
    ? `\n${result.blocked.length} 条需要补充：\n${result.blocked.map((item) => `- ${item.title}：${item.reason}`).join("\n")}`
    : "";
  showResult(flomoResult, `${completedLabel} ${result.imported} 条。${result.skipped.length ? `另有 ${result.skipped.length} 条因重复跳过。` : ""}${blocked}\n${result.files.map((item) => item.file).join("\n")}`);
  await loadLibrary();
  renderFlomoInspection(await api("/api/import/flomo/inspect", { fileData: flomoFileData }));
  flomoCompleteActions.hidden = !result.drafted;
  $("#flomo-review-drafts").textContent = `前往内容库查看 ${result.imported} 篇草稿`;
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
      : `远程推送失败：${result.git.push.error || "未配置远程仓库。"}\n可在“内容库”中点击“重新同步”。`);
  }
  return lines.join("\n");
}

function renderLibraryCounts(counts = {}) {
  libraryCounts = {
    all: Number(counts.all || 0),
    draft: Number(counts.draft || 0),
    local: Number(counts.local || 0),
    pending: Number(counts.pending || 0),
    unknown: Number(counts.unverified || counts.unknown || 0),
    online: Number(counts.online || 0),
    unverified: Number(counts.unverified || 0),
    cloud: Number(counts.cloud || 0),
    attention: Number(counts.attention || 0),
  };
  const countTargets = {
    all: "#library-count-all",
    draft: "#library-count-draft",
    local: "#library-count-local",
    cloud: "#library-count-cloud",
  };
  for (const [status, selector] of Object.entries(countTargets)) {
    $(selector).textContent = Number(counts[status] || 0);
  }
  const task = libraryTaskPresentation(libraryCounts);
  $("#library-task-summary").textContent =
    `${libraryCounts.all} 项内容 · ${libraryCounts.draft} 项草稿 · ${libraryCounts.local} 项本地发布 · ${libraryCounts.cloud} 项云端流程`;
  $("#library-task-banner").dataset.state = task.state;
  $("#library-task-kicker").textContent = task.kicker;
  $("#library-task-title").textContent = task.title;
  $("#library-task-description").textContent = task.description;
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
  librarySelectionSummary.textContent = selectedCount
    ? summary.label.replace(/^已选择/, "已批量选择")
    : "批量模式：尚未选择";
  librarySelectionBar.classList.toggle("has-selection", selectedCount > 0);
  $("#library-bulk-publish").disabled = selectedCount === 0;
  $("#library-bulk-draft").disabled = selectedCount === 0;
  $("#library-bulk-edit").disabled = selectedCount === 0;
  $("#library-bulk-sync").disabled = selectedCount === 0;
  $("#library-bulk-trash").disabled = selectedCount === 0;
  updateLibraryUndoVisibility();
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

function setLibraryBatchMode(enabled) {
  libraryBatchMode = Boolean(enabled);
  libraryPanel.classList.toggle("is-batch-mode", libraryBatchMode);
  contentList.dataset.batchMode = String(libraryBatchMode);
  librarySelectionBar.hidden = !libraryBatchMode;
  const toggle = $("#library-batch-toggle");
  toggle.setAttribute("aria-pressed", String(libraryBatchMode));
  toggle.textContent = libraryBatchMode ? "退出批量" : "批量管理";
  if (!libraryBatchMode) clearLibrarySelection();
  renderLibraryTable(libraryPageItems);
}

function syncLibraryInspectorMode() {
  const inspectorIsDialog = libraryInspectorDialogQuery.matches && !libraryInspector.hidden;
  libraryMain.inert = inspectorIsDialog;
  libraryInspector.setAttribute("role", inspectorIsDialog ? "dialog" : "complementary");
  if (inspectorIsDialog) libraryInspector.setAttribute("aria-modal", "true");
  else libraryInspector.removeAttribute("aria-modal");
  return inspectorIsDialog;
}

function closeLibraryInspector() {
  const activeFile = activeContent?.file;
  activeContent = null;
  libraryPanel.classList.remove("has-detail");
  libraryMain.inert = false;
  libraryInspector.hidden = true;
  libraryInspector.removeAttribute("aria-modal");
  libraryInspector.removeAttribute("role");
  libraryActions.hidden = true;
  libraryDetail.innerHTML = '<p class="library-empty">从列表选择一条内容查看详情。</p>';
  const trigger = $$("[data-content-open]", contentList)
    .find((button) => button.dataset.contentOpen === activeFile);
  trigger?.focus();
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
          <th class="content-select-cell" data-batch-cell><input id="library-select-page" type="checkbox" aria-label="选择当前页全部内容" /></th>
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
          const presentation = libraryItemPresentation(item);
          if (selected) librarySelectedItems.set(item.file, item);
          const typeLabel = item.type === "article" ? "文章" : "图片";
          const summary = item.summary || item.bodyExcerpt || "暂无摘要";
          const tags = list(item.tags).slice(0, 2);
          return `
            <tr class="content-item${active ? " active" : ""}" data-content-file="${escapeHtml(item.file)}" data-content-type="${item.type}">
              <td class="content-select-cell" data-batch-cell>
                <input type="checkbox" data-content-select="${escapeHtml(item.file)}" aria-label="选择《${escapeHtml(item.title)}》" ${selected ? "checked" : ""} />
              </td>
              <td class="content-title-cell">
                <button class="content-title-button" type="button" data-content-open="${escapeHtml(item.file)}" ${active ? 'aria-current="true"' : ""}>${escapeHtml(item.title)}</button>
                <span class="content-item-meta">${typeLabel} · ${escapeHtml(item.source || "未标注来源")}</span>
                <span class="content-item-summary">${escapeHtml(summary)}</span>
              </td>
              <td>
                <span class="workflow-state compact" data-state="${escapeHtml(item.publication?.state || item.workflow?.state || "unknown")}">${escapeHtml(presentation.label)}</span>
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
  libraryRequestController?.abort();
  libraryRequestController = new AbortController();
  const requestSequence = ++libraryRequestSequence;
  const params = new URLSearchParams({
    type: $("#library-type").value,
    status: libraryStatus,
    sort: $("#library-sort").value,
    query: $("#library-query").value.trim(),
    page: String(libraryPage),
    pageSize: $("#library-page-size").value,
  });
  try {
    const { items, counts, pagination, indexWarning } = await api(
      `/api/content?${params}`,
      undefined,
      { signal: libraryRequestController.signal },
    );
    if (requestSequence !== libraryRequestSequence) return;
    renderLibraryCounts(counts);
    renderLibraryTable(items);
    renderLibraryPagination(pagination);
    if (indexWarning) showResult(libraryResult, indexWarning);
  } catch (error) {
    if (error.name === "AbortError" || requestSequence !== libraryRequestSequence) return;
    libraryPageItems = [];
    contentList.innerHTML = '<p class="library-empty">无法读取内容列表。</p>';
    libraryPageSummary.textContent = "读取失败";
    libraryPagination.hidden = true;
    updateLibrarySelection();
    showError(libraryResult, error);
  }
}

function auditIssues(item) {
  if (!item) return [];
  return [
    ...(item.blockers || []),
    ...(item.warnings || []),
    ...(item.notices || []),
  ].filter(Boolean);
}

function currentArticleAuditIssues(item, data = formData(articleForm)) {
  let issues = auditIssues(item);
  if (data.internalReviewStatus === "resolved" && data.internalReviewConfirmed) {
    issues = issues.filter((issue) => !/内部复核|内部.*确认|尚未确认/u.test(issue));
  }
  return issues;
}

function renderArticleAuditGuidance(item, data = formData(articleForm)) {
  const issues = currentArticleAuditIssues(item, data);
  articleAuditGuidance.hidden = !issues.length;
  articleAuditIssues.innerHTML = issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
  if (!issues.length) {
    articleAuditNextStep.textContent = "";
    return;
  }
  const needsParagraphs = issues.some((issue) => /长段落/u.test(issue));
  const needsSource = issues.some((issue) => /来源链接/u.test(issue));
  articleAuditNextStep.textContent = needsParagraphs
    ? `点击正文旁的“AI 整理与分段”安全分段${needsSource ? "，再补充具体原文链接" : ""}；标题可用“AI 标题建议”生成 3 个候选，保存或发布时会自动复核。`
    : "按上述事项修改后保存或发布，系统会自动复核。";
}

function renderContentAuditGroup(report, status, label) {
  const items = report.items.filter((item) => item.status === status);
  return `
    <details class="content-audit-group" ${status === "ready" || !items.length ? "" : "open"}>
      <summary>${label} <span>${items.length}</span></summary>
      <div>
        ${items.length ? items.map((item) => {
          const issues = auditIssues(item);
          const body = `
            <div class="content-audit-item-heading">
              <div><strong>${escapeHtml(item.title)}</strong><span>${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.source || "未标注")}</span></div>
            </div>
            ${issues.length ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : "<p>检查通过</p>"}
            <code>${escapeHtml(item.file)}</code>`;
          return item.type === "article" && status !== "ready"
            ? `<button class="content-audit-item-action" type="button" data-status="${status}" data-audit-open-article="${escapeHtml(item.file)}" aria-label="继续处理：${escapeHtml(item.title)}">${body}</button>`
            : `<article data-status="${status}">${body}</article>`;
        }).join("") : '<p class="library-empty">无。</p>'}
      </div>
    </details>`;
}

async function loadContentAudit() {
  $("#content-audit-summary").textContent = "正在检查全部内容…";
  $("#content-audit-list").innerHTML = '<p class="library-empty">正在读取体检结果…</p>';
  try {
    const report = await api("/api/content/audit");
    contentAuditItemsByFile = new Map(report.items.map((item) => [item.file, item]));
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

async function openAuditedArticle(file) {
  const item = await api(`/api/content/read?${new URLSearchParams({ type: "article", file })}`);
  activeContent = { ...item, audit: contentAuditItemsByFile.get(file) || null };
  openActiveContent();
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

function renderSyncHistory(items = []) {
  $("#sync-history-list").innerHTML = items.length
    ? items.map((item) => `
        <article class="sync-history-item">
          <div><strong>${escapeHtml(item.details.branch || "未知分支")}</strong><time>${escapeHtml(new Date(item.createdAt).toLocaleString("zh-CN"))}</time></div>
          <p>${Number(item.details.count || 0)} 条内容 · ${item.details.pushOk ? "推送成功" : "推送未完成"}</p>
          ${item.details.commitSha ? `<code>${escapeHtml(item.details.commitSha)}</code>` : ""}
          ${item.details.compareUrl ? `<a href="${escapeHtml(item.details.compareUrl)}" target="_blank" rel="noreferrer">打开 GitHub 比较页 ↗</a>` : ""}
        </article>`).join("")
    : '<p class="library-empty">还没有批量同步记录。</p>';
}

function renderSyncWorkspace(status, items = [], history = []) {
  const counts = status.publicationCounts || {};
  const local = Number(counts.local || 0);
  const pending = Number(counts.pending || 0);
  const unverified = Number(counts.unverified || 0);
  const cloud = Number(counts.cloud || 0);
  $("#sync-local-count").textContent = `${local} 条待同步`;
  $("#sync-github-count").textContent = pending ? `${pending} 条已推送` : local ? "等待推送" : "没有待提交内容";
  $("#sync-cloudflare-count").textContent = pending ? "等待 PR 与部署" : "等待 GitHub 更新";
  $("#sync-live-count").textContent = unverified ? `${unverified} 条待核验` : cloud ? `${cloud} 条已上线` : "等待部署";

  const countBadge = $("#sync-navigation-count");
  countBadge.hidden = !local;
  countBadge.textContent = String(local);

  const button = $("#sync-all-local");
  button.disabled = !local || !status.git?.canPush;
  button.textContent = local ? `同步 ${local} 条到 GitHub` : "没有待同步内容";
  $("#sync-queue-summary").textContent = local
    ? status.git?.canPush
      ? `${local} 条本地已发布内容等待进入 GitHub。同步前会重新执行上线体检。`
      : `${local} 条内容待同步，但尚未配置 GitHub 远程仓库，请先在系统状态中检查连接。`
    : pending
      ? `${pending} 条内容已经进入远程分支，等待 PR 合并与 Cloudflare 部署。`
      : "当前没有需要同步的本地公开内容。";
  $("#sync-queue-list").innerHTML = items.length
    ? items.map((item) => `
        <article class="sync-queue-item">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.pubDate || "日期未定")}</span>
          </div>
          <span class="workflow-state compact" data-state="local">待同步</span>
        </article>`).join("")
    : '<p class="library-empty">待同步队列为空。</p>';

  const prLink = $("#sync-pr-link");
  prLink.hidden = !status.gitCompareUrl;
  if (status.gitCompareUrl) prLink.href = status.gitCompareUrl;
  renderSyncHistory(history);
}

async function loadSyncWorkspace() {
  $("#sync-queue-summary").textContent = "正在读取本地发布状态…";
  $("#sync-queue-list").innerHTML = '<p class="library-empty">正在读取待同步内容…</p>';
  $("#sync-history-list").innerHTML = '<p class="library-empty">正在读取同步记录…</p>';
  try {
    const [status, queue, history] = await Promise.all([
      api("/api/status"),
      api("/api/content?type=all&status=local&sort=updated-desc&page=1&pageSize=50"),
      api("/api/history?action=sync_content&limit=20"),
    ]);
    publisherStatus = status;
    renderSyncWorkspace(status, queue.items || [], history.items || []);
  } catch (error) {
    $("#sync-queue-summary").textContent = `无法读取同步状态：${error.message}`;
    $("#sync-queue-list").innerHTML = "";
    $("#sync-history-list").innerHTML = "";
  }
}

async function syncAllLocalContent() {
  const button = $("#sync-all-local");
  const local = Number(publisherStatus?.publicationCounts?.local || 0);
  if (!local) return;
  if (!window.confirm(
    `将 ${local} 条本地已发布内容提交到内容分支并推送 GitHub。\nPR 合并后由 Cloudflare Workers Builds 自动部署，是否继续？`,
  )) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "正在检查并推送…";
  $("#sync-workspace-result").dataset.state = "loading";
  $("#sync-workspace-result").textContent = "正在执行上线体检、创建提交并推送 GitHub。";
  try {
    const result = await api("/api/content/batch", {
      action: "sync",
      selection: { type: "all", status: "local", query: "", exclude: [] },
    });
    $("#sync-workspace-result").dataset.state = result.push?.ok ? "ready" : "error";
    $("#sync-workspace-result").textContent = result.push?.ok
      ? `已推送 ${result.synced.length} 条内容到 ${result.branch}。下一步合并 GitHub PR，Cloudflare 将自动部署。`
      : `本地提交已完成，但推送失败：${result.push?.error || "未知错误"}`;
    await Promise.all([loadStatus(), loadLibrary()]);
  } catch (error) {
    $("#sync-workspace-result").dataset.state = "error";
    $("#sync-workspace-result").textContent = `同步已停止：${error.message}`;
  } finally {
    button.removeAttribute("aria-busy");
    await loadSyncWorkspace();
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
      <article class="asset-library-item" data-state="${item.backup.ok && !item.draft && !item.missingAltCount && !item.duplicateCount ? "ready" : "attention"}">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.description || item.source || "暂无说明")}</p>
          <div class="tags">${renderTags(item.tags)}</div>
          <small>${item.storage === "r2" ? "R2" : item.storage === "local" ? "本地文件" : "外部地址"} · ${escapeHtml(item.backup.label)} · 文章使用 ${Number(item.usageCount || 0)} 次${item.missingAltCount ? ` · ${item.missingAltCount} 处缺少替代文字` : ""}${item.duplicateCount ? ` · ${item.duplicateCount} 个重复文件` : ""}</small>
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
    `${report.counts.total} 项素材 · ${report.counts.unused} 项未被文章使用 · ${report.counts.missingAlt} 项缺少替代文字 · ${report.counts.duplicateGroups} 组重复文件`;
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

function privateContentGitState(contentHistory) {
  const history = contentHistory || {};
  const offsite = history.offsite || {};
  const repository = offsite.repository || "未配置远端";
  const version = offsite.commit ? offsite.commit.slice(0, 10) : "无远端版本";
  return {
    ready: Boolean(history.ready && offsite.ok),
    label: offsite.ok ? "已同步" : offsite.configured ? "待重试" : "未配置",
    detail: history.ready
      ? `${history.files || 0} 个文件 · ${repository} · ${version} · ${
          offsite.syncedAt ? formatStatusDate(offsite.syncedAt) : offsite.error || "等待首次同步"
        }`
      : history.error || "尚未创建本机私有内容快照",
  };
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
    const privateGit = privateContentGitState(report.contentHistory);
    grid.innerHTML = [
      recoveryState(
        "SQLite 备份",
        `${report.sqliteBackups.count} 份`,
        latest ? `最近：${formatStatusDate(latest.modifiedAt)}` : "尚未创建手动备份",
        Boolean(latest),
      ),
      recoveryState(
        "私有内容 GitHub",
        privateGit.label,
        privateGit.detail,
        privateGit.ready,
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

async function syncPrivateContentGit() {
  const button = $("#private-content-sync");
  const resultNode = $("#recovery-dashboard-result");
  button.disabled = true;
  resultNode.textContent = "正在记录草稿、回收站与恢复副本，并同步私有内容 GitHub…";
  try {
    const result = await api("/api/storage/content-history/sync", {});
    const state = privateContentGitState(result.contentHistory);
    resultNode.textContent = result.ok
      ? `私有内容 GitHub 已同步：${state.detail}`
      : `本机快照已保留，但远端同步需要重试：${result.error || state.detail}`;
    await Promise.all([loadRecoveryDashboard(), loadStatus()]);
  } catch (error) {
    resultNode.textContent = `私有内容 GitHub 同步失败：${error.message}`;
  } finally {
    button.disabled = false;
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

function updateTrashCount(count) {
  const value = String(Number(count) || 0);
  $("#library-trash-count").textContent = value;
}

function renderRecycleBin(items) {
  recycleBinItems = items;
  updateTrashCount(items.length);
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
  trashReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  const nextStep = $(".library-next-step", libraryDetail);
  if (!nextStep || !publication || !activeContent) return;
  activeContent.publication = publication;
  const presentation = libraryItemPresentation(activeContent);
  nextStep.dataset.state = publication.state || activeContent.workflow?.state;
  $("span", nextStep).textContent = presentation.label;
  $("strong", nextStep).textContent = presentation.nextTitle;
  $("p", nextStep).textContent = presentation.nextDescription;
  updateLibraryActions(activeContent);
}

async function refreshDeploymentState(item) {
  if (!item || item.data.draft || item.workflow?.state !== "pending_deploy") return;
  try {
    const deployment = await api(`/api/content/deployment?${new URLSearchParams({ type: item.type, file: item.file })}`);
    if (activeContent?.file !== item.file) return;
    activeContent.publication = deployment.publication;
    activeContent.workflow = deployment.workflow || activeContent.workflow;
    renderPublicationState(activeContent.publication);
    renderWorkflowState(activeContent.workflow);
  } catch {
    if (activeContent?.file === item.file) {
      const previous = activeContent.publication;
      renderPublicationState({
        ...previous,
        state: previous?.state || "unknown",
        label: previous?.state === "online" ? "上次确认已上线" : "待验证",
        description: "本次无法核对线上页面，已保留上次状态。",
        verification: "unknown",
      });
    }
  }
}

function updateLibraryActions(item) {
  if (!item) {
    libraryActions.hidden = true;
    return;
  }
  libraryActions.hidden = false;
  const presentation = libraryItemPresentation(item);
  for (const button of $$("button", libraryActions)) button.classList.remove("primary");
  libraryEdit.hidden = false;
  libraryDuplicate.hidden = false;
  libraryEdit.textContent = item.data.draft ? "继续处理" : "编辑内容";
  libraryReturnDraft.hidden = item.type !== "article" || item.data.draft;
  librarySyncCurrent.hidden = presentation.action !== "sync";
  libraryPreview.hidden = item.type !== "article" || !item.data.draft || !item.previewUrl || !sitePreviewAvailable;
  const isPublic = !item.data.draft && (item.type === "article" || item.data.public !== false);
  libraryOpen.hidden = !isPublic || !sitePreviewAvailable;
  libraryOpen.textContent = item.publication?.state === "online"
    ? "查看线上内容 ↗"
    : "在站点预览中查看 ↗";
  $("#retry-push").hidden = presentation.action !== "retry";
  if (!$("#retry-push").hidden) $("#retry-push").classList.add("primary");
  else if (!librarySyncCurrent.hidden) librarySyncCurrent.classList.add("primary");
  else if (item.data.draft) libraryEdit.classList.add("primary");
  else if (presentation.action === "open" && !libraryOpen.hidden) libraryOpen.classList.add("primary");
  else libraryEdit.classList.add("primary");
}

async function selectContent(type, file) {
  try {
    const item = await api(`/api/content/read?${new URLSearchParams({ type, file })}`);
    const listItem = libraryPageItems.find((entry) => entry.file === file);
    item.publication = listItem?.publication || (item.data.draft
      ? { state: "draft", label: "草稿", description: "只保存在本地内容库。" }
      : { state: "local", label: "待完成", description: "正在核对线上页面。" });
    activeContent = item;
    libraryPanel.classList.add("has-detail");
    libraryInspector.hidden = false;
    const inspectorIsDialog = syncLibraryInspectorMode();
    updateLibraryActions(item);
    const presentation = libraryItemPresentation(item);
    const internalReviewStatus = item.data.internalReviewStatus === "resolved" ? "resolved" : "unresolved";
    const internalNote = item.type === "article" && item.data.internalNote
      ? `<div class="internal-review-note" data-state="${internalReviewStatus}">
          <strong>${internalReviewStatus === "resolved" ? "导入内容已确认" : "导入内容待确认"}</strong>
          <p>${escapeHtml(item.data.internalNote)}</p>
          ${internalReviewStatus === "resolved"
            ? `<small>完成时间：${escapeHtml(formatDateTime(item.data.internalReviewResolvedAt))}</small>`
            : "<small>核对来源链接与正文后，在编辑页勾选“我已确认”。</small>"}
        </div>`
      : "";
    const media = item.type === "image" && item.data.image
      ? `<figure class="library-detail-media"><img src="${escapeHtml(item.data.image)}" alt="${escapeHtml(item.data.title || "图片预览")}" /></figure>`
      : item.type === "article" && item.data.coverImage
        ? `<figure class="library-detail-media article"><img src="${escapeHtml(item.data.coverImage)}" alt="${escapeHtml(item.data.coverAlt || item.data.title || "文章封面")}" /></figure>`
        : "";
    const sourceDetail = item.type === "image"
      ? item.data.sourceKind === "user_provided"
        ? "用户提供 · 已确认可公开发布"
        : item.data.source || "来源待确认"
      : item.data.source || "未标注来源";
    const syncOpen = presentation.action === "retry" ? " open" : "";
    const contentState = item.data.draft ? "草稿" : "已发布到本地";
    const verificationTime = item.publication?.lastVerifiedAt || item.publication?.checkedAt;
    const publicationDescription = item.publication?.verification === "unknown"
      ? `${item.publication.description} 上次成功核对：${formatDateTime(item.publication.lastVerifiedAt)}`
      : `${item.publication?.description || "等待核对。"} 核对时间：${formatDateTime(verificationTime)}`;
    libraryDetail.innerHTML = `
      <div class="library-detail">
        ${media}
        <p class="eyebrow">${item.type === "article" ? "文章" : "图片"} · ${escapeHtml(item.data.pubDate || "")}</p>
        <h2>${escapeHtml(item.data.title || "未命名内容")}</h2>
        <p class="library-detail-summary">${escapeHtml(item.data.summary || item.data.description || "")}</p>
        ${internalNote}
        <div class="tags">${renderTags(item.data.tags)}</div>
        <section class="content-state-grid" aria-label="内容发布状态">
          <div><span>内容</span><strong>${escapeHtml(contentState)}</strong><small>${item.data.draft ? "不会进入公开站点" : "本地 Astro 内容已生成"}</small></div>
          <div><span>Git</span><strong>${escapeHtml(item.workflow?.label || "待确认")}</strong><small>${escapeHtml(item.workflow?.description || "正在读取 Git 状态")}</small></div>
          <div><span>云端</span><strong>${escapeHtml(item.publication?.label || "待验证")}</strong><small>${escapeHtml(publicationDescription)}</small></div>
        </section>
        <section class="library-next-step" data-state="${escapeHtml(item.publication?.state || item.workflow?.state || "unknown")}">
          <span>${escapeHtml(presentation.label)}</span>
          <strong>${escapeHtml(presentation.nextTitle)}</strong>
          <p>${escapeHtml(presentation.nextDescription)}</p>
        </section>
        <dl class="library-detail-facts">
          <div><dt>来源</dt><dd>${escapeHtml(sourceDetail)}</dd></div>
          <div><dt>发布日期</dt><dd>${escapeHtml(item.data.pubDate || "未定")}</dd></div>
          <div><dt>内容 ID</dt><dd>${escapeHtml(item.data.contentId || "尚未分配")}</dd></div>
        </dl>
        <details class="sync-details"${syncOpen}>
          <summary>同步与技术信息</summary>
          <span class="workflow-state" id="library-workflow-state" data-state="${escapeHtml(item.workflow?.state || "unknown")}">${escapeHtml(item.workflow?.label || "状态待确认")}</span>
          <p id="library-workflow-description">${escapeHtml(item.workflow?.description || "正在读取发布状态。")}</p>
          <code>${escapeHtml(item.file)}</code>
        </details>
      </div>`;
    for (const row of $$("[data-content-file]", contentList)) {
      row.classList.toggle("active", row.dataset.contentFile === file);
    }
    if (inspectorIsDialog) $("#library-close-detail").focus();
    refreshDeploymentState(item);
  } catch (error) {
    showError(libraryResult, error);
  }
}

function openActiveContent(nextDraft = null) {
  if (!activeContent) return;
  const { type, file, data, body, previewUrl } = activeContent;
  if (type === "article") {
    renderArticleAuditGuidance(activeContent.audit);
    setFormValues(articleForm, { ...data, tags: list(data.tags).join(", "), body });
    setPublishMode(articleForm, typeof nextDraft === "boolean" ? (nextDraft ? "draft" : "publish") : (data.draft ? "draft" : "publish"));
    syncArticleAttribution();
    syncInternalReviewState();
    resetArticleTitleSuggestions();
    syncAiAvailability();
    articleDetails.open = true;
    setEditing(articleForm, {
      file,
      draft: Boolean(data.draft),
      previewUrl,
      publicationState: activeContent.publication?.state,
    });
    restoreLocalDraft(articleForm, $("#article-editor-state"));
    syncPublishMode(articleForm);
    syncArticleAttribution();
    syncInternalReviewState();
    syncArticleActionState();
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
    setImageInspectorTab("details");
    setEditing(imageForm, {
      file,
      draft: data.draft || data.public === false,
      previewUrl,
    });
    restoreLocalDraft(imageForm, $("#image-editor-state"));
    syncPublishMode(imageForm);
    syncImageAttribution();
    syncImageActionState();
    syncAiAvailability();
    updateImagePreview();
    switchTab("image");
  }
}

for (const tab of $$(".tab")) tab.addEventListener("click", () => switchTab(tab.dataset.tab));

for (const button of $$("[data-markdown-action]")) {
  button.addEventListener("click", () => applyMarkdownAction(button.dataset.markdownAction));
}
$("#article-find-next").addEventListener("click", () => findArticleText());
$("#article-replace-next").addEventListener("click", () => findArticleText({ replace: true }));
$("#article-replace-all").addEventListener("click", () => findArticleText({ replaceAll: true }));
$("#article-outline").addEventListener("click", (event) => {
  const button = event.target.closest("[data-outline-position]");
  if (!button) return;
  const position = Number(button.dataset.outlinePosition);
  articleBody.focus();
  articleBody.setSelectionRange(position, position);
  articleBody.scrollTop = Math.max(0, position / Math.max(1, articleBody.value.length) * articleBody.scrollHeight - 80);
});
articleBody.addEventListener("paste", (event) => {
  const image = [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith("image/"));
  if (!image) return;
  event.preventDefault();
  uploadArticleImage(image);
});
articleBody.addEventListener("dragover", (event) => {
  if (![...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) return;
  event.preventDefault();
  articleBody.classList.add("is-dragging-image");
});
articleBody.addEventListener("dragleave", () => articleBody.classList.remove("is-dragging-image"));
articleBody.addEventListener("drop", (event) => {
  articleBody.classList.remove("is-dragging-image");
  const image = [...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith("image/"));
  if (!image) return;
  event.preventDefault();
  uploadArticleImage(image);
});

for (const input of $$("input, textarea, select", articleForm)) {
  if (input.closest(".markdown-find")) continue;
  input.addEventListener("input", () => {
    if (["title", "body", "source", "sourceUrl", "sourceKind", "internalNote"].includes(input.name)) {
      $('[name="internalReviewStatus"]', articleForm).value = "unresolved";
      $('[name="internalReviewResolvedAt"]', articleForm).value = "";
      $('[name="internalReviewConfirmed"]', articleForm).checked = false;
    } else if (input.name === "internalReviewConfirmed") {
      $('[name="internalReviewStatus"]', articleForm).value = input.checked ? "resolved" : "unresolved";
    }
    markFormDirty(articleForm);
    syncPublishMode(articleForm);
    syncArticleAttribution();
    syncInternalReviewState();
    syncArticleActionState();
    syncAiAvailability();
    updateArticlePreview();
    if (input.name === "title") syncArticleTitleCandidateSelection();
    if (["body", "summary", "sourceUrl"].includes(input.name)) invalidateArticleTitleSuggestions();
    saveLocalDraft(articleForm);
  });
  input.addEventListener("change", () => {
    if (["title", "body", "source", "sourceUrl", "sourceKind", "internalNote"].includes(input.name)) {
      $('[name="internalReviewStatus"]', articleForm).value = "unresolved";
      $('[name="internalReviewResolvedAt"]', articleForm).value = "";
      $('[name="internalReviewConfirmed"]', articleForm).checked = false;
    } else if (input.name === "internalReviewConfirmed") {
      $('[name="internalReviewStatus"]', articleForm).value = input.checked ? "resolved" : "unresolved";
    }
    markFormDirty(articleForm);
    syncPublishMode(articleForm);
    syncArticleAttribution();
    syncInternalReviewState();
    syncArticleActionState();
    syncAiAvailability();
    updateArticlePreview();
    if (input.name === "title") syncArticleTitleCandidateSelection();
    if (["body", "summary", "sourceUrl"].includes(input.name)) invalidateArticleTitleSuggestions();
    saveLocalDraft(articleForm);
  });
}

for (const input of $$("input, textarea, select", imageForm)) {
  input.addEventListener("input", () => {
    markFormDirty(imageForm);
    syncPublishMode(imageForm);
    syncImageAttribution();
    syncImageActionState();
    syncAiAvailability();
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
    if (button.dataset.openDetails === "article") {
      setArticleInspectorTab("details");
      articleDetails.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setImageInspectorTab("details");
      $("[data-image-inspector-tab=\"details\"]")?.focus();
    }
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
    const ratioLabels = { square: "方图", wide: "宽图", tall: "长图" };
    $("#image-editor-state").textContent =
      `已读取 ${dimensions.width} × ${dimensions.height} 像素，自动识别为${ratioLabels[ratio]}。`;
    imageForm.dataset.image = "";
    markFormDirty(imageForm);
    syncAiAvailability();
    syncImageActionState();
    updateImagePreview();
    saveLocalDraft(imageForm);
  } catch (error) {
    selectedImage = null;
    showError(imageResult, error);
  }
});

$('[data-ai-fill="article"]').addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = "AI 整理中..."; showResult(articleResult, "正在生成可编辑建议...");
  try {
    const payload = formData(articleForm);
    const suggestion = (await api("/api/ai/article-suggestion", payload)).suggestion;
    const paragraphFormatting = applyArticleSuggestion(suggestion, payload.body);
    resetArticleTitleSuggestions();
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
  finally { button.disabled = false; button.textContent = "AI 整理与分段"; syncAiAvailability(); }
});

articleTitleAi.addEventListener("click", async () => {
  const payload = articleTitleSuggestionPayload();
  const requestContext = JSON.stringify(payload);
  articleTitleAi.setAttribute("aria-busy", "true");
  articleTitleAiStatus.dataset.state = "busy";
  articleTitleAiStatus.textContent = "正在生成 3 个新标题…";
  syncAiAvailability();
  try {
    const { titles } = await api("/api/ai/article-title-suggestions", payload);
    if (JSON.stringify(articleTitleSuggestionPayload()) !== requestContext) {
      articleTitleAiStatus.dataset.state = "error";
      articleTitleAiStatus.textContent = "生成期间文章资料已修改，请重新生成标题。";
      return;
    }
    renderArticleTitleSuggestions(titles);
  } catch (error) {
    articleTitleAiStatus.dataset.state = "error";
    articleTitleAiStatus.textContent = error.message;
  } finally {
    articleTitleAi.setAttribute("aria-busy", "false");
    syncAiAvailability();
  }
});

articleTitleCandidateList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-title-candidate]");
  if (!button) return;
  applyArticleTitleSuggestion(button.dataset.titleCandidate);
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
  articleForm.dataset.publishing = "true";
  syncArticleActionState();
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
        articleAuditGuidance.hidden = false;
        articleAuditGuidance.querySelector("strong").textContent = "发布检查未通过，请处理以下问题";
        articleAuditIssues.innerHTML = quality.issues
          .map((issue) => `<li>${escapeHtml(issue.message)}</li>`)
          .join("");
        articleAuditNextStep.textContent = "修改后再次点击“发布”，系统会重新保存并检查。";
        articleAuditGuidance.scrollIntoView({ behavior: "smooth", block: "center" });
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
  } catch (error) {
    showError(articleResult, error);
  } finally {
    articleForm.dataset.publishing = "false";
    syncArticleActionState();
  }
});

imageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  imageForm.dataset.publishing = "true";
  syncImageActionState();
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
      previewUrl: result.previewUrl || imageForm.dataset.previewUrl,
    });
    showResult(imageResult, formatPublish(result));
    await loadLibrary();
  } catch (error) {
    showError(imageResult, error);
  } finally {
    imageForm.dataset.publishing = "false";
    syncImageActionState();
  }
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
      ? inspection.counts.local
        + inspection.counts.pending
        + inspection.counts.unknown
        + inspection.counts.online
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
          ? "已上线内容需继续同步后，线上页面才会下架。"
          : "本地站点已更新；线上内容尚未变化。",
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

async function syncSelectedContent(button = $("#library-bulk-sync")) {
  const selection = summarizeLibrarySelection(librarySelection);
  if (!selection.count) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  showResult(libraryResult, "正在检查所选内容…");
  try {
    const inspection = await inspectSelectedBatch();
    const eligible = inspection.counts.local
      + inspection.counts.pending
      + inspection.counts.unknown
      + inspection.counts.online;
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
        "Cloudflare 部署完成并通过线上核验后，列表会自动显示为“已上线”。",
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

async function syncCurrentContent() {
  if (!activeContent) return;
  clearLibrarySelection();
  setLibraryFileSelected(librarySelection, activeContent.file, true);
  librarySelectedItems.set(activeContent.file, {
    type: activeContent.type,
    file: activeContent.file,
  });
  try {
    await syncSelectedContent(librarySyncCurrent);
  } finally {
    if (!libraryBatchMode) {
      clearLibrarySelection();
      updateLibrarySelection();
    }
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
    const published = inspection.counts.local
      + inspection.counts.pending
      + inspection.counts.unknown
      + inspection.counts.online;
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
      { undoTrash: result.succeeded.length > 0 },
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
      { undoTrash: lastTrashedItems.length > 0 },
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
  if (event.target.closest("[data-content-select], #library-select-page")) return;
  const row = event.target.closest("[data-content-file]");
  if (row) selectContent(row.dataset.contentType, row.dataset.contentFile);
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
$("#library-batch-toggle").addEventListener("click", () => setLibraryBatchMode(!libraryBatchMode));
$("#library-audit").addEventListener("click", () => switchTab("audit"));
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
$("#content-audit-refresh").addEventListener("click", loadContentAudit);
$("#content-audit-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-audit-open-article]");
  if (!button) return;
  button.disabled = true;
  try { await openAuditedArticle(button.dataset.auditOpenArticle); }
  catch (error) { $("#content-audit-summary").textContent = `无法打开文章：${error.message}`; }
  finally { button.disabled = false; }
});
$("#library-open-trash").addEventListener("click", openRecycleBin);
$("#sync-workspace-refresh").addEventListener("click", () => Promise.all([loadSyncWorkspace(), loadStatus()]));
$("#sync-all-local").addEventListener("click", syncAllLocalContent);
$("#article-version-history").addEventListener("click", () => openVersionHistory(articleForm));
$("#image-version-history").addEventListener("click", () => openVersionHistory(imageForm));
$("#version-history-close").addEventListener("click", () => versionHistoryDialog.close());
$("#version-history-list").addEventListener("click", (event) => {
  const browserButton = event.target.closest("[data-browser-version]");
  if (browserButton) {
    const revision = readDraftRevisions(versionHistoryForm)[Number(browserButton.dataset.browserVersion)];
    if (!revision?.data) return;
    restoreFormSnapshot(versionHistoryForm, revision.data);
    $("#version-history-result").textContent = "已恢复浏览器自动保存版本，尚未写入 Markdown。";
    return;
  }
  const savedButton = event.target.closest("[data-saved-version]");
  if (savedButton) restoreSavedVersion(savedButton.dataset.savedVersion);
});
$("#trash-dialog-close").addEventListener("click", () => trashDialog.close());
trashDialog.addEventListener("click", (event) => {
  if (event.target === trashDialog) trashDialog.close();
});
trashDialog.addEventListener("close", () => {
  if (trashReturnFocus?.isConnected) trashReturnFocus.focus();
  trashReturnFocus = null;
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
$("#private-content-sync").addEventListener("click", syncPrivateContentGit);
$("#system-run-recovery").addEventListener("click", runRecoveryVerification);
$("#recovery-dashboard-refresh").addEventListener("click", loadRecoveryDashboard);
$("#open-system-status").addEventListener("click", () => switchTab("system"));
for (const button of $$("[data-system-view]")) {
  button.addEventListener("click", () => setSystemView(button.dataset.systemView));
}
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
$("#library-bulk-sync").addEventListener("click", (event) => syncSelectedContent(event.currentTarget));
$("#library-bulk-trash").addEventListener("click", trashSelectedContent);
$("#library-undo-trash").addEventListener("click", restoreLastTrashedDrafts);
$("#library-dismiss-feedback").addEventListener("click", () => clearResult(libraryResult));
$("#library-close-detail").addEventListener("click", closeLibraryInspector);
libraryInspector.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLibraryInspector();
});
libraryInspectorDialogQuery.addEventListener("change", () => {
  if (!libraryInspector.hidden) syncLibraryInspectorMode();
});
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
libraryDuplicate.addEventListener("click", async () => {
  if (!activeContent || !window.confirm("复制当前内容并生成一条新的草稿，是否继续？")) return;
  libraryDuplicate.disabled = true;
  libraryDuplicate.setAttribute("aria-busy", "true");
  try {
    const result = await api("/api/content/duplicate", {
      type: activeContent.type,
      file: activeContent.file,
    });
    resetLibraryNavigation();
    setLibraryStatus("draft");
    await loadLibrary();
    await selectContent(result.type, result.file);
    showResult(libraryResult, "已复制为新草稿。标题、日期和内容 ID 已更新，原内容未修改。");
  } catch (error) {
    showError(libraryResult, error);
  } finally {
    libraryDuplicate.disabled = false;
    libraryDuplicate.removeAttribute("aria-busy");
  }
});
librarySyncCurrent.addEventListener("click", syncCurrentContent);
libraryReturnDraft.addEventListener("click", () => {
  if (!activeContent || activeContent.type !== "article" || activeContent.data.draft) return;
  openActiveContent(true);
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
articleSaveDraft.addEventListener("click", () => {
  const alreadyPublished =
    Boolean(articleForm.dataset.editFile) && articleForm.dataset.originalDraft === "false";
  setPublishMode(articleForm, alreadyPublished ? "publish" : "draft");
  syncArticleActionState();
  articleForm.requestSubmit();
});
for (const button of $$("[data-article-inspector-tab]")) {
  button.addEventListener("click", () => setArticleInspectorTab(button.dataset.articleInspectorTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$("[data-article-inspector-tab]");
    const current = tabs.indexOf(button);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setArticleInspectorTab(tabs[next].dataset.articleInspectorTab);
    tabs[next].focus();
  });
}
for (const button of $$("[data-article-inspector-open]")) {
  button.addEventListener("click", () => {
    setArticleInspectorTab(button.dataset.articleInspectorOpen);
    $(`[data-article-inspector-tab="${button.dataset.articleInspectorOpen}"]`)?.focus();
  });
}
articleNextAction.addEventListener("click", () => {
  if (!articleForm.checkValidity()) {
    articleForm.reportValidity();
    return;
  }
  if (
    articleForm.dataset.previewed !== "true"
    && !window.confirm("尚未查看最新版本的真实预览。真实预览是建议步骤，不会阻止发布；仍要继续吗？")
  ) return;
  setPublishMode(articleForm, "publish");
  syncArticleActionState();
  articleForm.requestSubmit();
});

imageRealPreview.addEventListener("click", () => {
  if (!imageForm.dataset.previewUrl || imageRealPreview.disabled) return;
  window.open(imageForm.dataset.previewUrl, "_blank", "noopener");
  imageForm.dataset.previewed = "true";
  syncImageActionState();
});
imageSaveDraft.addEventListener("click", () => {
  const alreadyPublished =
    Boolean(imageForm.dataset.editFile) && imageForm.dataset.originalDraft === "false";
  setPublishMode(imageForm, alreadyPublished ? "publish" : "draft");
  syncImageActionState();
  imageForm.requestSubmit();
});
for (const button of $$("[data-image-inspector-tab]")) {
  button.addEventListener("click", () => setImageInspectorTab(button.dataset.imageInspectorTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$("[data-image-inspector-tab]");
    const current = tabs.indexOf(button);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setImageInspectorTab(tabs[next].dataset.imageInspectorTab);
    tabs[next].focus();
  });
}
imageNextAction.addEventListener("click", () => {
  setImageInspectorTab("details");
  if (!imageForm.checkValidity()) {
    imageForm.reportValidity();
    return;
  }
  setPublishMode(imageForm, "publish");
  syncImageActionState();
  imageForm.requestSubmit();
});

$("#open-site-preview").addEventListener("click", () => {
  if (!sitePreviewAvailable) return;
  window.open(sitePreviewUrl, "_blank", "noopener");
});
$("#refresh-services").addEventListener("click", loadStatus);
$("#recommendation-refresh").addEventListener("click", refreshRecommendations);
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

flomoList.addEventListener("change", (event) => {
  if (event.target.matches("[data-import-select]")) updateFlomoSelectionToggle();
});

flomoOnlyUnselected.addEventListener("change", () => {
  flomoImportFilter = flomoOnlyUnselected.checked ? "needs-review" : "all";
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

flomoImportSelected.addEventListener("click", async (event) => {
  flomoImportBusy = true;
  updateFlomoSelectionToggle();
  try { await applyFlomoImport("draft"); }
  catch (error) { showError(flomoResult, error); }
  finally {
    flomoImportBusy = false;
    updateFlomoSelectionToggle();
  }
});

flomoPublishSelected.addEventListener("click", async () => {
  flomoImportBusy = true;
  updateFlomoSelectionToggle();
  try { await applyFlomoImport("publish"); }
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
  setLibraryStatus($("#open-pending-content").dataset.targetStatus || "local");
  switchTab("library");
});

function recommendationModeLabel(mode) {
  if (mode === "hybrid") return "混合推荐";
  if (mode === "rules") return "规则推荐";
  return "尚未生成";
}

function localDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderRecommendationStatus(recommendations) {
  const status = recommendations || {};
  const root = $(".recommendation-status");
  const total = Number(status.total || 0);
  const covered = Number(status.covered || 0);
  const current = Boolean(status.available);
  root.dataset.state = current && !status.stale ? "ready" : "attention";
  $("#recommendation-mode").textContent = recommendationModeLabel(status.mode);
  $("#recommendation-coverage").textContent = `${covered}/${total} 条内容`;
  $("#recommendation-model").textContent = status.model || "不使用向量模型";
  $("#recommendation-generated-at").textContent = localDateTime(status.generatedAt);

  const vectorDetail = status.embeddingConfigured
    ? `更新时优先使用本地向量模型 ${status.embeddingModel || ""}`.trim()
    : "本地向量未连接时会自动使用规则推荐";
  $("#recommendation-status-summary").textContent = current && !status.stale
    ? `已是最新。${vectorDetail}`
    : `清单与当前公开内容不一致，需要更新。${vectorDetail}`;
}

async function refreshRecommendations() {
  const button = $("#recommendation-refresh");
  const result = $("#recommendation-result");
  button.disabled = true;
  button.textContent = "正在更新";
  result.dataset.state = "loading";
  result.textContent = "正在核对公开内容与本地推荐清单。";
  try {
    const response = await api("/api/recommendations", {});
    renderRecommendationStatus(response.recommendations);
    result.dataset.state = response.fallback ? "attention" : "ready";
    if (response.unchanged) {
      result.textContent = "相关推荐已是最新，没有改写推荐清单。";
    } else if (response.fallback) {
      result.textContent = "本地向量服务不可用，已安全回退到规则推荐。站点构建不受影响。";
    } else {
      const generated = Number(response.summary?.generated || 0);
      const cacheHits = Number(response.summary?.cacheHits || 0);
      result.textContent = `混合推荐已更新。新增 ${generated} 条向量，复用 ${cacheHits} 条缓存。`;
    }
  } catch (error) {
    result.dataset.state = "error";
    result.textContent = `更新失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "更新相关推荐";
  }
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    publisherStatus = status;
    aiAvailable = Boolean(status.ai?.available);
    aiModel = status.ai?.model || "";
    syncAiAvailability();
    const ai = status.ai?.available ? `AI：${status.ai.model}` : "AI：未配置";
    $("#network-ai-detail").textContent = status.ai?.available
      ? `${status.ai.model}。仅在点击 AI 按钮时发送当前表单内容`
      : "未配置，不会发送内容";
    $("#connection-ai").textContent = status.ai?.available ? "已配置" : "未配置";
    const aiEndpoint = typeof status.ai?.baseUrl === "string" && status.ai.baseUrl.trim()
      ? status.ai.baseUrl
      : "OpenAI 兼容接口";
    $("#connection-ai-detail").textContent = status.ai?.available
      ? `${status.ai.model}，${aiEndpoint}`
      : "需要 API 密钥与模型名称，不会在页面显示密钥";
    $("#connection-public-git").textContent = status.git?.canPush
      ? `${status.branch} · 远程已配置`
      : `${status.branch} · 远程未配置`;
    $("#connection-public-git-detail").textContent = status.contentSafety?.ok
      ? `公开内容 ${status.contentSafety.currentVersionInGit}/${status.contentSafety.total} 已进入公开 Git；${status.contentSafety.privateContent || 0} 条私有内容不在此仓库`
      : status.contentSafety?.error || "公开内容 Git 状态待检查";
    const privateGit = privateContentGitState(status.localContentHistory);
    $("#connection-private-git").textContent = privateGit.label;
    $("#connection-private-git").parentElement.dataset.state = privateGit.ready ? "ready" : "attention";
    $("#connection-private-git-detail").textContent = privateGit.detail;
    const prLink = $("#connection-pr-link");
    prLink.hidden = !status.gitCompareUrl;
    if (status.gitCompareUrl) prLink.href = status.gitCompareUrl;
    $("#connection-storage").textContent = status.imageStorage?.provider === "cloudflare-r2"
      ? "Cloudflare R2"
      : "本地 public 目录";
    $("#connection-storage-detail").textContent = status.imageStorage?.bucket
      ? `${status.imageStorage.bucket} · ${status.imageStorage.publicBaseUrl || ""}`
      : "图片随站点内容保存在本机";
    const deploymentPreviewLink = $("#connection-preview-link");
    deploymentPreviewLink.hidden = !status.deploymentPreviewUrl;
    if (status.deploymentPreviewUrl) deploymentPreviewLink.href = status.deploymentPreviewUrl;
    $("#connection-preview").textContent = status.deploymentPreviewUrl ? "已配置" : "未配置";
    renderRecommendationStatus(status.recommendations);
    const remote = status.git?.canPush ? "远程：已配置" : "远程：未配置";
    const localIndex = status.localData?.ok ? "索引：正常" : "索引：需重启恢复";
    const gitContent = status.contentSafety?.ok
      ? `公开 Git：${status.contentSafety.currentVersionInGit}/${status.contentSafety.total}`
      : "公开 Git：待检查";
    const privateHistory = privateGit.ready ? "私有 GitHub：已同步" : `私有 GitHub：${privateGit.label}`;
    $("#status").textContent = `仓库：${status.repoRoot} · 分支：${status.branch} · ${ai} · ${remote} · ${localIndex} · ${gitContent} · ${privateHistory}`;
    updateTrashCount(status.localData?.trash || 0);
    const publisher = $("#publisher-service");
    publisher.dataset.state = "ready";
    publisher.textContent = "管理端运行中";
    const preview = $("#site-preview-service");
    sitePreviewAvailable = Boolean(status.services?.sitePreview?.available);
    sitePreviewUrl = status.services?.sitePreview?.url || sitePreviewUrl;
    preview.dataset.state = sitePreviewAvailable ? "ready" : "offline";
    preview.textContent = sitePreviewAvailable ? "站点预览运行中" : "站点预览未运行";
    $("#open-site-preview").disabled = !sitePreviewAvailable;
    const localPending = Number(status.publicationCounts?.local || 0);
    const deploymentPending = Number(status.publicationCounts?.pending || 0);
    const verificationPending = Number(status.publicationCounts?.unverified || 0);
    const attentionPending = Number(status.publicationCounts?.attention || 0);
    const syncNavigationCount = $("#sync-navigation-count");
    syncNavigationCount.hidden = !localPending;
    syncNavigationCount.textContent = String(localPending);
    const syncSummary = $("#content-sync-summary");
    syncSummary.dataset.state = attentionPending ? "attention" : "ready";
    syncSummary.textContent = attentionPending ? `${attentionPending} 条内容待处理` : "公开内容已核对";
    $("#open-pending-content").textContent = attentionPending
      ? `查看待处理（${attentionPending}）`
      : "查看发布状态";
    $("#open-pending-content").dataset.targetStatus = attentionPending ? "attention" : "all";
    const health = $("#publisher-health");
    const healthLabel = $("#publisher-health-label");
    const healthDetail = $("#publisher-health-detail");
    health.dataset.state = !sitePreviewAvailable || attentionPending ? "attention" : "ready";
    if (!sitePreviewAvailable) {
      healthLabel.textContent = "发布台可用，站点预览未运行";
      healthDetail.textContent = "打开系统详情检查预览服务后再进行真实预览";
    } else if (localPending) {
      healthLabel.textContent = `${localPending} 条内容等待同步`;
      healthDetail.textContent = "本地预览可用，下一步是提交并推送内容分支";
    } else if (deploymentPending) {
      healthLabel.textContent = `${deploymentPending} 条内容等待上线`;
      healthDetail.textContent = "远程已包含当前版本，等待 PR 合并与 Cloudflare 部署";
    } else if (verificationPending) {
      healthLabel.textContent = `${verificationPending} 条内容待重新验证`;
      healthDetail.textContent = "本次线上核对失败，已保留上次确认状态";
    } else {
      healthLabel.textContent = "本地发布环境已就绪";
      healthDetail.textContent = "发布台、站点预览与公开内容状态正常";
    }
    $("#article-advanced-summary").textContent = "精选";
    $("#image-advanced-summary").textContent = "日期、比例与正文";
    updateLibraryActions(activeContent);
    syncArticleActionState();
  } catch {
    $("#status").textContent = "无法读取 Git 状态，但仍可生成本地内容文件。";
    $("#publisher-health").dataset.state = "error";
    $("#publisher-health-label").textContent = "无法读取完整环境状态";
    $("#publisher-health-detail").textContent = "可继续编辑；发布或同步前请展开系统详情重新检查";
    $(".recommendation-status").dataset.state = "attention";
    $("#recommendation-status-summary").textContent = "暂时无法读取推荐状态，可稍后刷新。";
  }
}

restoreLocalDraft(articleForm, $("#article-editor-state"));
restoreLocalDraft(imageForm, $("#image-editor-state"));
syncPublishMode(articleForm);
syncPublishMode(imageForm);
syncArticleAttribution();
syncInternalReviewState();
syncImageAttribution();
syncArticleActionState();
syncImageActionState();
syncAiAvailability();
setArticleInspectorTab("details");
setImageInspectorTab("details");
const storedLibraryPageSize = localStorage.getItem("xgif-library-page-size");
if (["15", "30", "50"].includes(storedLibraryPageSize)) {
  $("#library-page-size").value = storedLibraryPageSize;
}
setLibraryStatus(libraryStatus);
renderLibraryView();
updateArticlePreview();
updateImagePreview();
loadStatus();
restoreWorkspaceRoute({ replace: true });
window.addEventListener("popstate", () => restoreWorkspaceRoute());

window.addEventListener("beforeunload", (event) => {
  if (!isFormDirty(articleForm) && !isFormDirty(imageForm)) return;
  event.preventDefault();
  event.returnValue = "";
});
