# XGIF Project Handoff

最后更新：2026-08-03

## 1. 当前状态

XGIF 是一个单人维护的轻内容站，当前生产闭环已经完成：

- 正式站点：`https://www.xgif.cn`
- 裸域：`https://xgif.cn` 使用 301 跳转到 `www`，保留路径和查询参数
- 托管：Cloudflare Workers Static Assets
- 图片：旧图片随 Git，新图片使用 Cloudflare R2 `img.xgif.cn`
- 内容：公开 Markdown + Git
- 管理：只在本机运行的发布助手
- 索引：本机可重建 SQLite
- 私有恢复：`npcink/site-xgif-private-content` 的 `history` 分支
- 生产证据：GitHub checks、Cloudflare build、`/build.json` 和每日生产巡检

本阶段完整历史、问题和经验见 [开发复盘](DEVELOPMENT_RETROSPECTIVE_2026-07-24.md)、[开发历史与经验归纳](DEVELOPMENT_HISTORY_AND_LESSONS_2026-08-03.md)、[2026-08-03 实施收口](NEXT_STAGE_IMPLEMENTATION_CLOSEOUT_2026-08-03.md)和 [最近一次生产闭环复盘](DEVELOPMENT_RETROSPECTIVE_2026-08-03.md)；后续开发必须遵守 [开发与交付规范](DEVELOPMENT_AND_DELIVERY_STANDARD.md)，发布收尾按 [发布、恢复与阶段收尾规范](RELEASE_CLOSURE_STANDARD.md)执行。发布助手的详细演进和维护顺序见 [最终交接](../../workflow/docs/LOCAL_PUBLISHER_FINAL_HANDOFF_2026-07-30.md)，产品复盘见 [本地发布助手阶段复盘](../../workflow/docs/LOCAL_PUBLISHER_RETROSPECTIVE_2026-07-24.md)。

## 2. 不可破坏的架构边界

| 路径 / 系统 | 职责 |
| --- | --- |
| `site/` | Astro 公开站点、公开内容、站点测试和部署配置 |
| `workflow/` | 仅本机发布、导入、AI 整理、内容管理和恢复工具 |
| `old/` | 只读 Next.js 视觉基线，不参与构建 |
| `site/src/content/` | 公开文章和图片元数据权威源 |
| R2 / `site/public/images/` | 图片字节权威源 |
| `workflow/.runtime/xgif.sqlite3` | 可删除重建的本地索引 |
| `workflow/private-sources/` | 草稿、外部正文和 R2 字节的私有恢复副本 |
| `workflow/backups/content-history.git` | 白名单限定的私有内容历史 |
| `npcink/site-xgif` | 公开程序、文档、公开内容、PR 与生产部署历史 |
| `npcink/site-xgif-private-content` | 白名单内容、草稿、回收站、私有来源和恢复台账的异机历史 |

禁止把 `workflow/`、`.env`、SQLite、私有来源正文或本地日志部署到 Cloudflare。

不要新增 D1、Vectorize、在线 CMS、Worker 上传 API或多用户后台，除非单人本地模式已被真实需求证明不足，并先写新 ADR。

不要因为主仓库 `git status` 能看到草稿，就把草稿加入公开提交。公开发布与私有恢复的完整决策见 [ADR-013](decisions/ADR-013-public-code-private-content-github-boundary.md)。

## 3. 内容契约

### 文章

- URL 使用不可变 `contentId`：`YYYYMMDD-xxxx`
- 标题和发布日期可以修改，`contentId` 不可修改
- 外部来源文章必须保留有效 `sourceUrl`
- 公开文章展示完整正文
- 导入正文只允许纯文本和 Markdown，不允许原始 HTML
- `editorNote` 可以公开，`internalNote` 只在本地显示
- 权利反馈邮箱：`1355471563@qq.com`

### 图片

