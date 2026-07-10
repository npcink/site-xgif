# XGIF

这个仓库包含三个相互独立的部分：

- [`site/`](site/README.md)：Astro 公开站点、内容、资源、站点测试与站点文档。
- [`workflow/`](workflow/README.md)：仅本机运行的发布台；它将内容写入 `site/`，并从仓库根提交 Git。
- [`old/`](old/next-design-baseline/README.md)：保留的 Next.js 模板与视觉基线，不参与构建或发布。

## 日常命令

```bash
cd site && npm run dev
cd site && npm test
cd workflow && npm start
cd workflow && npm test
```

本地验证站点后，再由发布台提交并推送仓库变更。
