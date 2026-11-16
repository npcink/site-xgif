# XGIF 内容发布交接

日期：2026-11-16

状态：本阶段收尾，工具与规范已合入主线；后续按真实新增内容维护。

本轮已核对：线上版本、源码合并状态、私有备份、评测项目、分支与 worktree。推荐质量仍有已记录的语义限制，不能当作已解决。

## 当前线上状态

- 线上版本：`34ad926914dea8cea4058d425d66374b8de51c57`
- 站点：<https://www.xgif.cn>
- 图片库：<https://www.xgif.cn/images>
- 动图筛选：<https://www.xgif.cn/images?media=animated>
- 收藏统计：Cloudflare D1 `xgif-engagement`
- Cloudflare 套餐：Free；本阶段没有升级付费服务。

收藏统计和限流属于辅助能力。统计记录的是显式操作次数，不代表独立访客数或当前收藏人数；统计失败、超限或关闭时，本地收藏仍然有效。

## 新内容的最短流程

1. 新文章或图片先写入 `draft: true`，保留原文、来源和原图，不擅自扩写或改写。
2. 图片先执行 `npm run image:check -- /绝对路径/图片`；需要上传时执行 `npm run image:upload -- /绝对路径/图片`。相似系列必须人工确认后才合并。
3. 新图片或图集成员完成上传后执行 `npm run image:media` 预览动画帧属性，再按计划执行 `npm run image:media -- --apply`。
4. 在 `site` 运行前端预览，核对标题、摘要、标签位置、原文和图片顺序。
5. 在 `workflow` 运行 `npm run content:audit`；在 `site` 运行 `npm test`。
6. 仅将已确认内容改为公开，再通过 `npm run content:sync -- --apply <文件>` 创建隔离内容 PR。不要使用 `git add .`。
7. PR 合并并部署后，核对 `/build.json`、公开 URL、图片资源和页面正文。
8. 批次完成后执行 `npm run data:backup`，保留可恢复快照。

文章摘要写入 `summary`，标签由页面放在正文之后；正文只允许排版调整，必须通过原文完整性校验。图集封面必须等于 `image`，成员顺序不能因 AI 建议改变。

## 暂不处理的事项

- 不继续扩展收藏统计或复杂安全系统，除非出现实际滥用、误拦截或额度异常。
- 不为了“全部重做”批量重生成标题、摘要、分类和标签；等有一小批真实样本并确定模型后再评估。
- 不因标题变化自动重算相关推荐；推荐应以原文和已核验图片事实为基础，只有内容或推荐版本实际变化时才重建。
- 不自动合并相似图片系列；任何合并仍需要人工确认。

遇到单篇异常时，先保留该项为草稿并记录失败原因，继续处理其他已通过检查的内容；不要为追求批次全绿而覆盖原文或删除原图。

详细规则入口：[`workflow/README.md`](../README.md)、[`LOCAL_PUBLISHER_ENGINEERING_STANDARD.md`](LOCAL_PUBLISHER_ENGINEERING_STANDARD.md)、[`ADR-026`](../../site/docs/decisions/ADR-026-favorite-action-statistics.md)。
