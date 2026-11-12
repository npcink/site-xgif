# XGIF 内容工具

由 AI 在本机按需调用的脚本，不提供管理页面、HTTP API、后台进程或内置 AI 编辑器。AI 直接修改 Markdown；格式、内容契约和发布范围由确定性检查约束。架构决策见 [ADR-019](../site/docs/decisions/ADR-019-ai-managed-static-content.md)。

需要 Node.js 22.12+。在 `workflow/` 运行 `npm ci`；预览、构建和 Wrangler 依赖在 `site/` 单独安装。可选的 R2 与离线推荐配置见 `.env.example`，真实凭据只放本机 `.env`。本工具不需要文章或图集 AI API 密钥，AI 由外部助手提供。

## AI 编辑与预览

1. 读取现有文件和 `site/src/content.config.ts`，按现有格式创建或修改内容；文件名必须等于不可变 `contentId`，使用 `YYYYMMDD-xxxx`。可调用 `content-id.js` 的 `createContentId`，传入两类内容已有 ID 集合。
2. 新资料先设为 `draft: true`。不要虚构来源、作者、授权、完整性确认或内部复核结果；未解决的 `publicationHold` 不得解除。标题和日期变动不得重新生成 ID。
3. `cd site && npm run dev` 启动唯一的前端预览。文章草稿使用 `/preview/articles/<contentId>`；图片草稿预览可在私有临时副本中调整公开标记后查看，不为预览提交标记变更。
4. `cd workflow && npm run content:audit` 检查完整内容库，再运行 `cd site && npm test` 验证 Schema、构建与链接。只修复当前任务的内容，不为了报告全绿批量改写历史草稿。
5. 来源和公开范围确认后，将选中内容设为公开，重新检查和预览，按下面的隔离发布流程操作。

Frontmatter 的数组与图集字段使用 JSON 单行形式，例如 `tags: ["生活"]`、`images: [{"src":"https://img.xgif.cn/memes/...png","width":640,"height":480}]`，供 Astro 与内容检查工具共同读取。图集含封面共 1–12 张，`image` 等于第一张 `src`；完整字段以 Astro Schema 为准。修改前读取当前文件，写入前复核差异，避免覆盖其他任务的编辑。

外部来源文章还应把当前完整正文保存到 `private-sources/articles/<contentId>.md`，可复用 `article-publication.js` 的 `prepareArticlePublication`；私有副本不进入公开提交。

正文排版只能增加段落空行时，必须验证字符与顺序没有改变；短内容不能靠扩写凑字数。共享格式规则仍由 `shared-content-formatting.js` 提供。标签使用 `content-taxonomy.js` 的规范词表。

## 内容检查与发布

以下路径均相对仓库根目录，命令在 `workflow/` 内执行：

```bash
npm run content:audit
npm run content:sync -- site/src/content/articles/20261112-ab12.md
npm run content:sync -- --apply site/src/content/articles/20261112-ab12.md
```

默认仅输出所选 Markdown、引用图片与版本哈希，不提交或推送。`--apply` 重新检查草稿、来源、复核债务、正文质量、稳定 ID 和图片引用；只有 `ready` 内容才能同步。同步时再次核对哈希，从最新 `origin/main` 创建隔离分支，不夹带开发提交或其他工作区修改。

推送前后写入私有回执 `records/publication-events.jsonl`；推送失败保留分支，可重试原批次。已推送但 PR 创建失败也可以用同一命令重试，保留已推送的事实：

```bash
npm run content:sync -- --apply --retry content-sync/原分支
```

已经有回执的相同版本不另建分支。重试只发布原批次，不会采用后来修改的内容；新版本需另行检查。新 CLI 共用 `.runtime/content-tools.lock` 防止相互覆盖台账和回执；进程异常退出留下锁时，确认其中 PID 已退出后才可移除。旧维护脚本和外部 AI 写文件也应顺序执行，不与发布或上传并行。

PR 创建失败会返回失败状态和已推送分支；使用 `gh pr list --head <分支>` 核实，再重试。CLI 不自动合并。创建的 PR 应附加到当前 AI 聊天供审查。主分支保护暂时保留 `Local publisher` 检查名，它现在只运行本目录的工具测试。

