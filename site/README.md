# xgif Astro Theme

`xgif.cn` 的轻内容主题：文章摘要负责整理信息，图片与表情包负责表达情绪。

技术栈：Astro 7 + Markdown Content Collections + GitHub + Cloudflare Workers Static Assets。

## 本地使用

```bash
npm install
npm run dev
```

本地地址默认为 `http://localhost:4321/`。

## 新增文章

复制 `src/content/articles/` 中任意 Markdown 文件，修改 frontmatter 和正文。原创内容可以在公开 Markdown 保存正文；外部来源内容应通过本地发布助手编辑，公开 Markdown 只保存摘要说明，完整导入正文留在 `workflow/private-sources/`：

```md
---
title: "文章标题"
summary: "两三句话摘要"
source: "来源名称"
sourceUrl: "https://example.com/original"
sourceKind: "original" # original | publication | editorial
tags: ["AI", "产品"]
pubDate: 2026-07-10
readTime: "3 分钟"
editorNote: "可选的公开编辑手记"
internalNote: "可选的内部复核备注，不会显示在公开页面"
featured: false
draft: false
---

原创文章正文；外部来源文章只写“不转载全文”的公开说明。
```

`editorNote` 会显示在文章卡片或详情页，适合解释“为什么值得看”；`internalNote` 仅供本地发布助手复核来源和导入批次。旧 `note` 字段只为兼容历史内容保留，新内容不要继续使用。

## 新增图片 / GIF

复制 `src/content/images/` 中任意 Markdown 文件。`image` 可以是放在 `public/` 下的本地路径，也可以是远程图片 URL；能够确认来源的外部图片必须记录作者、来源页面与授权信息。

```md
source: "Unsplash · 示例作者"
sourceUrl: "https://unsplash.com/photos/example"
author: "示例作者"
license: "Unsplash License"
licenseUrl: "https://unsplash.com/license"
```

微信群、QQ 群等渠道转存且无法确认作者与授权的表情包使用 `sourceKind: "unknown"`，`source` 固定写为“群聊转存（来源待核实）”，不得虚构作者、来源链接或授权。公开详情页会显示来源待核实状态，并链接到 `/rights/` 的投诉与下架说明。

`sourceKind` 的含义：`original` 是原始文章链接；`publication` 是媒体或专题来源页；`editorial` 是本站编辑手记。不要把媒体首页标成原文。

## 构建

```bash
npm run build
```

Astro 会把纯静态部署产物输出到 `dist/`。

`npm test` 会运行构建、详情交互契约、sitemap、来源与图片授权元数据检查。

## 维护交接

项目目标、发布器工作流、AI 配置、视觉约定、部署前提与后续优先级见 [docs/PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md)。

## 部署

Cloudflare Worker 连接 GitHub 仓库 `npcink/site-xgif`，使用以下配置：

| 配置 | 值 |
| --- | --- |
| Project name | `site-www-xgif` |
| Production branch | `main` |
| Root directory | `/site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

`wrangler.jsonc` 将静态资源目录固定为 `./dist`，没有 `main` Worker 脚本。部署只上传 Astro 构建产物，不执行应用运行时代码，也不需要 KV、R2、D1、构建变量或 `workflow/.env`。

Node.js 版本由 `site/.node-version` 固定，Wrangler 版本由 `package-lock.json` 固定。首次部署先验证 Cloudflare 提供的 `*.workers.dev` 地址，再从 Worker 的 Domains & Routes 添加 `www.xgif.cn`。不要把 `workflow/` 部署到线上；它只在本机写入内容并执行 Git 操作。

上线前可在本地验证完整构建与 Workers 静态资源配置：

```bash
npm run check:deploy
```

内容更新只需要修改 `site/` 内的 Markdown 并推送；部署平台按仓库提交重新构建。

本地发布助手会在同步前执行内容体检；只有通过的内容才应进入生产分支。体检报告、SQLite 同步记录和本机预览都不是线上成功证据，仍需核对 GitHub 合并提交、Cloudflare 部署结果和 `https://www.xgif.cn` 的实际页面。

同一个提交只使用一条生产发布路径：正常情况下等待 Cloudflare Workers Builds 自动构建和部署；不要在该构建运行期间同时执行本机 `wrangler deploy`，否则两个版本可能互相覆盖或让其中一条构建被标记失败。只有自动构建已明确失败、且需要恢复线上服务时，才从 `site/` 目录执行 `npm run build && npx wrangler deploy`，随后仍要单独修复并重新验证 Git 自动部署。

## 详情弹窗与 URL

文章和图片卡片始终保留真实详情链接，例如 `/articles/20260723-k7m2/` 和 `/images/20260723-p4x8/`。公开路径来自 frontmatter 的不可变 `contentId`，标题和发布日期之后可以调整，但不能重新生成 ID。完整决策见 [ADR-008](docs/decisions/ADR-008-stable-content-ids.md)。

在支持 JavaScript 的浏览器中，站点会在当前页面上打开详情弹窗，并使用 History API 同步修改地址栏：

- 浏览器后退会关闭弹窗并恢复原滚动位置；
- 浏览器前进会重新打开对应详情；
- 刷新或直接分享详情 URL 时，会显示完整静态详情页；
- 加载弹窗失败时，会自动退化为普通页面跳转。
