# ADR-026：使用 Cloudflare 免费额度汇总收藏操作

状态：接受（2026-11-16）

收藏列表仍由浏览器 localStorage 持有。新增同源 `POST /api/favorites/events`，仅接收 `contentId`、`kind`（article/image）、`action`（add/remove）；成功持久化到浏览器后才上报。导入、导出、批量覆盖、不可用项清理及页面加载不产生事件；收藏页主动移除一项属于 remove。开发、部署预览、草稿预览、DNT 和 GPC 不上报。传输不附带 Cookie 或 Referer。

接口校验正式站点 Origin、方法、JSON 类型、256 字节上限、字段和值，以及本次构建的公开内容白名单。预览域名不写生产统计，草稿、未知 ID 和额外字段均拒绝。接口无公开查询能力，查询依赖现有 Cloudflare 账号权限；不在浏览器放管理密钥。收藏和取消按服务端 UTC 日期、内容 ID 和类型汇总至 D1 `favorite_daily`。不在统计数据库或业务日志中保存访客标识、IP、原始请求、标题、来源页、搜索词或个人收藏夹。平台本身仍可能记录网络安全日志。

使用现有 Workers Static Assets，只对统计路径执行 Worker；页面和图片维持静态资源服务。D1 只存每日聚合，无账号系统或内容管理后台。统计请求失败或额度用尽时返回 503；前端不重试、不阻塞或回滚本地收藏。公开页面不显示“点赞总人数”。

统计口径是成功接收的显式操作次数，不是独立用户数、当前收藏人数或历史完整总量。浏览器阻止请求、离线、清空/导入本地存储、隐私设置及伪造请求均会影响它；接口 Origin 校验不能防止伪造 HTTP 客户端。不能将 adds-removes 当作真实收藏总数，也不能直接用作推荐排名、奖励或付费依据。

## 免费服务选择

2026-11-16 核对官方定价：Workers Free 为每日 100,000 次动态请求，静态资源免费且不限请求数；D1 Free 为每日 5,000,000 行读取、100,000 行写入，共 5 GB 存储。额度由账号共享，UTC 00:00 重置，超额操作失败；不自动升级付费方案。

Analytics Engine 同样有免费额度（每日 100,000 点写入、10,000 次查询），但只保留三个月且查询需要额外的 Account Analytics Read 权限。本项目以 D1 保留长期每日汇总，并复用已有 D1 操作权限。KV 的最终一致性及免费写入额度不适合本轮计数；无需引入 KV、Durable Objects 或第三方埋点 SDK。

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/analytics/analytics-engine/pricing/
- https://developers.cloudflare.com/analytics/analytics-engine/limits/

## 查询与恢复

Cloudflare 控制台进入 D1 → `xgif-engagement` → Console，或在 `site/` 执行 `npm run stats:favorites -- 30` 查询最近 30 个 UTC 日。显示新增收藏操作数和取消操作数，数据不含个人列表。查询只读，不能据页面爱心状态反推其他访客的操作。

数据库初始化使用 `wrangler d1 migrations apply xgif-engagement --remote`。本地测试使用 `--local`，不占生产记录。停用时撤回事件上报及 Worker 入口，保留数据库供导出与恢复；不要删除数据库作为前端回滚步骤。

## 接口防滥用（2026-11-16）

Cloudflare Workers 原生 Rate Limiting bindings 无额外付费资源，使用现有 Workers 请求额度。仅保护统计路径：单 IP 每 60 秒约 30 次；同一 IP 对同一内容每 60 秒约 6 次；每个 Cloudflare 节点统计写入每 60 秒约 120 次。超限返回无缓存的 429 和 `Retry-After: 60`。缺少限流 binding、服务异常或统计开关关闭时返回 503，均不写 D1；前端不重试，本地收藏保留。

IP 仅取 Cloudflare 注入的 `CF-Connecting-IP`，不信任 `X-Forwarded-For`，临时用于平台限流计数，不进入统计数据库或业务日志。共用出口的访客可能共享限额，IPv6 地址切换和代理网络可以绕过单 IP 限制；这些计数是近似且按节点分别维护，会有短暂超限，不能当作全球总量或计费硬上限。被 Worker 拒绝的请求仍消耗动态请求额度。

xgif.cn Free 网站套餐的 1 条速率限制规则已用于 R2 图片，保留已有 200 次／10 秒、封禁 10 秒及图片路径的已知机器人豁免，只把 `/api/favorites/events` 加入匹配范围（收藏接口不豁免机器人）。两类请求共享同一个 IP 计数，异常收藏流量可能短暂影响同出口的图片请求。另一条免费自定义 WAF 规则在 Worker 前拦截该路径上非 POST、Origin 不符或缺失、非 JSON Content-Type 及无用途查询串的请求；其他路径不受新增规则影响。规则配置和恢复记录见 `favorite-abuse-protection.json`。

应急停写：将 `wrangler.jsonc` 中 `vars.FAVORITE_METRICS_ENABLED` 改为 `"false"` 并部署（后续普通部署也必须保留 false，避免恢复开关）。这仅停止 D1 写入，不能消除 Worker 调用；遇到持续分布式攻击时，在 WAF 将统计路径临时全部阻止，可在 Worker 前停流，不影响页面和本地收藏。恢复时删除临时阻断规则，确认限流 binding 完整后恢复开关；不删除数据库、不回退到无限流接口。

- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/waf/rate-limiting-rules/
