# XGIF Project Handoff

最后更新：2026-07-22

## 1. 项目目标

`xgif.cn` 是一个轻内容站：

- **文章摘要**：保存值得看的文章、来源链接、标签和编辑判断；读者可以快速判断是否值得继续阅读。
- **图片 / 表情包**：展示图片、适用语境、情绪、场景和标签；图片本身是浏览主角。

项目刻意保持简单：内容以 Markdown 与图片文件为真相来源，不使用数据库、线上后台或传统 CMS。网站由静态构建产物部署，内容发布在本机完成。

## 2. 已确定的工作方式

### 内容与站点

- Astro 读取 Content Collections，构建纯静态站点。
- 文章写入 `site/src/content/articles/`，图片元数据写入 `site/src/content/images/`，图片文件写入 `site/public/images/memes/`。
- 所有卡片都有真实详情 URL。JavaScript 可用时用弹层快速浏览；直接访问、刷新或脚本失败时始终回退到独立静态详情页。
- 标签是导航入口，搜索页复用文章与图片卡片，不做数据库检索。

### 本地发布器

`workflow/` 是单机发布助手，启动后提供文章、图片和内容管理三个主要流程：

1. 选择发布文章或图片，填写内容并实时查看预览。
2. 可运行重复检查和质量检查。
3. AI 根据输入生成标题、摘要、标签、阅读时间、编辑笔记或图片分类建议。
4. 人工检查并修改建议后发布；工具生成内容文件，可选自动 `git commit` 与 `git push`。
5. 内容管理可筛选、编辑已有条目、打开已发布页面和重试远程推送。

AI 的职责是辅助整理，不是自动发布决策。输出必须允许手工修改，图片的来源、作者和授权信息仍由人工确认。

### AI 配置

发布器走 OpenAI 兼容的 Chat Completions 接口。密钥及模型配置只放在 `workflow/.env`，不可提交：

```dotenv
XGIF_AI_API_KEY="..."
XGIF_AI_MODEL="..."
XGIF_AI_BASE_URL="https://api.openai.com/v1"
XGIF_AI_TIMEOUT_MS="45000"
```

`XGIF_AI_BASE_URL`、模型名和超时均可按实际服务商调整。AI 超时、鉴权失败或模型不可用时，仍可完全手工发布内容；应先检查 `.env`、服务商模型权限和网络，再重启发布器。

## 3. 目录与职责

| 路径 | 职责 |
| --- | --- |
| `site/src/pages/` | 首页、文章、图片、标签、搜索和静态详情路由。 |
| `site/src/components/` | 卡片、导航、页脚和共享详情弹层。 |
| `site/src/content/` | Markdown 内容真相来源。 |
| `site/public/images/memes/` | 本地表情包图片文件。 |
| `site/public/scripts/` | 搜索筛选和详情弹层的渐进增强脚本。 |
| `site/src/styles/global.css` | 全局视觉规则与响应式布局。 |
| `workflow/` | 仅本机运行的发布器，包含服务端、表单 UI 和配置示例。 |
| `site/docs/design-baseline/` | 图片弹层的视觉基线、回归截图和验收说明。 |
| `old/next-design-baseline/` | 迁移前 Next 版本的只读设计档案，不参与当前构建。 |
| `site/tests/` | Astro 构建、内容质量、详情弹层和视觉结构契约测试。 |
| `workflow/tests/` | 发布台契约测试。 |

## 4. 视觉与交互约定

旧版 Next 的设计档案保留在 `old/next-design-baseline/`，用于核对细节，不应作为运行时源码修改。

- 首页保持编辑性浏览：文章摘要与图片卡片的层级清晰，避免营销式堆叠卡片。
- 图片详情弹层桌面端为固定的左图、右侧纸色信息栏；图片比例不得挤压文字栏或产生横向滚动。
- 图片详情小屏幕改为单列。
- 文章弹层是快速预览，只保留元信息、摘要、标签、来源和独立页入口；独立文章页保留完整正文、编辑备注和相关图片。
- 关闭按钮使用右上角圆形 `x`；详情地址与浏览器前进/后退保持同步。

改动详情布局前，先查看 `docs/design-baseline/README.md` 与其中的两张截图。结构性断言由 `tests/design-baseline-contract.test.mjs` 保护。

## 5. 日常操作

### 运行站点

```bash
cd site
npm install
npm run dev
```

默认地址为 `http://localhost:4321/`。

### 运行发布器

```bash
cd workflow
cp .env.example .env # 首次使用
npm start
```

默认地址为 `http://127.0.0.1:8787/`。修改 `.env` 后必须重启发布器。

### 推荐发布顺序

1. 在发布器填写文章或选择图片。
2. 使用 AI 建议时，逐项人工确认标题、摘要、标签、来源与授权信息。
3. 执行质量检查和重复检查；确认非重复或明确决定保留。
4. 先发布生成本地内容文件，再检查网站预览。
5. 确认内容后执行本地提交；配置远程仓库后再推送。

## 6. Git 与部署

正式仓库为 GitHub `npcink/site-xgif`，默认分支为 `main`。Cloudflare Worker 连接该仓库，使用以下构建配置：

| 配置 | 值 |
| --- | --- |
| Project name | `site-xgif` |
| Production branch | `main` |
| Root directory | `/site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

`site/wrangler.jsonc` 的 `assets.directory` 指向 `./dist`，且没有 `main` Worker 脚本；Cloudflare 只托管 Astro 静态产物，不执行应用运行时代码。Node.js 版本由 `site/.node-version` 固定，Wrangler 与传递依赖由 `site/package-lock.json` 固定，GitHub Actions 会同时验证 Astro、视觉基线与 Wrangler dry-run。

首次部署应先验证 `*.workers.dev` 预览地址，再在 Worker 的 Domains & Routes 中添加 `www.xgif.cn`。`www.xgif.cn` 是 canonical、robots 与 sitemap 使用的唯一正式域名；裸域 `xgif.cn` 应由 Cloudflare Redirect Rules 永久跳转到 `www` 并保留路径与查询字符串。

`workflow/` 与其中的 `.env` 只在本机使用，不能部署或复制到 Cloudflare。部署平台选择的最新上下文和取舍见 [`decisions/ADR-004-workers-static-assets-deployment.md`](decisions/ADR-004-workers-static-assets-deployment.md)。不要在 `.env`、提交信息或文档中写入 API 密钥。

## 7. 验证与当前边界

每次影响主题、内容结构或发布器时，至少运行：

```bash
cd site && npm test
cd site && npm run check:deploy
cd workflow && npm test
git diff --check
```

当前测试覆盖构建、内容/授权元数据、发布器基本契约、详情 URL/History 回退、站点地图和视觉结构。对视觉改动还应手动检查首页、一个文章详情、一个图片详情，以及约 375px 宽度下的单列与无横向滚动状态。

当前刻意不做的事情：

- 不引入 RDS、Docker 数据库、用户账号或线上内容后台。
- 不让 AI 自动抓取、自动发布或绕过人工确认。
- 不把图片来源和授权判断交给模型。
- 不删除 `old/next-design-baseline/`；它是迁移设计核对依据。

## 8. 后续优先级

1. 创建 Cloudflare Worker，验证 `*.workers.dev` 静态资源部署，再绑定 `www.xgif.cn` 和裸域跳转。
2. 以真实内容持续验证发布器的重复检查、图片元数据和 AI 返回质量。
3. 主题有较大改动时补充对应的视觉基线截图和测试，而不是只依赖肉眼回归。
4. 当内容量明显增长后，再评估静态搜索索引或构建期索引；在此之前保持 Markdown + Git 流程。
