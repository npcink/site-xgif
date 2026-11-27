# xgif Astro Theme

`xgif.cn` 的轻内容主题：文章摘要负责整理信息，图片与表情包负责表达情绪。

技术栈：Astro 7 + Markdown Content Collections + GitHub + Cloudflare Workers Static Assets。

## 本地使用

站点需要 Node.js 22.23.4 或更高版本；CI 与 Cloudflare 构建版本由 `.node-version` 固定。

```bash
npm ci
npm run dev
```

本地地址默认为 `http://localhost:4321/`。

## 新增文章

由 AI 复制 `src/content/articles/` 中任意 Markdown 文件，分配新的不可变 `contentId`，修改 frontmatter 和正文。原创和外部来源文章都把完整正文写入公开 Markdown；外部来源文章还应由 AI 在 `workflow/private-sources/articles/<contentId>.md` 保留私有正文副本，再运行内容备份工具：

```md
---
title: "文章标题"
contentId: "20261112-ab12"
summary: "两三句话摘要"
source: "来源名称"
sourceUrl: "https://example.com/original"
sourceKind: "original" # original | publication | editorial | unknown
tags: ["AI", "产品"]
pubDate: 2026-07-10
readTime: "3 分钟"
editorNote: "可选的公开编辑手记"
internalNote: "可选的内部复核备注，不会显示在公开页面"
featured: false
draft: false
---

文章完整正文。
```

文章只有在 `draft` 和 `publicationHold` 均不为真时，才进入公开路由、列表、RSS、站点地图、收藏目录和推荐候选。本地开发预览不受公开筛选限制。页面只渲染显式标记为公开的 `editorNote`（不会回退到旧 `note`），也不读取 `internalNote`；公开仓库中的字段仍可在源码中读取，真正私密的备注不要写入公开 Markdown。

来源与授权链接使用 HTTPS；封面和图片地址可以使用 HTTPS 或 `public/` 下的站内路径。此规则不自动改写历史来源或 Markdown 正文。列表按发布日期从新到旧排列，同日以稳定内容 ID 升序排列。

文章的 `sourceKind`：`original` 表示原始来源，`publication` 表示媒体或专题来源页，`editorial` 表示本站编辑手记，`unknown` 表示来源未核实。不要把媒体首页标成原文。

## 新增图片 / GIF

复制 `src/content/images/` 中任意 Markdown 文件。`image` 可以是放在 `public/` 下的本地路径，也可以是远程图片 URL；能够确认来源的外部图片必须记录作者、来源页面与授权信息。

```md
sourceKind: "original"
source: "Unsplash · 示例作者"
sourceUrl: "https://unsplash.com/photos/example"
author: "示例作者"
license: "Unsplash License"
licenseUrl: "https://unsplash.com/license"
```

微信群、QQ 群等渠道转存且无法确认作者与授权的表情包使用 `sourceKind: "unknown"`，`source` 固定写为“群聊转存（来源待核实）”，不得虚构作者、来源链接或授权。公开详情页会显示来源待核实状态，并链接到 `/rights` 的投诉与下架说明。

图片的 `sourceKind` 只接受 `original`（有可核验来源，保留来源链接、作者和授权信息）、`user_provided`（用户提供且已明确确认发布范围）和 `unknown`（来源未核实）。用户确认不等于原作者授权。

图集使用有序的 `images` 数组（每项为 `{ "src": "...", "width": 640, "height": 480 }`），包含封面在内共 1–12 张；`image` 始终等于首张 `src`。站点构建与发布打包要求 `images:` 使用单行 JSON 数组，不使用多行 YAML 列表。由 AI 按现有 Markdown 与 Schema 创建，图片检查与上传见 [内容工具](../workflow/README.md)。`npm run test:gallery` 会创建并清理临时样本，验证桌面与手机切图。

## 构建

```bash
npm run build
```

Astro 会把纯静态部署产物输出到 `dist/`。

`npm test` 会运行构建、详情交互契约、sitemap、来源与图片授权元数据检查，并扫描构建产物中的站内断链。`/build.json` 会记录当前构建对应的 Git commit 与构建时间，便于区分“源码已推送”和“线上已经运行该版本”。

## 站点配置与 RSS

站点名称、正式域名、默认描述、导航、页脚链接和 RSS 参数统一放在
`src/config/site.ts`。页面模板、sitemap、robots 和结构化数据应读取这份配置，
不要再次硬编码正式域名或品牌名称。

文章 RSS 位于 `/rss.xml`，只包含公开文章的摘要、标签与原始来源，不发布草稿或
完整正文。RSS 条数上限由站点配置控制；页面 `<head>` 与页脚都提供订阅入口。

日常生产可用性巡检可单独执行：

```bash
npm run test:production
```

它会核对生产首页、反馈邮箱、sitemap、公开文章正文与来源、`/build.json` 是否可访问且格式正确、R2 站内读取和防盗链。GitHub Actions 每天执行同一巡检，并额外要求裸域名 `xgif.cn` 使用 301/308 跳转到 `www.xgif.cn`。这项巡检不要求 `EXPECTED_SHA`，也不能代替发布验收。

确认特定版本必须执行发布验收：

```bash
EXPECTED_SHA=<sha> REQUIRE_APEX_REDIRECT=true npm run test:release-acceptance
```

验收会核对线上 commit 与 `EXPECTED_SHA` 一致（不得为 `unknown`）、首页 CSP 与当前 `public/_headers` 一致，以及已撤回文章的公开详情和预览路由保持 404。

