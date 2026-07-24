# XGIF

这个仓库包含三个相互独立的部分：

- [`site/`](site/README.md)：Astro 公开站点、内容、资源、站点测试与站点文档。
- [`workflow/`](workflow/README.md)：仅本机运行的发布台；它将内容写入 `site/`，并从仓库根提交 Git。
- [`old/`](old/next-design-baseline/README.md)：保留的 Next.js 模板与视觉基线，不参与构建或发布。

项目资料：

- 当前交接与运行手册：[`site/docs/PROJECT_HANDOFF.md`](site/docs/PROJECT_HANDOFF.md)
- 阶段开发复盘与经验：[`site/docs/DEVELOPMENT_RETROSPECTIVE_2026-07-24.md`](site/docs/DEVELOPMENT_RETROSPECTIVE_2026-07-24.md)
- 本地发布助手产品复盘：[`workflow/docs/LOCAL_PUBLISHER_RETROSPECTIVE_2026-07-24.md`](workflow/docs/LOCAL_PUBLISHER_RETROSPECTIVE_2026-07-24.md)
- 历史与长期原则：[`workflow/PROJECT_HISTORY.md`](workflow/PROJECT_HISTORY.md)
- 架构决策：[`site/docs/decisions/`](site/docs/decisions/)

## 根目录约定

业务目录只保留 `site/`、`workflow/` 与 `old/`。根目录的 `.git/`、`.github/`、`.gitignore` 和本文件属于仓库与 CI 元数据，必须保留；构建产物、依赖目录和部署缓存必须生成在对应业务目录中，不能提交或长期存放在根目录。

## 日常命令

```bash
cd site && npm run dev
cd site && npm test
cd site && npm run test:production
cd workflow && npm start
cd workflow && npm test
```

`npm start` 会同时启动管理器与 Astro 预览，并自动替换已经过期的本地发布器进程。本地验证站点后，再由发布台提交并推送仓库变更。
