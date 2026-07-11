# XGIF

这个仓库包含三个相互独立的部分：

- [`site/`](site/README.md)：Astro 公开站点、内容、资源、站点测试与站点文档。
- [`workflow/`](workflow/README.md)：仅本机运行的发布台；它将内容写入 `site/`，并从仓库根提交 Git。
- [`old/`](old/next-design-baseline/README.md)：保留的 Next.js 模板与视觉基线，不参与构建或发布。

项目的历史、边界与后续开发原则见 [`workflow/PROJECT_HISTORY.md`](workflow/PROJECT_HISTORY.md)。

## 根目录约定

业务目录只保留 `site/`、`workflow/` 与 `old/`。根目录的 `.git/`、`.github/`、`.gitignore` 和本文件属于仓库与 CI 元数据，必须保留；构建产物、依赖目录和部署缓存必须生成在对应业务目录中，不能提交或长期存放在根目录。

## 日常命令

```bash
cd site && npm run dev
cd site && npm test
cd workflow && npm start
cd workflow && npm test
```

本地验证站点后，再由发布台提交并推送仓库变更。
