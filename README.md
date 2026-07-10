# xgif Astro Theme

`xgif.cn` 的轻内容主题：文章摘要负责整理信息，图片与表情包负责表达情绪。

技术栈：Astro 7 + Markdown Content Collections + GitHub + EdgeOne Pages。

## 本地使用

```bash
npm install
npm run dev
```

本地地址默认为 `http://localhost:4321/`。

## 新增文章

复制 `src/content/articles/` 中任意 Markdown 文件，修改 frontmatter 和正文：

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
note: "可选的一句话点评"
featured: false
---

这里写补充说明或编辑笔记。
```

## 新增图片 / GIF

复制 `src/content/images/` 中任意 Markdown 文件。`image` 可以是放在 `public/` 下的本地路径，也可以是远程图片 URL；远程图片必须记录作者、来源页面与授权信息。

```md
source: "Unsplash · 示例作者"
sourceUrl: "https://unsplash.com/photos/example"
author: "示例作者"
license: "Unsplash License"
licenseUrl: "https://unsplash.com/license"
```

`sourceKind` 的含义：`original` 是原始文章链接；`publication` 是媒体或专题来源页；`editorial` 是本站编辑手记。不要把媒体首页标成原文。

## 构建

```bash
npm run build
```

Astro 会把纯静态部署产物输出到 `dist/`。

`npm test` 会运行构建、详情交互契约、sitemap、来源与图片授权元数据检查。

## 维护交接

项目目标、发布器工作流、AI 配置、视觉约定、部署前提与后续优先级见 [docs/PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md)。

## GitHub + EdgeOne Pages

1. 将本仓库推送到 GitHub。
2. 在 EdgeOne Pages 导入该仓库。
3. 构建命令使用 `npm run build`。
4. 输出目录使用 `dist`。
5. 部署成功后，在 EdgeOne Pages 绑定 `www.xgif.cn`。

内容更新只需要修改 Markdown 并推送；GitHub 的新提交会触发 EdgeOne 重新构建。

## 详情弹窗与 URL

文章和图片卡片始终保留真实详情链接，例如 `/articles/example/` 和 `/images/example/`。在支持 JavaScript 的浏览器中，站点会在当前页面上打开详情弹窗，并使用 History API 同步修改地址栏：

- 浏览器后退会关闭弹窗并恢复原滚动位置；
- 浏览器前进会重新打开对应详情；
- 刷新或直接分享详情 URL 时，会显示完整静态详情页；
- 加载弹窗失败时，会自动退化为普通页面跳转。
