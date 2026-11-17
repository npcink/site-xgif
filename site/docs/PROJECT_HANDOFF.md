# XGIF 当前运行手册

最后更新：2026-11-17

## 当前架构

XGIF 是单人借助 AI 维护的 Astro 静态内容站。公开站点为 `https://www.xgif.cn`，Cloudflare Workers Static Assets 托管，新图片使用 R2 `img.xgif.cn`。文章和图片 Markdown 是内容权威源，`contentId` 与公开 URL 保持稳定。

可视化管理后台已移除；AI 直接操作文件，通过按需命令行脚本检查、备份、上传图片与创建内容 PR。无需启动管理服务或内置 AI 编辑器。决策见 [ADR-019](decisions/ADR-019-ai-managed-static-content.md)。

| 路径 / 系统 | 职责 |
| --- | --- |
| `site/` | Astro 公开页面、内容、资源、前端测试与部署 |
| `workflow/` | 按需内容工具，不部署到线上 |
| `old/` | 历史视觉参考 |
| `workflow/.runtime/` | 可重建 SQLite、推荐缓存及本机工具锁 |
| `workflow/private-sources/`、`backups/`、`trash/` | 私有正文、图片原字节、内容历史和回收站，必须保留 |
| `workflow/records/` | 图片最小授权/存储台账与被忽略的报告和发布回执 |
| GitHub `npcink/site-xgif` | 公开程序、文档、公开内容、PR 与部署历史 |
| 私有仓库 `npcink/site-xgif-private-content` | 私有内容快照的 `history` 分支 |

`.env`、SQLite、私有来源、备份、回收站、日志和发布回执不得进入公开提交。即使草稿位于 `site/src/content/`，也不能把它提交到公开代码 PR。不要引入在线 CMS、上传 API 或第二份正文数据库。D1 仅用于访客主动收藏/取消的按日汇总，不承载正文或个人收藏夹；见 [ADR-026](decisions/ADR-026-favorite-action-statistics.md)。

## 日常操作

```bash
cd site
npm ci
npm run dev
```

AI 读取现有内容和 `src/content.config.ts` 后编辑 Markdown。新内容先保持草稿，来源、授权、推荐分组和完整性确认不得猜测；不得解除已有 `publicationHold`。文章草稿预览使用 `/preview/articles/<contentId>`，生产不输出草稿预览路由。

```bash
cd workflow
npm ci
npm run content:audit
npm run data:backup
npm run content:sync -- site/src/content/articles/<contentId>.md
```

执行发布前运行 `cd site && npm test` 并检查前端预览；确认后用 `content:sync -- --apply <路径>` 创建隔离分支和 PR。图片检查、R2 上传、备份、失败恢复、台账和下架操作见 [内容工具手册](../../workflow/README.md)。后台历史文档只用于追溯，不作为当前操作入口。

## 部署与核验

