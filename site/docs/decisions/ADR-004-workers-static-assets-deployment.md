# ADR-004: 使用 Workers Static Assets 部署公开站点

## Status

Accepted

## Date

2026-07-22

## Context

ADR-003 曾依据 Cloudflare Pages 的 Astro 框架指南选择 Pages。但在实际创建项目时，Cloudflare 的新项目入口已经以 Workers Builds 为默认路径；Cloudflare 更新后的最佳实践也明确建议新建静态站优先使用 Workers Static Assets，Pages 继续工作，但新功能和优化集中在 Workers。

XGIF 的 `site/` 是 Astro 纯静态站点，构建产物位于 `dist/`，不需要服务端渲染、数据库或边缘业务逻辑。首次 Workers Builds 失败不是平台不兼容，而是根目录为仓库根、构建命令为空，且仓库没有 Wrangler 静态资源配置，导致 `wrangler deploy` 找不到可上传目录。

## Decision

- 使用 Cloudflare Workers Static Assets 连接 GitHub `npcink/site-xgif`，以 `main` 为生产分支。
- Worker 项目名为 `site-www-xgif`，Root directory 为 `/site`，Build command 为 `npm run build`，Deploy command 为 `npx wrangler deploy`。
- `site/wrangler.jsonc` 只配置 `assets.directory: "./dist"`；不设置 `main`，因此不部署 Worker 运行时脚本。
- Node.js 版本由 `site/.node-version` 固定，Wrangler 作为 devDependency 锁定并由 `package-lock.json` 管理。
- 当前 Wrangler 的 Miniflare 传递依赖固定了存在已知 libvips 告警的 Sharp 版本，因此使用 npm override 将 Sharp 固定到已验证的 `0.35.3`。上游修复后，只有在移除 override 且 `npm audit`、构建和 dry-run 仍通过时才能删除该覆盖。
- GitHub Actions 除现有站点与视觉测试外，运行 `npm run check:deploy`，验证构建产物可以被 Wrangler 作为静态资源部署。
- `www.xgif.cn` 是唯一正式站点地址；裸域 `xgif.cn` 使用 Cloudflare Redirect Rules 返回 301，并保留原路径和查询字符串。

## Alternatives Considered

### Cloudflare Pages

Pages 对纯静态站仍然有效，静态资源同样免费，Git 分支预览也成熟。但项目尚未建立 Pages 生产部署，而 Cloudflare 已把新项目能力和后续优化重点转向 Workers；现在采用 Pages 会沿用一个不再优先的新建路径。

### 带 Worker 脚本的静态资源项目

Workers 可以在静态资源前运行脚本，并接入 KV、R2、D1 或其他绑定。XGIF 当前所有公开页面都在构建期生成，没有需要按请求执行的逻辑；增加 `main` 会扩大运行时、计费和故障边界，因此不采用。

### 只在控制台使用 `--assets` 参数

Deploy command 可以临时写成 `npx wrangler deploy --assets ./dist`，但配置只存在于控制台，仓库与 CI 无法验证。将静态资源目录写入 `wrangler.jsonc` 能让本地、CI 和 Cloudflare 使用同一部署契约。

## Consequences

- 静态文件由 Workers Static Assets 在 Cloudflare 网络上缓存和提供；匹配静态资源的请求不调用 Worker 脚本。
- 推送到 `main` 后，Workers Builds 在 `site/` 构建并部署；非生产分支可以生成预览版本。
- 站点仍保持 Markdown + Git + Astro 静态构建，不引入线上后台、数据库或运行时密钥。
- `npm run check:deploy` 会构建站点并执行 `wrangler deploy --dry-run`，用于在推送前发现根目录、产物目录或 Wrangler 配置回归。
- 如果未来确实需要请求时逻辑，应另写 ADR 并显式增加 Worker `main`、绑定、费用与故障边界，而不是把逻辑隐式塞进当前静态部署。