- `original`：需要来源、作者和授权信息
- `user_provided`：记录用户确认可公开发布的最小台账
- `unknown`：群聊转存、来源待核实，可以公开，但必须显示投诉与下架入口
- AI 不能推测作者、来源或授权
- 新图片使用 `memes/<sha256>.<ext>` 的 R2 内容寻址对象

## 4. 本地运行

```bash
cd workflow
npm start
```

该命令同时管理：

```text
管理端：http://127.0.0.1:8787
站点预览：http://127.0.0.1:4321
```

发布器会识别旧源码进程并自动安全重启。它校验 Host、Origin、JSON Content-Type 和 CSRF，不允许通过公网隧道直接暴露。

常用命令：

```bash
cd workflow
npm run status
npm test
npm run data:status
npm run data:verify-recovery
npm run data:backup
npm run r2:backup
npm run r2:reconcile
npm run r2:cleanup
```

`r2:cleanup` 默认只观察。孤立对象连续无引用满 30 天、远端正常且私有字节完整后，才允许用完整对象键一次删除一个。

管理端“系统状态与恢复”分别显示公开代码 GitHub 和私有内容 GitHub。点击“同步私有内容 GitHub”只更新白名单内容快照及其私有远端，不会提交公开仓库或触发部署。

## 5. 内容发布状态

面向编辑者只有三个互斥主状态：

1. 草稿；
2. 发布中；
3. 已核验上线。

“发布中”可以用次级筛选区分本地待同步、PR 待合并/部署和待线上核验。Git 提交、推送、PR 和 Cloudflare 部署是同步事实，不是额外的主状态；内容体检问题也不能与部署进度混成同一状态。

批量发布、退回草稿、修改属性、同步、删除和恢复都从“内容管理”完成。草稿真实预览使用与线上相同的 Astro 模板，但生产构建不会输出草稿预览路由。

## 6. 部署

Cloudflare Workers Builds 配置：

| 配置 | 值 |
| --- | --- |
| Project | `site-www-xgif` |
| Production branch | `main` |
| Root directory | `/site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

正常发布流程：

```text
创建分支
→ 提交并 push
→ PR
→ 等待 Astro site、Local publisher、Workers Builds
→ 合并 main
→ 等待生产构建
→ 核对 /build.json 与生产巡检
```

`main` 是受保护分支。不要绕过 PR，也不要在 Workers Builds 运行时并行执行本机 `wrangler deploy`。

## 7. 验证

代码或内容治理变更至少运行：

```bash
(cd workflow && npm test)
(cd site && npm test)
(cd site && npm run test:visual:linux)
(cd site && npm run check:deploy)
git diff --check
```

生产核验：

```bash
cd site
npm run test:production
```

如果需要确认指定版本：

```bash
EXPECTED_SHA=<commit> REQUIRE_APEX_REDIRECT=true npm run test:production
```

macOS 与 Linux 字体栅格不同。视觉截图以 `npm run test:visual:linux` 的 Linux 容器结果为准，不要因为本机像素差异直接更新全部基线。

## 8. 恢复顺序

1. 确认公开 Markdown、图片字节和私有内容 Git；本机快照与私有远端 `history` 提交应一致；
2. 从 Markdown 与回收站旁车重建 SQLite；
3. 运行 R2 对账与私有字节核验；
4. 运行站点构建和测试；
5. 通过 Git PR 重新部署；
6. 用 `/build.json` 和生产巡检确认。

SQLite、`dist/`、Cloudflare 部署和浏览器状态都不是正文权威源。

## 9. 下一阶段

当前工程主线已经收尾。下一阶段优先：

- 复核和发布现有草稿；
- 持续添加真实文章和表情包；
- 观察导入、批量管理和投诉处理的真实使用成本；
- 只为反复出现的痛点增加功能。

不要继续为“可能以后会用”扩展基础设施。

具体开发门槛、验证矩阵、Git/worktree 规则和完成定义见 [开发与交付规范](DEVELOPMENT_AND_DELIVERY_STANDARD.md)。在没有重复真实摩擦、数据风险或发布阻断证据前，停止新增功能。
