# XGIF 工作区收口审计

日期：2026-08-03

关联计划：[XGIF 下一阶段计划：先收口，再观察，最后才开发](NEXT_STAGE_PLAN_2026-08-03.md)

## 结论

当前工作区不是一个可以整体提交或整体发布的批次。它混合了已经进入 `origin/main` 的公开内容、另一项已完成但尚未提交的发布台改动、独立的站点 UI/视觉改动、运行记录和本轮决策文档。

本轮通过逐文件 blob 哈希与 `origin/main` 比对，确认当前所有文章 Markdown、图片元数据 Markdown 和 `site/src/data/recommendations.json` 都与 `origin/main` 完全一致。它们之所以显示为修改或未跟踪，是因为当前检出分支落后于主分支，而不是因为存在一批尚未发布的新内容。

因此：

- 不得把当前内容文件再次同步或提交；
- 不得在当前脏工作区执行批量暂存；
- 后续代码和文档收口必须从 `origin/main` 创建隔离 worktree；
- 没有新的合格内容批次时，不为满足计划而制造一次虚假发布。

## 当前基线

| 项目 | 审计事实 |
| --- | --- |
| 当前分支 | `codex/local-publisher-closure-20260725` |
| 当前提交 | `d852830` |
| 对应远端功能分支 | ahead 0 / behind 0 |
| `origin/main` | `3e06d69`，包含近期内容、推荐和生产巡检合并 |
| 开放 PR | 0 |
| 草稿 | 文章 0、图片 0 |
| 可识别的新公开内容批次 | 0 |

当前分支与它自己的远端一致，不代表它与 `origin/main` 一致。判断文件是否待发布时，应以 `origin/main` 和线上证据为准，不能仅看 `git status`。

## 变更所有权与处置矩阵

| 批次 | 文件范围 | 当前判断 | 处置 |
| --- | --- | --- | --- |
| 已合并公开内容 | `site/src/content/articles/**`、`site/src/content/images/**`、`site/src/data/recommendations.json` | 文件内容与 `origin/main` 完全一致 | 不提交、不重发；切到新主分支后自然消失 |
| 发布台导入与自动 PR | `workflow/README.md`、`workflow/github-publication-facts.js`、`workflow/github-pull-request.js`、`workflow/public/**`、`workflow/server.js` 及对应测试 | 来自任务 `019fc389-a547-7903-bca2-e9ff7ee33072`；该任务报告 174 个单元/契约测试、HTTP 集成、26 个浏览器测试通过，但未执行真实 push/PR | 作为独立代码批次，从 `origin/main` 重放并重新验证；不得混入内容或本文档批次 |
| Astro 内容管理说明 | `site/docs/ASTRO_CONTENT_AUTHORING_AND_MANAGEMENT.md` | 来自任务 `019fc389-cb3d-7a43-9f40-d317f4417bfd` | 独立文档批次处理 |
| 首页发现与视觉基线 | `site/public/scripts/home-discovery.js`、`site/src/pages/index.astro`、`site/src/styles/global.css`、设计契约、视觉测试和截图 | 本轮开始前已存在；目标是首页搜索、计数和视觉基线调整，未确认近期任务所有权 | 保持原样，待单独审查；不得顺带提交 |
| 生产巡检与封面策略 | `site/scripts/production-smoke.mjs`、`site/src/components/ArticleDetailPage.astro`、`site/tests/system-hardening.test.mjs` | 本轮开始前已存在；其中直接文章路由目标已由 `origin/main` 的 PR #37 实现，本地实现可能已被替代；封面 `referrerpolicy` 是另一项窄改动 | 保持原样；分别和主分支实现比较后再决定，不得整体搬运 |
| 本地运行记录 | `workflow/records/flomo-imports.jsonl`、`workflow/records/r2-assets.jsonl` | 用户运行数据，且此前任务明确保留 | 不自动公开、不批量暂存、不覆盖 |
| 本轮架构与阶段文档 | ADR-017、ADR-018、`NEXT_STAGE_PLAN_2026-08-03.md`、本文档 | 本轮产生，边界明确 | 可作为独立文档批次从 `origin/main` 提交 |

## 阶段 A 验收

- 已识别当前每类变更的来源或保护状态；
- 已确认公开内容不是新的待发布批次；
- 已把发布台、站点 UI、视觉基线、运行记录和文档分开；
- 未重置、覆盖、暂存或删除任何现有改动；
- 当前仍有两组“所有者未确认但必须保护”的站点改动，它们已被明确隔离，不再属于未知处置状态。

阶段 A 完成。下一步可以在不触碰上述代码批次的前提下，按“恢复演练 → 最终备份 → 内容体检 → R2 只读对账”的顺序刷新安全证据。

## 阶段 C 的提前约束

当前没有新草稿，也没有相对 `origin/main` 的新公开内容。阶段 C 暂时不能执行真实内容发布。

这不是失败，也不应通过修改时间戳、重复提交已有内容或创建空 PR 来伪造闭环。只有下一批真实内容产生并通过体检后，才执行隔离同步、PR、部署和线上核验；届时再开始记录十次真实任务观察。
