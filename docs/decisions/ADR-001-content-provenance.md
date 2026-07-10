# ADR-001: 将来源语义和图片授权作为可发布内容的一部分

## Status

Accepted

## Date

2026-07-10

## Context

xgif.cn 的价值依赖于编辑判断和来源可信度。此前文章只有一个 `sourceUrl` 字段，媒体首页、原文与编辑手记会显示为同一个“去看原文”动作；图片也缺少结构化的作者和授权信息。

## Decision

- 文章保留 `sourceUrl`，并用 `sourceKind` 区分 `original`、`publication` 与 `editorial`；界面按类型使用诚实的动作文案。
- 图片必须记录 `sourceUrl`、`author`、`license`、`licenseUrl`。
- 自动测试禁止两个 `original` 文章复用同一个来源 URL。
- 新内容优先使用本地或 CDN 图片；远程图片必须保留可追溯来源和授权信息。

## Consequences

- 发布新内容时需要补齐元数据，编辑成本略有增加。
- 站点可以更准确地表达内容来源，也为后续图片迁移与版权处理保留依据。
