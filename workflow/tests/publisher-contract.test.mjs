import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("publisher exposes local public URLs and keeps empty result panels hidden", async () => {
  const [server, launcher, packageJson, envExample, html, app, css] = await Promise.all([
    read("server.js"),
    read("dev.js"),
    read("package.json"),
    read(".env.example"),
    read("public/index.html"),
    read("public/app.js"),
    read("public/styles.css"),
  ]);

  assert.match(server, /function publicContentUrl/);
  assert.match(server, /function previewContentUrl/);
  assert.match(server, /publicUrl: publicContentUrl/);
  assert.match(server, /previewUrl: previewContentUrl/);
  assert.match(server, /http:\/\/127\.0\.0\.1:4321/);
  assert.doesNotMatch(server, /XGIF_SITE_URL/);
  assert.doesNotMatch(envExample, /XGIF_SITE_URL/);
  assert.match(packageJson, /"dev": "node dev\.js start"/);
  assert.match(packageJson, /"start": "node dev\.js start"/);
  assert.match(packageJson, /"stop": "node dev\.js stop"/);
  assert.match(packageJson, /"restart": "node dev\.js restart"/);
  assert.match(packageJson, /"status": "node dev\.js status"/);
  assert.match(packageJson, /"start:publisher": "node --disable-warning=ExperimentalWarning server\.js"/);
  assert.match(launcher, /Astro 站点预览/);
  assert.match(launcher, /detached: true/);
  assert.match(launcher, /\.runtime/);
  assert.match(launcher, /async function waitFor/);
  assert.match(launcher, /--host", "127\.0\.0\.1", "--port", "4321"/);
  assert.match(html, /id="publisher-service"/);
  assert.match(html, /id="site-preview-service"/);
  assert.match(html, /id="open-site-preview"/);
  assert.match(html, /id="library-open"/);
  assert.match(html, /id="library-preview"/);
  assert.match(html, /id="library-result" hidden/);
  assert.match(html, /class="library-status-tabs"/);
  assert.match(html, /data-library-status="draft"/);
  assert.match(html, /data-library-status="local"/);
  assert.match(html, /data-library-status="online"/);
  assert.doesNotMatch(html, /data-library-status="pending_commit"/);
  assert.match(html, /data-library-view="compact"/);
  assert.match(html, /id="library-pagination"/);
  assert.match(html, /id="library-bulk-publish"/);
  assert.match(html, /id="library-bulk-draft"/);
  assert.match(html, /id="library-bulk-edit"/);
  assert.match(html, /id="library-bulk-sync"/);
  assert.match(html, /id="library-bulk-trash"/);
  assert.match(html, /id="library-select-filtered"/);
  assert.match(html, /id="library-page-size"/);
  assert.match(html, /id="batch-edit-dialog"/);
  assert.match(html, /id="library-undo-trash"/);
  assert.match(html, /id="library-open-trash"/);
  assert.match(html, /id="content-sync-summary"/);
  assert.match(html, /id="open-pending-content"/);
  assert.match(html, /id="library-inspector" hidden/);
  assert.match(html, /class="library-more-actions"/);
  assert.match(html, /id="trash-dialog"/);
  assert.match(html, /id="trash-select-all"/);
  assert.match(html, /id="trash-restore-selected"/);
  assert.match(html, /id="trash-purge-selected"/);
  assert.match(html, /id="storage-backup"/);
  assert.match(html, /id="library-audit"/);
  assert.match(html, /id="content-audit-dialog"/);
  assert.match(html, /id="open-sync-history"/);
  assert.match(html, /id="sync-history-dialog"/);
  assert.match(html, /aria-label="内容类型"/);
  assert.match(html, /aria-label="排序方式"/);
  assert.equal((html.match(/name="publishMode"/g) || []).length, 4);
  assert.match(html, /data-open-details="article"/);
  assert.match(html, /data-open-details="image"/);
  assert.match(html, /class="editor-actions"/);
  assert.match(html, /class="advanced-settings"/);
  assert.match(html, /发布时会自动执行重复检查与质量检查/);
  assert.doesNotMatch(html, /data-check="article"/);
  assert.doesNotMatch(html, /data-check="image"/);
  assert.match(app, /window\.open\(activeContent\.publicUrl/);
  assert.match(app, /window\.open\(activeContent\.previewUrl/);
  assert.match(app, /function syncPublishMode/);
  assert.match(app, /function syncImageActionState/);
  assert.match(app, /function renderLibraryTable/);
  assert.match(app, /function renderLibraryPagination/);
  assert.match(app, /createLibrarySelection/);
  assert.match(app, /const librarySelectedItems = new Map/);
  assert.match(app, /function transitionSelectedContent/);
  assert.match(app, /function syncSelectedContent/);
  assert.match(app, /function applyBatchMetadata/);
  assert.match(app, /function trashSelectedContent/);
  assert.match(app, /function closeLibraryInspector/);
  assert.match(app, /selectAllFiltered/);
  assert.match(app, /function restoreLastTrashedDrafts/);
  assert.match(app, /function loadRecycleBin/);
  assert.match(app, /function purgeSelectedTrash/);
  assert.match(app, /\/api\/storage\/backup/);
  assert.match(app, /\/api\/content\/audit/);
  assert.match(app, /\/api\/history\?action=sync_content/);
  assert.match(app, /id="library-select-page"/);
  assert.match(css, /\.result\[hidden\]/);
  assert.match(css, /\.ai-review-card/);
  assert.match(css, /\.publish-mode-grid/);
  assert.match(css, /\.editor-actions/);
  assert.match(css, /\.panel\.active > \.preview/);
  assert.match(css, /\.content-table/);
  assert.match(css, /\.library-status-tabs/);
  assert.match(css, /\.library-pagination/);
  assert.match(css, /\.content-list\[data-view="compact"\]/);
  assert.match(css, /\.library-bulk-actions/);
  assert.match(css, /\.library-panel\.has-detail/);
  assert.match(css, /\.library-more-actions/);
  assert.match(css, /button\.danger/);
  assert.match(css, /\.trash-dialog/);
});

test("draft publishing uses explicit states, protected-branch guards, and mandatory quality checks", async () => {
  const [server, html, app, css, readme] = await Promise.all([
    read("server.js"),
    read("public/index.html"),
    read("public/app.js"),
    read("public/styles.css"),
    read("README.md"),
  ]);

  assert.match(html, /id="library-transition"/);
  assert.match(html, /id="article-publish-options"/);
  assert.match(html, /name="publishDateMode"/);
  assert.match(app, /function syncArticleActionState/);
  assert.match(app, /发布草稿/);
  assert.match(app, /退回草稿/);
  assert.match(app, /api\/content\/deployment/);
  assert.match(server, /async function getFileWorkflowState/);
  assert.match(server, /async function verifyLiveContent/);
  assert.match(server, /线上已生效/);
  assert.match(server, /发布前质量检查未通过/);
  assert.match(server, /main 分支受保护/);
  assert.match(server, /function getContentWorkflowStates/);
  assert.match(server, /function getContentPublicationStates/);
  assert.match(server, /async function getContentGitSafety/);
  assert.match(server, /function contentStatusCounts/);
  assert.match(server, /async function inspectBatchDrafts/);
  assert.match(server, /async function publishBatchDrafts/);
  assert.match(server, /async function transitionBatchContent/);
  assert.match(server, /async function syncBatchContent/);
  assert.match(server, /auditContentLibrary/);
  assert.match(server, /未通过上线体检，已停止同步/);
  assert.match(server, /recordOperation\("sync_content"/);
  assert.match(server, /\/api\/content\/audit/);
  assert.match(server, /\/api\/history/);
  assert.match(server, /async function resolveBatchItems/);
  assert.match(server, /async function inspectBatchSelection/);
  assert.match(server, /async function updateBatchMetadata/);
  assert.match(server, /async function trashBatchDrafts/);
  assert.match(server, /async function restoreBatchDrafts/);
  assert.match(server, /async function purgeTrashItems/);
  assert.match(server, /LocalDataStore/);
  assert.match(server, /LocalContentBackup/);
  assert.match(server, /editorNote/);
  assert.match(server, /internalNote/);
  assert.match(server, /\/api\/storage\/backup/);
  assert.match(server, /\/api\/trash/);
  assert.match(server, /\/api\/content\/batch/);
  assert.match(server, /pageSize/);
  assert.match(server, /pagination:/);
  assert.match(css, /\.workflow-state/);
  assert.match(readme, /草稿、本地发布、云端发布/);
  assert.match(readme, /“发布到本地”/);
  assert.match(readme, /“同步所选”/);
  assert.match(readme, /移至回收站/);
});

test("publisher writes the metadata required by Astro collections", async () => {
  const [server, html, app] = await Promise.all([read("server.js"), read("public/index.html"), read("public/app.js")]);

  assert.match(server, /sourceKind/);
  assert.match(server, /licenseUrl/);
  assert.match(server, /function normalizeImageAttribution/);
  assert.match(server, /user_provided/);
  assert.match(server, /群聊转存（来源待核实）/);
  assert.match(html, /name="sourceKind"/);
  assert.match(html, /value="unknown"/);
  assert.match(html, /id="unknown-source-note"/);
  assert.match(html, /用户提供素材/);
  assert.match(html, /name="confirmedAt"/);
  assert.match(html, /name="licenseUrl"/);
  assert.match(server, /function inspectImageUpload/);
  assert.match(server, /PUBLISHER_MAX_IMAGE_BYTES/);
  assert.match(server, /图片文件重复/);
  assert.match(server, /409/);
  assert.match(html, /data-image-preview="detail"/);
  assert.match(app, /function imagePayload/);
  assert.match(app, /window\.confirm/);
  assert.match(server, /function recordUserProvidedAsset/);
  assert.match(server, /user-provided-assets\.jsonl/);
});

test("publisher imports flomo exports locally as deduplicated drafts", async () => {
  const [server, importer, html, app, css, readme] = await Promise.all([
    read("server.js"),
    read("flomo-import.js"),
    read("public/index.html"),
    read("public/app.js"),
    read("public/styles.css"),
    read("README.md"),
  ]);

  assert.match(html, /data-tab="import"/);
  assert.match(html, /id="flomo-file"/);
  assert.match(html, /id="flomo-toggle-selection"/);
  assert.match(html, /id="flomo-selection-summary"/);
  assert.match(html, /id="flomo-only-unselected"/);
  assert.match(html, /id="flomo-review-drafts"/);
  assert.doesNotMatch(html, /flomo-select-ready|flomo-clear-selection/);
  assert.match(server, /\/api\/import\/flomo\/inspect/);
  assert.match(server, /\/api\/import\/flomo\/apply/);
  assert.match(server, /flomo-imports\.jsonl/);
  assert.match(server, /draft: true/);
  assert.match(importer, /normalizeImportText/);
  assert.match(importer, /inflateRawSync/);
  assert.match(html, /AI 整理选中项/);
  assert.match(app, /aiOrganizeSelectedImports/);
  assert.match(app, /data-import-field="sourceUrl"/);
  assert.match(app, /data-import-field="source"/);
  assert.match(app, /updateFlomoSelectionToggle/);
  assert.match(app, /summarizeImportSelection/);
  assert.match(app, /organizeImportItem/);
  assert.match(app, /flomoImportFilter/);
  assert.match(app, /id="flomo-exact-duplicates"/);
  assert.match(app, /没有需要导入的内容/);
  assert.match(server, /selectedByDefault: status !== "exact"/);
  assert.match(server, /sourceKind,/);
  assert.match(server, /文章来源仍待确认/);
  assert.match(html, /value="unknown">来源待确认/);
  assert.match(server, /importTags/);
  assert.match(app, /内部导入分组/);
  assert.match(importer, /needsSourceReview/);
  assert.match(css, /\.import-list/);
  assert.match(css, /position: sticky/);
  assert.match(css, /\.import-ai-feedback/);
  assert.match(css, /\.import-duplicates/);
  assert.match(readme, /原始 ZIP 不会保存到仓库/);
});

test("publisher keeps R2 optional and Git metadata authoritative", async () => {
  const [server, storage, envExample, readme, records] = await Promise.all([
    read("server.js"),
    read("r2-storage.js"),
    read(".env.example"),
    read("README.md"),
    read("records/README.md"),
  ]);

  assert.match(server, /ensureR2Asset/);
  assert.match(server, /r2-assets\.jsonl/);
  assert.match(server, /cloudflare-r2/);
  assert.match(storage, /memes\/\$\{hash\}/);
  assert.match(storage, /max-age=31536000, immutable/);
  assert.match(storage, /--remote/);
  assert.match(envExample, /XGIF_R2_ENABLED="false"/);
  assert.match(readme, /已有 `site\/public\/images\/memes\/` 图片不会自动迁移/);
  assert.match(records, /R2 只保存图片字节/);
});
