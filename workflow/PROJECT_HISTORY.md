# XGIF 项目历史与开发原则

## 项目定位

XGIF 是一个轻量静态内容站，用于分享文章与表情包。站点不追求成为完整 CMS；内容以 Markdown 与图片元数据保存在 Git 仓库中，本地发布台只是帮助维护这些文件的工具，新图片字节可以存入 R2。

当前最小闭环是：

```text
写文章或选择表情包
→ 本地预览
→ 本地发布台生成内容文件
→ 内容分支与 Pull Request
→ GitHub CI 验证
→ Cloudflare Workers Static Assets 部署静态站点
```

## 目录边界

- `site/`：Astro 公开站点、内容、静态资源、站点测试和部署产物。
- `workflow/`：只在本机 `127.0.0.1` 运行的发布台；写入 `site/` 并从仓库根执行 Git 提交与推送。
- `old/`：Next.js 视觉基线留存，不参与构建或发布。

业务目录只保留上述三项。根目录的 `.git/`、`.github/`、`.gitignore` 与 `README.md` 属于仓库和 CI 元数据；缓存、依赖和构建产物必须留在对应业务目录，不能长期堆放在根目录。

## 演进记录

### 1. Astro 站点重组

原项目被重组为 `site/`、`workflow/`、`old/` 三部分：Astro 是当前站点，Next.js 只作为视觉参考，发布台独立为本地工具。部署平台应以 `site/` 为工作目录，构建输出为 `site/dist`。

### 2. 视觉与交互对齐

Astro 首页、搜索、文章与图片详情页按照 Next.js 基线对齐。图片详情弹层的双栏结构、字体层级、搜索筛选、订阅演示与直接详情页均已完成验证。

### 3. 本地发布闭环

发布台提供文章和图片发布、内容管理、重复检查、预览、本地 Git 提交与推送。内容管理只打开 `http://localhost:4321` 用于本地验证；不依赖线上域名变量，也不需要 `XGIF_SITE_URL`。

### 4. 发布安全与来源契约

图片发布台已具备：

- JPEG、PNG、WebP、GIF 的真实文件格式、尺寸和大小校验；
- 文件哈希完全相同则服务端拒绝发布；同标题仅提示确认；
- 列表卡片与图片详情两种发布前预览；
- 外部来源图片必须保留来源、作者与授权信息；
- 明确授权的素材可以标记为 `user_provided`，公开页如实显示“用户提供”，不虚构第三方来源。
- 群聊转存且无法确认作者与授权的图片使用 `unknown`，允许直接发布但必须显示“来源待核实”，并提供版权投诉与下架入口。

用户提供素材的最小授权记录保存在 `workflow/records/user-provided-assets.jsonl`。它不进入 Astro 公开页面，仅记录确认日期、资源哈希、文件路径与公开范围；不得记录真实姓名、联系方式或未验证来源链接。

### 5. 自动验证与版本

GitHub Actions 同时验证 Astro 站点与本地发布台。`v0.2.0` 标记视觉对齐基线，`v0.3.0` 标记发布台、来源契约、图片校验和授权台账已稳定可用。

### 6. Cloudflare Pages 初始部署决策（已取代）

2026-07-22 曾确认以 Cloudflare Pages 托管 `site/` 的纯静态产物，并用 [`site/docs/decisions/ADR-003-cloudflare-pages-deployment.md`](../site/docs/decisions/ADR-003-cloudflare-pages-deployment.md) 取代未落地的 EdgeOne 计划。实际接入时，Cloudflare 的最新新项目指引已转向 Workers Static Assets，因此该决定在建立生产部署前被 ADR-004 取代。

### 7. Workers Static Assets 部署决策

Cloudflare Worker 只上传 `site/dist` 静态资源，不包含 Worker 运行时脚本。GitHub `main` 是生产部署来源，`www.xgif.cn` 是唯一正式域名；构建、Wrangler dry-run 与依赖审计共同作为上线门槛。详见 [`site/docs/decisions/ADR-004-workers-static-assets-deployment.md`](../site/docs/decisions/ADR-004-workers-static-assets-deployment.md)。

### 8. R2 新图片存储决策

