# ADR-003: 使用 Cloudflare Pages 部署公开站点

## Status

Superseded by ADR-004

## Date

2026-07-22

## Superseded

Cloudflare 在更新后的新项目指引中明确推荐 Workers Static Assets，并将新功能和优化集中到 Workers。项目尚未建立 Pages 生产部署，因此改用 ADR-004，而不承担迁移成本。本文件保留最初选择 Pages 的背景，不再代表当前部署方案。

## Context

XGIF 仓库包含三个边界不同的目录：`site/` 是 Astro 纯静态公开站点，`workflow/` 是包含本机 AI 配置的发布台，`old/` 是不参与构建的视觉档案。正式代码已托管在 GitHub `npcink/site-xgif`，域名 `xgif.cn` 已使用 Cloudflare 权威 DNS，站点的 canonical、robots 和 sitemap 均以 `https://www.xgif.cn` 为正式地址。

旧文档曾将 Gitee 与 EdgeOne Pages 作为待确认方案，但该链路没有成为正式生产部署。现在需要选择与现有 GitHub 仓库、Cloudflare DNS 和纯静态构建相符的最小托管方案。

## Decision

- 使用 Cloudflare Pages 连接 GitHub `npcink/site-xgif`，以 `main` 为生产分支。
- Pages 的 Root directory 为 `site`，Build command 为 `npm run build`，Build output directory 为 `dist`。
- Node.js 版本由 `site/.node-version` 固定，GitHub Actions 使用同一版本文件。
- 只部署 `site/` 的静态产物；不部署 `workflow/`，不向 Cloudflare 提供 `workflow/.env`。
- 不引入 Cloudflare Workers 适配器、KV、R2、D1 或其他当前站点不需要的运行时服务。
- `www.xgif.cn` 是唯一正式站点地址；裸域 `xgif.cn` 使用 Cloudflare Redirect Rules 返回 301，并保留原路径和查询字符串。
- 首次上线先验收 `*.pages.dev` 部署，再绑定正式域名。

## Alternatives Considered

### EdgeOne Pages

旧文档曾计划使用 EdgeOne，但项目现在已经使用 GitHub 和 Cloudflare DNS。继续采用 EdgeOne 会增加另一套平台与 DNS/证书链路，当前没有对应收益。

### Cloudflare Workers

Workers 适合需要服务端运行时或边缘逻辑的应用。当前 Astro 配置为 `output: "static"`，所有公开页面都在构建期生成，引入 Workers 会增加适配器与运行时维护而不提供必要能力。

### 部署整个仓库

`workflow/` 是只绑定 `127.0.0.1` 的本机发布器，并读取本机 AI 配置；`old/` 只是设计档案。部署整个仓库会模糊安全与所有权边界，因此只允许 Pages 从 `site/` 构建。

## Consequences

- 推送到 `main` 后，Cloudflare Pages 自动构建并发布；Pull Request 可获得独立预览部署。
- 内容仍以 Markdown、图片和 Git 历史为真相来源，不新增线上后台或数据库。
- Cloudflare 控制台只需要 GitHub 仓库授权、Pages 构建配置、正式域名和裸域跳转规则。
- 本地发布台的密钥与授权台账保持在现有边界内，不进入公开部署产物。
- 如果未来引入服务端能力，应另写 ADR 说明为什么静态 Pages 已不足够，而不是直接在当前部署中添加运行时。
