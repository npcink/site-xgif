# XGIF 本地发布助手

这是一个只在本机运行的发布工具，用来给 Astro 内容站生成文章和图片内容文件。

## 启动

```bash
cd workflow
npm start
```

打开：

```text
http://127.0.0.1:8787
```

## AI 一键填写

文章页的“AI 一键填写”会根据标题、来源链接和正文/摘录生成标题、摘要、标签、阅读时间与编辑笔记。结果只是表单建议，可以继续手工修改。

发布器使用 OpenAI 兼容的 Chat Completions 接口。AI 配置放在 `workflow/.env`；密钥只保留在本机服务端，不会发送到浏览器，也不会被 Git 跟踪。

```bash
XGIF_AI_API_KEY="你的密钥"
XGIF_AI_MODEL="你的模型名称"
# 可选：兼容服务或自建网关地址；默认 https://api.openai.com/v1
XGIF_AI_BASE_URL="https://api.openai.com/v1"
```

首次使用时，可从 `.env.example` 复制一份为 `.env` 后填写。修改 `.env` 后重启 `npm start` 即可生效。未配置时，发布器仍可正常手动发布内容；AI 按钮会提示缺少配置。

## 写入位置

- 文章：`site/src/content/articles/*.md`
- 图片内容：`site/src/content/images/*.md`
- 图片文件：`site/public/images/memes/<year>/*`

## 从内容管理打开页面

“内容管理”只打开本机 Astro 预览地址 `http://localhost:4321`，用于发布前验证。草稿和未公开图片不会提供公开页面入口；操作结果区域只在成功或失败时显示。

## 从 flomo 批量导入

“批量导入”接受 flomo 官方导出的 ZIP，并在本机完成解析、正文指纹查重和草稿生成。原始 ZIP 不会保存到仓库，也不会上传 Cloudflare；页面默认只勾选无重复且字段较完整的内容。短笔记、缺少候选标题或与现有文章高度相似的内容需要人工确认，精确重复不能再次导入。

导入结果始终是 `draft: true` 的原创 Markdown，不会自动提交或推送。若点击“AI 整理选中项”，只有当前勾选的正文会发送给 `.env` 中配置的 AI 服务。每次成功导入会在 `records/flomo-imports.jsonl` 追加正文哈希、时间和目标文件；台账不保存正文。

默认 ZIP 上限为 10 MB、解压后上限为 50 MB，可按需在 `.env` 中调整：

```bash
PUBLISHER_MAX_IMPORT_ZIP_BYTES="10485760"
PUBLISHER_MAX_IMPORT_UNCOMPRESSED_BYTES="52428800"
```

## 发布流程

1. 选择“发布文章”或“发布图片”。
2. 填内容并查看右侧预览。
3. 上传图片后，发布器会读取真实格式、尺寸、文件大小与推荐比例；可在“列表卡片 / 图片详情”之间切换预览。
4. 点击“质量检查”。完全相同的图片文件会被拦截；同标题内容仅提示确认，避免误伤裁剪或改图。
5. 点击“发布”。服务端会再次执行相同校验，不能绕过页面直接重复发布。

默认会自动执行：

```bash
git add <生成的文件>
git commit -m "Add ..."
git push
```

如果只想生成本地文件，可以取消“自动 git commit”和“自动 git push”。

## 图片发布保护

默认仅接受 JPEG、PNG、WebP 与 GIF，单文件不超过 8 MB，单边尺寸介于 160 和 6000 像素之间。文件名或浏览器声明的格式不作为判断依据，发布器会按文件内容校验。需要调整本机限制时，在 `.env` 中设置：

```bash
PUBLISHER_MAX_IMAGE_BYTES="8388608"
PUBLISHER_MIN_IMAGE_DIMENSION="160"
PUBLISHER_MAX_IMAGE_DIMENSION="6000"
```

这些限制仅影响本地发布台；网站构建和线上静态站点不读取这些变量。

## 用户提供素材台账

选择“用户提供素材”发布图片时，请填写“公开发布确认日期”。发布台会在 `workflow/records/user-provided-assets.jsonl` 自动追加最小授权记录，并和图片、内容文件一起提交。该台账不参与 Astro 构建，不会在网站公开页显示；只保留确认日期、资源哈希、文件路径与公开范围，禁止记录真实姓名、联系方式或原始素材链接。详见 [`records/README.md`](records/README.md)。

## 说明

这个工具不需要数据库，也不会启动线上后台。所有内容仍然是 Markdown 和图片文件，后续 Astro 主题只需要读取这些文件。原创文章可以不填写外部来源链接；转载和编辑整理内容仍必须保留真实来源链接。