新发布的表情包可以由本地发布台按 SHA-256 上传至 R2，并通过 `img.xgif.cn` 公开读取。图片字节进入 R2，内容、来源、授权和对象位置台账仍进入 Git；旧图片不迁移，不新增 D1、Vectorize、Worker 上传 API 或线上后台。详见 [`site/docs/decisions/ADR-005-r2-image-storage.md`](../site/docs/decisions/ADR-005-r2-image-storage.md)。

### 9. 本地 SQLite 可重建索引

发布台使用本地 SQLite 保存内容索引、回收站索引和操作历史，但 Markdown、R2 与 Git 仍是权威数据。数据库不进入 Git，损坏时先隔离再从内容文件和回收站旁车自动重建；数据库备份使用 SQLite Backup API。未发布内容同时进入白名单限定的本机私有 Git 历史，避免被公开仓库意外暴露。详见 [`site/docs/decisions/ADR-007-local-sqlite-index.md`](../site/docs/decisions/ADR-007-local-sqlite-index.md)。

### 10. 系统加固与生产证据链

本地发布器新增源码版本健康检查、Host/Origin/JSON/CSRF 防护和真实 HTTP 集成测试；SQLite 内容列表改为增量索引与 SQL 查询。R2 除台账外增加真实远端核验、按哈希保存的私有原始字节和 30 天孤立对象观察期。静态站生成 `/build.json`，构建后检查站内断链，GitHub 每日核验真实生产站点与防盗链。外部文章正文只接受纯文本和 Markdown。详见 [`ADR-011`](../site/docs/decisions/ADR-011-system-hardening-and-production-evidence.md)。

### 11. 裸域跳转与阶段收尾

`xgif.cn` 已通过 Cloudflare 代理 DNS 和 Single Redirect 永久跳转到 `https://www.xgif.cn`。HTTP 与 HTTPS 均返回 301，原路径和查询参数完整保留；强制生产巡检已通过。至此，站点部署、本地发布、flomo 导入、内容管理、SQLite 恢复、R2 存储与备份、稳定 ID、公开全文治理和生产证据链形成完整闭环。

本阶段详细历史、失败纠正和可复用经验见 [`site/docs/DEVELOPMENT_RETROSPECTIVE_2026-07-24.md`](../site/docs/DEVELOPMENT_RETROSPECTIVE_2026-07-24.md)。

### 12. 本地发布助手产品化与桌面工作区收尾

参考 Gridea 的发布状态和 WordPress 的桌面信息架构后，本地发布助手逐步形成保存草稿、真实预览、本地发布、Git 同步、部署和线上核对的可解释流程。内容管理按草稿、待同步、待上线、待验证和已上线分层，AI 标题生成改为三个可选候选，标签治理、素材复用、恢复看板、封面与目录进入同一套本地优先边界。

最终收尾时，“内容体检与标签”从大型弹窗改成独立工作区，“同步记录”并入系统子页面，回收站保留为短时聚焦弹窗；工作区 URL、刷新恢复、浏览器返回和焦点恢复都进入桌面浏览器回归测试。

完整演进、问题复盘、容器选择方法和后续判断清单见 [`workflow/docs/LOCAL_PUBLISHER_RETROSPECTIVE_2026-07-24.md`](docs/LOCAL_PUBLISHER_RETROSPECTIVE_2026-07-24.md)。

后续收尾继续统一了内容阅读与维护边界：文章和图片使用无尾斜杠的 `/<contentId>` 地址；文章弹窗纳入正文并把推荐放在阅读末尾；图片详情按真实比例完整展示；AI 分析只允许插入段落换行并通过原文完整性校验；页面工作区统一为一个 `h1`。

相关内容推荐采用规则召回、本地向量重排和静态 ID 清单。模型与向量留在本机，线上 Astro 不增加运行时依赖；发布助手在系统页集中显示模式、模型、覆盖率和过期状态。详见 [`site/docs/decisions/ADR-012-offline-hybrid-recommendations.md`](../site/docs/decisions/ADR-012-offline-hybrid-recommendations.md)。

### 13. 公开代码与私有内容 GitHub 分离

