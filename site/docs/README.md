# 站点文档索引

这里按用途区分现行规则、架构决策和历史记录。历史文档中的版本、SHA、线上状态和验收数字只对应记录日期，复用前先核对主线与 `/build.json`。

## 现行

- [当前运行手册](PROJECT_HANDOFF.md)：架构边界、日常命令、部署核验、界面约束和恢复。
- [开发与交付规范](DEVELOPMENT_AND_DELIVERY_STANDARD.md)：Git/worktree、内容发布、测试、审查和完成定义。
- [发布收尾规范](RELEASE_CLOSURE_STANDARD.md)：合并、部署和生产验收的独立证据。

## 决策

- [架构决策](decisions/)：按 ADR 编号查找内容、部署、推荐、草稿和界面边界。
- [ADR-019：AI 管理的静态内容](decisions/ADR-019-ai-managed-static-content.md)：不恢复 CMS，使用按需 CLI。
- [ADR-031：仓库草稿与生产可见性](decisions/ADR-031-repository-drafts-and-production-visibility.md)：公开可读草稿如何排除生产。

## 历史与复盘

- [早期开发与收口](DEVELOPMENT_HISTORY_AND_LESSONS_2026-08-03.md)
- [早期生产闭环复盘](DEVELOPMENT_RETROSPECTIVE_2026-08-03.md)
- [性能阶段收尾](PERFORMANCE_CLOSEOUT_2026-11-17.md)
- [冷加载排查](COLD_LOAD_INVESTIGATION_2026-11-18.md)
- [界面排查复盘](IMAGE_LAYOUT_AUDIT_2026-11-18.md)
- [界面修复复盘](UI_FIXES_RETROSPECTIVE_2026-11-23.md)
- [图库候选复盘](IMAGE_LIBRARY_UI_CLOSEOUT_2026-11-24.md)
- [图库与界面阶段交接](IMAGE_PUBLISHING_AND_UI_HANDOFF_2026-11-25.md)
- [内容 URL 讨论收口](CONTENT_URL_DISCUSSION_CLOSEOUT_2026-11-02.md)

早期开发、阶段收口和迁移背景文档保留供追溯，不作为日常操作入口。