下架仍需明确选择文件，通过隔离 Git 分支执行版本化删除、PR 和部署；删除本地文件不代表线上已经下架。不要清理 R2 原图来代替下架。推荐清单修改及经过复核的必要素材台账可在专门内容 PR 中精确暂存；不混入普通代码 PR，也不使用 `git add .`。

## 图片查重与上传

```bash
npm run image:check -- /绝对路径/image.png
npm run image:upload -- /绝对路径/image.png
npm run image:upload -- /绝对路径/image.png --apply
```

默认仅读取图片真实格式、尺寸、SHA-256，并用本机 pHash/dHash 查重。只支持 JPEG、PNG、GIF、WebP，最大 8 MB，单边 160–6000 px；字节原样保存，不转换 GIF 动画。相似图仅供对照，不自动合并或删除。GIF 感知检查只比较首帧。

检查存在相似候选或缺少可比较的历史字节时，先核对报告，再用 `--reviewed-sha256 <本次完整图片哈希>` 表达对这个文件的复核；换图后旧哈希无效。相同字节可以复用已有 URL，不应创建重复内容。

`image:upload --apply` 需要 `.env` 中启用 R2。它先保留私有原始字节，再上传内容寻址对象、核对公网可读并追加 R2 台账。上传只返回 URL、尺寸和哈希，不创建文章、推断授权或触发网站部署。返回 URL 后由 AI 写入 Markdown；更新台账的 `contentFile` 关联时应保留原记录字段。`user_provided` 素材还须在 `records/user-provided-assets.jsonl` 保留用户实际确认的日期、公开范围、内容文件和图片哈希，不记录私人身份信息。

感知缓存为 `.runtime/image-fingerprints-v1.json`，可以重建；历史 R2 图片缺少私有字节时会明确报告未检查项，需要时运行 `npm run r2:backup` 补齐。台账格式见 [records/README.md](records/README.md)。

## 备份与维护

```bash
npm run data:backup
npm run data:status
npm run data:rebuild
npm run data:verify-recovery
npm run r2:backup
npm run r2:reconcile
npm run r2:cleanup
npm run recommendations:build -- --rules-only
npm test
```

改写或删除真实内容前以及发布批次完成后运行 `data:backup`，保存内容、台账、私有正文和回收站的私有 Git 快照；配置了私有远端时同步 `history`。SQLite 备份与私有 Git 快照分别核对结果。备份失败时保留文件和错误事实，不继续批量破坏性操作。

SQLite 是可重建索引和离线推荐缓存，仅由按需脚本打开。`r2:cleanup` 默认观察；完整对象键、连续 30 天无引用、远端可用和私有字节完整等门槛保持不变。推荐使用向量时配置 embedding 服务并使用 `--require-embeddings`，故障时保留现有成功清单；`--rules-only` 是明确选择规则生成。

原有来源检查、段落整理与历史迁移命令仍在 `package.json`。迁移默认先预览，只在当前任务确实需要时运行 `:apply`。不要将历史一次性迁移当作日常发布步骤。

## 从旧后台迁移与恢复

停止旧管理器后只启动 Astro 前端。不要删除既有 `.env`、`.runtime/`、`backups/`、`private-sources/`、`trash/` 或台账；停用界面不等于丢弃数据。旧后台的浏览器暂存不在 Git/SQLite 备份中，仍有未保存输入时应先导出。新工作树不会自动复制这些本机私有文件。

先从公开 Git 或私有 `backups/content-history.git` 恢复 Markdown、图片和台账，必要时从私有远端恢复；再 `data:rebuild`、R2 对账、运行站点测试并通过 PR 部署。回滚此架构改动可恢复旧代码，但不要覆盖迁移后的内容或私有数据。

`docs/` 与 `PROJECT_HISTORY.md` 中的旧编辑器、API、端口和启动命令属于历史记录，以本文和 [工程规范](docs/LOCAL_PUBLISHER_ENGINEERING_STANDARD.md) 为当前入口。
