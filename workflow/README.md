# XGIF 内容工具

由 AI 在本机按需调用的脚本，不提供管理页面、HTTP API、后台进程或内置 AI 编辑器。AI 直接修改 Markdown；格式、内容契约和发布范围由确定性检查约束。架构决策见 [ADR-019](../site/docs/decisions/ADR-019-ai-managed-static-content.md)。

需要 Node.js 22.12+。在 `workflow/` 运行 `npm ci`；预览、构建和 Wrangler 依赖在 `site/` 单独安装。可选的 R2、离线推荐及 AI 字段重跑配置见 `.env.example`，真实凭据只放本机 `.env`。普通内容工具不需要 AI 密钥；只有显式运行 `ai:metadata generate` 才调用所配置的模型。

## AI 编辑与预览

1. 读取现有文件和 `site/src/content.config.ts`，按现有格式创建或修改内容；文件名必须等于不可变 `contentId`，使用 `YYYYMMDD-xxxx`。可调用 `content-id.js` 的 `createContentId`，传入两类内容已有 ID 集合。
2. 新资料先设为 `draft: true`。不要虚构来源、作者、授权、完整性确认或内部复核结果；未解决的 `publicationHold` 不得解除。标题和日期变动不得重新生成 ID。
3. `cd site && npm run dev` 启动唯一的前端预览。文章草稿使用 `/preview/articles/<contentId>`；图片草稿预览可在私有临时副本中调整公开标记后查看，不为预览提交标记变更。
4. `cd workflow && npm run content:audit` 检查完整内容库，再运行 `cd site && npm test` 验证 Schema、构建与链接。只修复当前任务的内容，不为了报告全绿批量改写历史草稿。
5. 来源和公开范围确认后，将选中内容设为公开，重新检查和预览，按下面的隔离发布流程操作。

只保存草稿版本时，可将已确认允许在公开 GitHub 上阅读的 Markdown 单独提交，保留 `draft: true`（图片另设 `public: false`）。不要用 `content:sync` 同步草稿，它仍只接受达到上线条件的内容。私密草稿仍留在本机或私有内容历史；未上线专用素材不要放进 `site/public/` 或上传到公开 R2。见[草稿入库与生产展示规则](../site/docs/decisions/ADR-031-repository-drafts-and-production-visibility.md)。

Frontmatter 的数组与图集字段使用 JSON 单行形式，例如 `tags: ["生活"]`、`images: [{"src":"https://img.xgif.cn/memes/...png","width":640,"height":480}]`，供 Astro 与内容检查工具共同读取。图集含封面共 1–12 张，`image` 等于第一张 `src`；完整字段以 Astro Schema 为准。修改前读取当前文件，写入前复核差异，避免覆盖其他任务的编辑。

经人工确认公开的放大衍生图应独立发布，填写 `upscale: "real-esrgan"` 或 `upscale: "lanczos"`。原图、所选版本和确认记录的映射私有留存；公开文件仅引用衍生图。衍生图仍参与图库浏览和发布快照核验，但不作为推荐或语义系列证据。

外部来源文章还应把当前完整正文保存到 `private-sources/articles/<contentId>.md`，可复用 `article-publication.js` 的 `prepareArticlePublication`；私有副本不进入公开提交。

正文排版只能增加段落空行时，必须验证字符与顺序没有改变；短内容不能靠扩写凑字数。共享格式规则仍由 `shared-content-formatting.js` 提供。标签使用 `content-taxonomy.js` 的规范词表。

摘要单独写入 `summary`，概括文章内容，不用原文开头截断代替摘要。未经明确授权，不改写原文措辞、标点、错字或叙述顺序；排版调整也要与导入原文逐字核对。文章详情将摘要放在标题下，标签放在正文末尾、相关推荐之前。

更换模型或批量重做 AI 字段时，使用 [`ai:metadata` 重跑流程](docs/AI_METADATA_RERUNS.md)：可选择字段、保留指定值，先跑 eval-lab 固定小样本，再生成整体对照、核验并本地写回；支持断点复用、预算限制和回退。架构边界见 [ADR-021](../site/docs/decisions/ADR-021-versioned-ai-metadata-reruns.md)。

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