主仓库继续保持公开，用于程序、文档、公开内容、PR 验证和 Cloudflare 部署。草稿、回收站、私有来源正文、内容台账和恢复副本由独立私有仓库 `npcink/site-xgif-private-content` 的 `history` 分支保存。

发布助手分别显示“公开代码 GitHub”和“私有内容 GitHub”。公开统计排除草稿和非公开图片；私有状态核对本机快照、远端提交、覆盖文件数与最近同步时间，并提供只操作私有内容历史的重试动作。私有远端失败不会阻断本地保存，也不会触发公开提交或部署。

完整权限、白名单和恢复边界见 [`ADR-013`](../site/docs/decisions/ADR-013-public-code-private-content-github-boundary.md)。

### 14. 单人桌面发布工作台与隔离内容同步

发布助手进一步按“单人、本机、仅桌面”收敛：文章与图片统一使用中间编辑画布、右侧资料标签和顶部“保存草稿 / 真实预览 / 发布”；AI 标题与正文分段回到各自处理位置；来源链接允许留空，重复来源只要求人工确认；GitHub 与 Cloudflare 流程集中到“同步上线”。

公开内容同步不再依赖当前开发分支。系统从最新 `origin/main` 创建临时 worktree 和 `content-sync/<时间>` 分支，只复制白名单内的文章或图片 Markdown，避免夹带代码提交、未保存修改和本地记录。完整阶段结论、失败复盘和后续判断清单见 [`workflow/docs/LOCAL_PUBLISHER_CLOSURE_2026-07-27.md`](docs/LOCAL_PUBLISHER_CLOSURE_2026-07-27.md)。

## 当前开发原则

1. **保持简单。** 网站的核心是分享内容，而不是建设复杂后台。没有真实重复痛点的功能不提前开发。
2. **内容优先。** 新阶段优先发布和验证真实文章、表情包，而不是继续增加管理界面。
3. **诚实标注来源。** 不知道第三方作者或来源时不能编造；只有明确确认可公开发布的素材才能使用“用户提供”契约。
4. **发布应可追溯。** 所有公开内容通过 Git 提交，用户提供素材同时保留最小授权记录；R2 图片保留内容寻址位置台账。
5. **自动化保持轻量。** 本地预览与 GitHub CI 已足够；只有 CI 或实际发布反复暴露同一种问题，才增加新的检查。
6. **按痛点扩展。** 例如“替换已发布图片”“台账批量校验”等能力，只有在实际多次发生且影响发布时再实现。
7. **数据库可以丢，内容不能丢。** SQLite 只能保存可重建索引；正文、图片元数据、来源和授权信息必须留在 Markdown、R2 与 Git。
8. **AI 建议必须可验证。** 影响正文时先建立确定性完整性校验；不能只依赖提示词承诺“不删除”。
9. **公开运行时保持静态。** 推荐等智能能力在本地生成可审查产物，线上页面必须有无模型、无数据库的兜底路径。
10. **一个页面只有一个标题。** 工作区顶栏承担页面级语义，内部模块从次级标题开始，避免重复层级。
11. **发布历史与恢复历史分开。** 公开代码仓库负责审查和部署，私有内容仓库负责草稿、回收站和恢复副本；不能因为两者都使用 GitHub 就合并权限边界。
12. **内容同步与代码开发分开。** 公开内容从 `origin/main` 创建隔离工作树，只提交内容白名单；当前分支和脏工作区不能成为同步基线。
13. **主要动作必须解释失败。** 不用无提示的灰色按钮隐藏规则；点击后应显示具体原因、修复位置和恢复路径。

## 当前运行方式

```bash
cd site && npm run dev
cd site && npm test
cd site && npm run test:production
cd workflow && npm start
cd workflow && npm test
```

日常工作顺序：先用 `site/` 本地查看效果，再用 `workflow/` 发布内容；发布成功后由 GitHub CI 做最终验证，Cloudflare Workers Static Assets 从 `site/` 部署静态产物。

## 未来判断标准

每次准备增加功能前，先回答三个问题：

1. 它是否让“分享一篇文章或一张表情包”更简单？
2. 现有流程是否已经在真实使用中重复造成麻烦？
3. 能否用更少的字段、按钮和维护成本解决？

如果前两项不是明确的“是”，就先不开发。