## 访问统计

已于 2026-11-18 部署：移除爱站加载器，沿用正式域名已启用的免费 Cloudflare Web Analytics 自动注入，不手工再安装 beacon。当前 Cloudflare 模式排除欧盟访客；页面 `noindex` 不控制边缘注入范围，本地及部署预览无手工统计。收藏动作汇总独立保留。线上浏览器已核验只注入一份 Cloudflare beacon；说明见 [ADR-030](docs/decisions/ADR-030-image-loading-and-static-asset-caching.md)。

`public/_headers` 仅允许 Cloudflare 从 `https://static.cloudflareinsights.com` 加载统计脚本，向同源 `/cdn-cgi/rum` 或 `https://cloudflareinsights.com` 上报，已移除爱站域名。保留对内联脚本和动态代码执行的限制。变更统计服务或启用额外功能时，应重新验证所需地址和 CSP，不放行通配域名。

图片详情的宽度上限与精确宽高比由构建期生成的同源 `/image-ratios.css` 提供，覆盖公开单图和图集成员，不依赖被 CSP 拦截的内联样式；独立页与弹窗共用该样式。详情展示只缩小、不放大，不修改原图。

## 维护交接

- **现行**：[运行手册](docs/PROJECT_HANDOFF.md)、[开发与交付规范](docs/DEVELOPMENT_AND_DELIVERY_STANDARD.md)、[发布收尾规范](docs/RELEASE_CLOSURE_STANDARD.md)。
- **决策**：[架构决策记录](docs/decisions/)保留决策与取代关系；例如 [ADR-019 静态内容与 CLI](docs/decisions/ADR-019-ai-managed-static-content.md)、[ADR-031 草稿与生产可见性](docs/decisions/ADR-031-repository-drafts-and-production-visibility.md)。
- **历史**：[早期开发与收口](docs/DEVELOPMENT_HISTORY_AND_LESSONS_2026-08-03.md)、[性能发布与对照](docs/PERFORMANCE_CLOSEOUT_2026-11-17.md)、[冷加载排查](docs/COLD_LOAD_INVESTIGATION_2026-11-18.md)、[界面修复复盘](docs/UI_FIXES_RETROSPECTIVE_2026-11-23.md)、[图库候选复盘](docs/IMAGE_LIBRARY_UI_CLOSEOUT_2026-11-24.md)、[图库与界面阶段交接](docs/IMAGE_PUBLISHING_AND_UI_HANDOFF_2026-11-25.md)。历史 SHA 和验收仅对应当时的版本。

## 部署

Cloudflare Workers Builds 项目配置与生产核验入口见[运行手册](docs/PROJECT_HANDOFF.md#部署与核验)。

`wrangler.jsonc` 将 Astro 静态资源目录固定为 `./dist`。`worker/index.mjs` 仅处理同源收藏动作汇总，使用已配置的 D1 和限流绑定；公开正文与图片仍由静态资源服务，不运行 CMS。部署不携带 `workflow/.env` 或私有内容。

Node.js 版本由 `site/.node-version` 固定，Wrangler 版本由 `package-lock.json` 固定。首次部署先验证 Cloudflare 提供的 `*.workers.dev` 地址，再从 Worker 的 Domains & Routes 添加 `www.xgif.cn`。不要把 `workflow/` 部署到线上；它只在本机写入内容并执行 Git 操作。

上线前可在本地验证完整构建与 Workers 静态资源配置：

```bash
npm run check:deploy
```

内容更新由 AI 修改 Markdown，经检查和隔离内容 PR 发布；部署平台按主分支提交重新构建。当前不再提供可视化后台，详见 [ADR-019](docs/decisions/ADR-019-ai-managed-static-content.md)。

内容 CLI 会在同步前执行体检；只有通过的内容才应进入生产分支。体检报告、发布回执和本机预览都不是线上成功证据，仍需核对 GitHub 合并提交、Cloudflare 部署结果和 `https://www.xgif.cn` 的实际页面。

同一个提交只使用一条生产发布路径：正常情况下等待 Cloudflare Workers Builds 自动构建和部署；不要在该构建运行期间同时执行本机 `wrangler deploy`，否则两个版本可能互相覆盖或让其中一条构建被标记失败。只有自动构建已明确失败、且需要恢复线上服务时，才从 `site/` 目录执行 `npm run build && npx wrangler deploy`，随后仍要单独修复并重新验证 Git 自动部署。

## 详情弹窗与 URL

文章和图片卡片始终保留真实详情链接，两类内容共用根级地址，例如 `/20260723-k7m2`。`/articles` 和 `/images` 只作为分类索引，不再出现在详情地址中。除网站根目录 `/` 外，公开页面 URL 统一不带尾斜杠。公开路径来自 frontmatter 的全局唯一、不可变 `contentId`，标题和发布日期之后可以调整，但不能重新生成 ID。完整决策见 [ADR-008](docs/decisions/ADR-008-stable-content-ids.md)。

在支持 JavaScript 的浏览器中，站点会在当前页面上打开详情弹窗，并使用 History API 同步修改地址栏：

- 浏览器后退会关闭弹窗并恢复原滚动位置；
- 浏览器前进会重新打开对应详情；
- 刷新或直接分享详情 URL 时，会显示完整静态详情页；
- 加载弹窗失败时，会自动退化为普通页面跳转。
