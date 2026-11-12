# XGIF

由 AI 协助维护内容的 Astro 静态站点。网站只部署前端静态产物，不运行内容管理后台。

- [`site/`](site/README.md)：公开站点、Markdown 内容、图片、测试与部署配置。
- [`workflow/`](workflow/README.md)：按需执行的内容检查、图片上传、备份和隔离发布工具，没有管理界面或 HTTP 服务。
- [`old/`](old/next-design-baseline/README.md)：历史视觉参考，不参与构建与发布。

## 日常使用

```bash
cd site
npm ci
npm run dev
```

AI 直接编辑 `site/src/content/articles/` 与 `site/src/content/images/` 中的 Markdown。公开前运行内容检查、站点测试并查看前端预览，再通过 GitHub PR 和 Cloudflare Workers Builds 发布。

```bash
(cd workflow && npm ci && npm run content:audit)
(cd site && npm test)
```

详细命令和 AI 操作约定见 [内容工具](workflow/README.md)。当前边界与恢复方式见 [运行手册](site/docs/PROJECT_HANDOFF.md)，迁移原因见 [ADR-019](site/docs/decisions/ADR-019-ai-managed-static-content.md)，开发与交付规则见 [开发规范](site/docs/DEVELOPMENT_AND_DELIVERY_STANDARD.md)。

## 数据与发布

Markdown 是内容权威源；图片保存在公开资源目录或 R2。SQLite 仅供按需运行的工具作为可重建索引，不是网站运行依赖。`workflow/private-sources/`、`backups/`、`trash/`、`.runtime/`、`.env` 与运行回执保持本机私有，不进入公开提交。

内容同步默认只检查指定文件；显式执行后从最新 `origin/main` 建立隔离内容分支，只提交所选公开 Markdown 和其引用的本地图片，并创建 PR。不会自动合并。上传图片、Git 推送、PR 合并和实际部署是不同事实。

根目录只保留项目目录与仓库元数据；依赖、构建产物和缓存存放在对应业务目录。旧发布管理器的历史文档保存在 `workflow/docs/`，只用于追溯，不再作为当前操作入口。