批量图片先区分纯内容发布与涉及 Schema、页面或推荐逻辑的变更。发布、回读验收和组图复核见[批量图片发布规范](docs/LOCAL_PUBLISHER_ENGINEERING_STANDARD.md#批量图片发布)。

下架仍需明确选择文件，通过隔离 Git 分支执行版本化删除、PR 和部署；删除本地文件不代表线上已经下架。不要清理 R2 原图来代替下架。推荐清单修改及经过复核的必要素材台账可在专门内容 PR 中精确暂存；不混入普通代码 PR，也不使用 `git add .`。

## 图片查重与上传

```bash
npm run image:check -- /绝对路径/image.png
npm run image:series -- /绝对路径/image.png
npm run image:upload -- /绝对路径/image.png
npm run image:upload -- /绝对路径/image.png --apply
```

默认仅读取图片真实格式、尺寸、SHA-256，并用本机 pHash/dHash 查重。只支持 JPEG、PNG、GIF、WebP，最大 8 MB，单边 160–6000 px；字节原样保存，不转换 GIF 动画。相似图仅供对照，不自动合并或删除。GIF 感知检查只比较首帧。

检查存在相似候选、完全重复候选或缺少可比较的历史字节时，先核对报告，再用 `--reviewed-sha256 <本次完整图片哈希>` 表达对这个文件的人工复核；换图后旧哈希无效。相同字节可以复用已有 URL，但不会自动合并到已有系列。

`image:upload --apply` 需要 `.env` 中启用 R2。它先保留私有原始字节，再上传内容寻址对象、核对公网可读并追加 R2 台账。上传只返回 URL、尺寸和哈希，不创建文章、推断授权或触发网站部署。返回 URL 后由 AI 写入 Markdown；更新台账的 `contentFile` 关联时应保留原记录字段。`user_provided` 素材还须在 `records/user-provided-assets.jsonl` 保留用户实际确认的日期、公开范围、内容文件和图片哈希，不记录私人身份信息。

感知缓存为 `.runtime/image-fingerprints-v1.json`，可以重建；历史 R2 图片缺少私有字节时会明确报告未检查项，需要时运行 `npm run r2:backup` 补齐。台账格式见 [records/README.md](records/README.md)。

`image:series` 与 `image:check` 共用检查结果，并额外返回 `seriesCandidates`。候选按已有图片内容聚合，列出命中的图集成员、证据、置信度和 `duplicate` / `review` / `separate` 状态；每个候选都带 `reviewPolicy: "manual-required"`。Qwen3-VL-Embedding 2B 服务可用时补充图文向量证据；服务不可用时仍可用本机感知指纹完成检查。无论置信度多高，都必须人工确认后才允许后续批量合并；检查阶段不会自动改写 Markdown、删除内容或改变旧 URL。

系列向量逐张读取当前公开、非草稿图片的已核验原始字节，不依赖相关推荐是否已经重算；标题、描述、标签不参与编码。查询图片的相同 SHA-256 不作为语义命中（重复图片仍由查重报告处理）。独立派生缓存为 `.runtime/series-image-embeddings-v1.json`，按原图 SHA-256、模型名称、模型 digest 和输入版本复用；删除即可重建。动态图只取首帧，缩放上限 768 px。

`seriesEmbedding` 报告模型 digest、输入版本、检查成员数、缓存命中和未检查内容数。`partial` 表示有内容缺少可核验原图，不能理解为“没有同系列”；上传时也须复核未检查项。`unavailable` 表示服务不可用，感知指纹降级不能替代语义识别。语义候选余弦阈值暂为 0.62；`score` / `confidence` 是启发式证据分数，不是同系列概率。小样本中已发现同系列漏检，不应据此自动合并或直接降低阈值。

M4 Ollama 只监听本机时，在本机 `.env` 设置 `XGIF_EMBEDDING_SSH_TARGET="用户名@M4地址"`、`XGIF_EMBEDDING_SSH_REMOTE_PORT="11434"`，并将服务地址设为 `http://127.0.0.1:11435`。系列检查会按需建立 SSH 转发，检查结束或失败后关闭自己建立的连接；已有连接直接复用。需要预先建立可信 SSH 主机与密钥访问，不弹出密码或首次主机确认。M4 离线时返回明确失败原因，继续本机查重。

每次完成检查后追加本机 `.runtime/image-checks.jsonl`，记录图片哈希、模型状态、命中成员、候选及本次哈希是否已复核，方便遇到问题后追查。记录不包含原图、绝对文件路径或密钥，不进入公开内容；`checkRecordSaved: false` 表示记录未写入。日常上传由 AI 处理检查与独立建图集，涉及已有图集合并时再向用户确认；检查无命中不代表保证没有同系列。

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

SQLite 是可重建索引和离线推荐缓存，仅由按需脚本打开。`r2:cleanup` 默认观察；完整对象键、连续 30 天无引用、远端可用和私有字节完整等门槛保持不变。

### 统一图文推荐

文章与图片统一使用 M4 上的 `RizwanMalik/qwen3-vl-embedding-2b:q8_0-q8_0`（Qwen3-VL-Embedding 2B，2048 维）。在被忽略的 `workflow/.env` 配置原生 Ollama 接口，地址必须是服务根路径，不含 `/v1`：

```dotenv
XGIF_EMBEDDING_PROVIDER="ollama"
XGIF_EMBEDDING_BASE_URL="http://127.0.0.1:11435"
XGIF_EMBEDDING_MODEL="RizwanMalik/qwen3-vl-embedding-2b:q8_0-q8_0"
XGIF_EMBEDDING_TIMEOUT_MS="120000"
```

M4 的 Ollama 只监听回环地址；执行前按需建立 SSH 本地回环转发，用完关闭。工具不会启动常驻后台、安装模型或向公网模型上传图片。

```bash
npm run recommendations:build -- --require-embeddings
```

文章只编码原始正文：按每段最多 1200 个 Unicode 码点确定性切分，覆盖全文，各段向量归一化后按段长加权平均。图片只编码真实画面；图集逐张串行编码，归一化后等权平均为内容向量。AI 标题、摘要、标签、分类、描述、情绪、场景、alt 均不参与向量、规则分数或缓存指纹；它们仍用于展示和标签浏览。仅从 `site/public` 或 R2 台账对应且哈希一致的私有备份读取图片，缺少字节时先补齐备份；不临时下载任意外链。最长边缩至 768 像素用于推理，原图不改动；GIF 和动态 WebP 当前仅分析首帧。

缓存绑定模型名、Ollama 模型 digest、输入管线版本、原始正文及有序图片字节哈希。更新原文、图片、模型权重或管线后重新计算对应向量；只重做 AI 字段不失效。公开集合、安全分组和发布日期变化只需重建排序清单，可复用未变向量。语义排序采用 90% 向量相似度、10% 新鲜度，保留安全分组、固定探索及成人幽默组内可达性约束；不叠加原文词面分数。涉及图片的候选要求余弦相似度至少 0.35；门槛仍是保守起点，不代表概率。清单带 `selection.evidenceVersion: original-sources-v2`，前端只消费已有列表，空数组不补入弱相关内容。

命令行只更新 `site/src/data/recommendations.json` 和本机派生缓存，不修改 Markdown 或发布状态。未指定严格模式时，如果模型或图片读取失败，保留已有的成功 `hybrid` 清单并以非零退出码报告失败；严格模式直接失败且不写清单。只有显式 `--rules-only` 才能用规则覆盖成功向量结果。规则兜底及缺清单时，文章仅按完整原文词面重合和日期排序；图片不使用文字描述推测画面关系，只提供确定性顺序。旧 `openai` 文本接口仅支持纯文章库的完整正文分段；混合图片库必须使用原生多模态 Ollama，不能用 AI 描述替代图片。

多模态清单为每条内容保留最多 12 个合格的图片候选。前台过滤本次会话已看过的图片，按原顺序补位，仍按容器宽度只显示最多两行（4、6 或 8 张）。候选不足不降低门槛，也不重复展示已看内容。仅调整候选数时可复用匹配模型摘要和原始依据指纹的向量，不需要重新推理。

生成后核对 `model`、`dimensions`、公开内容覆盖和真实推荐，再通过 PR 发布静态 ID 清单；前端构建和线上访问都不调用模型。原始依据边界与迁移见 [ADR-022](../site/docs/decisions/ADR-022-original-evidence-recommendations.md)，统一模型决策沿用 [ADR-020](../site/docs/decisions/ADR-020-unified-multimodal-recommendations.md)。

原有来源检查、段落整理与历史迁移命令仍在 `package.json`。迁移默认先预览，只在当前任务确实需要时运行 `:apply`。不要将历史一次性迁移当作日常发布步骤。

## 从旧后台迁移与恢复

停止旧管理器后只启动 Astro 前端。不要删除既有 `.env`、`.runtime/`、`backups/`、`private-sources/`、`trash/` 或台账；停用界面不等于丢弃数据。旧后台的浏览器暂存不在 Git/SQLite 备份中，仍有未保存输入时应先导出。新工作树不会自动复制这些本机私有文件。

先从公开 Git 或私有 `backups/content-history.git` 恢复 Markdown、图片和台账，必要时从私有远端恢复；再 `data:rebuild`、R2 对账、运行站点测试并通过 PR 部署。回滚此架构改动可恢复旧代码，但不要覆盖迁移后的内容或私有数据。

`docs/` 与 `PROJECT_HISTORY.md` 中的旧编辑器、API、端口和启动命令属于历史记录，以本文和 [工程规范](docs/LOCAL_PUBLISHER_ENGINEERING_STANDARD.md) 为当前入口。

### 发布快照与原始依据评测

`content:sync` 的 dry-run 现在要求存在本地 `origin/main`，按该确定提交加本批文件核验；不使用本机全部未发布内容作为目标。只有匹配目标公开集合的清单可随批次同步，原文/图片/分组/日期改变但未重建会阻断；仅改 AI 展示字段可复用原清单。远端基线变动时重新 dry-run。隔离提交、删除和重试还会核验最终快照，CI 再做相同检查。独立运行 `npm run recommendations:verify` 不需要模型服务、私有图片台账或网络。内容寻址 R2 地址提供离线对象身份约定，不等于远端实时可用性验证。

不要为消除阻断而发布包含其他未选内容的本机全库清单。需要重建时，先用 `git archive origin/main` 在私有临时目录生成目标副本，仅拷入本批 Markdown 和引用资产，再用本地内容工具针对该副本生成清单；拷回的清单仍须通过 dry-run 目标核验。工具不静默降级/替换现有多模态模型。

离线导出当前公开库及匹配向量供独立项目评测：

```sh
node --disable-warning=ExperimentalWarning recommendation-quality-export.js --root /绝对路径/内容库 --output /绝对路径/内容库/workflow/.runtime/recommendation-quality/input.json
cd /绝对路径/npcink-eval-lab
composer eval:site-xgif-recommendations -- --input /绝对路径/内容库/workflow/.runtime/recommendation-quality/input.json --output /绝对路径/内容库/workflow/.runtime/recommendation-quality/report.json
```

导出只读 SQLite，不补向量、不联网，缓存不匹配则停止。私有原文、向量与结果不进入代码提交。固定样本将模型排序与实际展示分别衡量；总评失败应保留具体案例，不能修改固定标签或降低阈值使之通过。详见 ADR-023。

### 主题补充检查

待发布图片未经明确授权不得发送到外部视觉服务；本机配置仍指向外部服务时，先设 `XGIF_SERIES_THEME=off`。这不会关闭用于系列向量的 M4 Ollama。即使向量检查为 `ready`，它也只查当前公开图库，不能代替同批新图之间的复核。

设置 `XGIF_SERIES_THEME=on`，并填写专用的 `XGIF_SERIES_VISION_PROVIDER/BASE_URL/MODEL/API_KEY` 后，`image:check` 和 `image:upload` 会独立比较现有公开图片的原始像素，补充向量未命中的主题关联。可用支持图片的 OpenAI 兼容服务或本机 Ollama；密钥仅放在未跟踪的本机 `.env`。主题模型与 Qwen3-VL-Embedding 2B 是不同职责，可分别更换。第三方视觉服务会接收待上传图和现有公开图片的缩放首帧。

`similarity.seriesTheme` 报告模型、输入版本、比较范围、缓存命中及检查状态；候选保留 `same_series`、`shared_template`、`related_theme` 和两侧原图的证据。仅仅都是猫、搞笑图或九宫格不能构成主题关系。`related_theme` 不等于同系列，最终是否合并仍由用户决定。模型请求不含标题、描述、标签、alt、原文件名和图片 URL；检查不会改动原图或内容。

每次最多检查 120 张去重后的公开成员，每批 6 张，最多 20 次调用；首次扫描可能较慢并产生模型费用。超限或缺少可核验字节返回 `partial`，请求或输出异常返回 `unavailable`，不能当作“没有关联”。启用主题检查后，这两种状态同样要求上传复核。缓存按原图 SHA-256、服务、模型、提示词、输入版本与 revision 隔离。服务端模型升级时修改 `XGIF_SERIES_VISION_REVISION`；`XGIF_SERIES_THEME_REFRESH=1` 可强制重算。只有预先明确允许的 `XGIF_SERIES_VISION_REPORTED_MODEL_ALIASES` 才接受不同返回模型名，默认严格一致。

## 动图识别与日常发布

`image:check` / `image:upload` 返回依据原始帧数判定的 `animated`。单图写在顶层，图集写入每个成员；不按 GIF/WebP 扩展名猜测。新增图片或图集成员后，先预览 `npm run image:media`，再执行 `npm run image:media -- --apply` 补齐公开图片的事实属性。命令只更新动画属性，不修改原文、标题、来源、原图或成员顺序；缺少核验字节时停止。公开图片属性缺失会阻断构建，避免误归为静态图。混合图集同时出现在两类筛选中，保持同一个 URL。

## 收藏操作统计

本地收藏列表仍保存在访客浏览器；正式站点仅将主动收藏／取消的内容 ID、类型和动作发送到同源接口，按 UTC 日汇总到 Cloudflare D1，不采集个人收藏夹。操作次数不能当作收藏人数、净收藏总数或直接用于相关推荐。AI 和站长可在 `site/` 执行 `npm run stats:favorites -- 30`，或在 Cloudflare D1 控制台查询 `xgif-engagement`。免费额度、数据口径、停用方式见 [ADR-026](../site/docs/decisions/ADR-026-favorite-action-statistics.md)。

收藏接口的限流阈值、近似计数限制及紧急停写／停流步骤见 ADR-026 的“接口防滥用”。正常收藏无需登录或验证码；超限只会丢弃统计，不清除浏览器收藏。
