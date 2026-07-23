# 用户提供素材台账

`user-provided-assets.jsonl` 是发布台维护的最小授权记录；Astro 不读取它，也不会将其渲染到公开页面。

每一行对应一次以 `sourceKind: "user_provided"` 发布的图片，记录确认日期、公开范围、内容文件、资源文件或 R2 地址与 SHA-256。为保护隐私，台账不得填写真实姓名、联系方式或原始素材链接。

“用户确认”表示发布操作者已确认素材可在 `xgif.cn` 公开发布；它不是第三方作者署名，也不能替代外部来源图片应有的归属与授权信息。

## flomo 导入台账

`flomo-imports.jsonl` 用于避免同一条私人 memo 被重复导入。每行只记录正文 SHA-256、可选的旧版兼容 SHA-256、flomo 记录时间、导入时间、草稿文件路径、状态和可选的内部 `importTags`，不保存标题或正文。来源链接和 flomo 分组标签从正文提取后不参与新版正文哈希。`importTags` 只用于追溯“故事汇、sq、煎蛋”等导入分组，不会成为公开文章标签。该文件不参与 Astro 构建，也不会上传原始 flomo 导出包。

## R2 图片位置台账

`r2-assets.jsonl` 记录由本地发布台写入 Cloudflare R2 的图片位置。每行只包含 Bucket、对象键、公开 URL、SHA-256、MIME、文件大小、记录时间和对应内容文件，不保存图片字节或任何 Cloudflare 凭据。

该台账随 Git 提交并参与本地哈希查重；R2 只保存图片字节，不承担标题、来源、授权或发布状态的事实来源。不要手工覆盖已有对象；内容变化应生成新的 SHA-256 对象键。

## 内容体检报告与同步历史

`content-audit-latest.md` 和 `content-audit-latest.json` 是 `npm run content:audit` 生成的当前内容快照，分为“可直接上线、需要人工确认、建议退回草稿”。报告可以重新生成，不是内容权威源。

批量同步的分支、提交、文件清单和比较链接保存在本机 SQLite 的 `operation_history` 中，并在管理端“同步记录”查看。SQLite 丢失不会影响文章和图片，但同步历史不会从 Markdown 自动恢复；最终发布证据仍以 GitHub PR、合并提交、Cloudflare 部署和线上页面为准。