| 配置 | 值 |
| --- | --- |
| Project | `site-www-xgif` |
| Production branch | `main` |
| Root directory | `/site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

正常路径：隔离分支 → 精确提交和 push → PR → 必需检查 → 经授权合并 → Workers Builds → `/build.json` 和生产巡检。`Local publisher` 是兼容主分支保护的工具测试名称，现在不再运行后台。不要在自动构建期间并行手工部署。

生产发布必须由用户明确授权。修改、测试、本地预览和创建候选不代表允许上线；未获得该授权时，不合并会触发自动部署的 `main`，不执行生产部署。本地完成与生产上线分别报告。

```bash
(cd workflow && npm test)
(cd site && npm test)
git diff --check
```

交互变更增加相应浏览器测试；布局变更运行 Linux 视觉基线；部署配置变更运行 `cd site && npm run check:deploy`。真实生产核验为 `cd site && npm run test:production`；确认具体版本时设置 `EXPECTED_SHA` 和 `REQUIRE_APEX_REDIRECT=true`。

通过测试、创建 PR、合并、Cloudflare 构建和线上核验分别报告，不能相互替代。下架必须经过公开 Git 删除、部署和线上消失核验。

## 图片展示与界面性能

列表按需加载本地候选（未部署）：图片和收藏每页 24 项，文章保留 12 篇；搜索和标签详情的文章／图片各自每页 24 项。初始 HTML 只含首个页面，后续卡片、轻量目录和全文索引使用同源静态分片；普通浏览首页不请求全库目录，搜索时才获取全文索引。先筛选再分页，保留页码、历史和弹窗位置；网络失败保留已有内容并允许重试。禁用 JavaScript 时可通过普通静态分页链接浏览全部内容。分散结果可能取多片，搜索后仍会下载对应种类的全文索引。设计与边界见 [ADR-029](decisions/ADR-029-static-catalog-shards.md)，前一轮排查见 [列表分页专项排查](LIST_PAGINATION_AUDIT_2026-11-17.md)。

图片卡片以图片为主，只展示标签、图集数量与动图标识，不展示标题和描述段落；标题保留为无障碍名称，完整元数据继续供搜索和详情页使用。此规则适用于首页、图片库、搜索、标签页和相关推荐的共享卡片。

图片详情页和图片弹窗同样以图片为主：不显示大标题和描述段落，标题保留为屏幕阅读器可读的主标题；右侧收紧为分类、非空情绪/场景、标签和操作区。Markdown 的标题、描述与原图不删除，站内搜索仍读取卡片的 `data-search`，网页标题、meta description、分享信息、ImageObject 和 alt 保留。站内关键词检索不依赖可见标题；外部搜索引擎的排名不能仅凭这些元数据保证。

站内图片搜索当前做关键词包含匹配，范围是标题、描述、来源、标签、情绪和场景。尚未独立索引全部图片文字，也不是向量语义搜索；没有进入这些字段的原句或同义改写不保证命中。

详情页内的推荐链接正常跳转独立页面，列表卡片才打开弹窗；弹窗内部连续推荐复用同一弹窗。历史状态只由创建它的文档恢复，刷新后的旧状态按普通页面处理。图片弹窗只有外壳纵向滚动，说明栏随内容自然增高，不能再给内栏增加独立滚动。

弹窗前进／后退按独立历史条目恢复阅读位置和图集选中项；从列表重新打开则从头开始。验收须覆盖首页、分页、搜索、标签、收藏，以及长说明、图文切换、刷新和加载失败，不能只断言弹窗出现。漏检原因与检查范围见 [导航与滚动专项复盘](NAVIGATION_SCROLL_AUDIT_2026-11-16.md)。

图片默认使用构建生成的 WebP，原图按钮仍指向原文件；上传原图后正常构建即可，无需手工转换。动态图保留帧与循环，推荐仍只使用核验原图。细节与回退见 [ADR-028](decisions/ADR-028-static-webp-display-images.md)。冷构建需要访问公开 R2；失败时重试构建并核对线上版本，不部署不完整产物。爱站统计的 CSP／bfcache 兼容仍属第三方待解决项，不能为此放宽安全策略。

## 恢复

先恢复公开 Markdown、图片、台账和私有内容历史，再 `npm run data:rebuild` 重建派生 SQLite，运行 R2 对账、站点测试并经 PR 部署；最后核对线上版本。移除旧后台不清理原 `.env`、备份、回收站或 SQLite。新 worktree 不自动携带本机私有文件。

当前开发规则见 [开发与交付规范](DEVELOPMENT_AND_DELIVERY_STANDARD.md)。历史决策和阶段记录保留在 `decisions/`、本站文档及 `workflow/docs/`。

本阶段入口与已知限制见 [内容发布交接](../../workflow/docs/CONTENT_PUBLISHING_HANDOFF_2026-11-16.md)，复盘见 [收尾复盘](../../workflow/docs/CLOSEOUT_RETROSPECTIVE_2026-11-16.md)。
