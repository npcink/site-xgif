# XGIF 当前运行手册

最后更新：2026-11-12

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

`.env`、SQLite、私有来源、备份、回收站、日志和发布回执不得进入公开提交。即使草稿位于 `site/src/content/`，也不能把它提交到公开代码 PR。不要引入在线 CMS、D1、上传 API 或第二份正文数据库。

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

```bash
(cd workflow && npm test)
(cd site && npm test)
git diff --check
```

交互变更增加相应浏览器测试；布局变更运行 Linux 视觉基线；部署配置变更运行 `cd site && npm run check:deploy`。真实生产核验为 `cd site && npm run test:production`；确认具体版本时设置 `EXPECTED_SHA` 和 `REQUIRE_APEX_REDIRECT=true`。

通过测试、创建 PR、合并、Cloudflare 构建和线上核验分别报告，不能相互替代。下架必须经过公开 Git 删除、部署和线上消失核验。

## 恢复

先恢复公开 Markdown、图片、台账和私有内容历史，再 `npm run data:rebuild` 重建派生 SQLite，运行 R2 对账、站点测试并经 PR 部署；最后核对线上版本。移除旧后台不清理原 `.env`、备份、回收站或 SQLite。新 worktree 不自动携带本机私有文件。

当前开发规则见 [开发与交付规范](DEVELOPMENT_AND_DELIVERY_STANDARD.md)。历史决策和阶段记录保留在 `decisions/`、本站文档及 `workflow/docs/`。
