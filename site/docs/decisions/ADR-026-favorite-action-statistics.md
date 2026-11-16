# ADR-026：使用 Cloudflare 免费额度汇总收藏操作

状态：接受（2026-11-16）

收藏列表仍由浏览器 localStorage 持有。新增同源 `POST /api/favorites/events`，仅接收 `contentId`、`kind`（article/image）、`action`（add/remove）；成功持久化到浏览器后才上报。导入、导出、批量覆盖、不可用项清理及页面加载不产生事件；收藏页主动移除一项属于 remove。开发、部署预览、草稿预览、DNT 和 GPC 不上报。传输不附带 Cookie 或 Referer。

接口校验正式站点 Origin、方法、JSON 类型、256 字节上限、字段和值，以及本次构建的公开内容白名单。预览域名不写生产统计，草稿、未知 ID 和额外字段均拒绝。接口无公开查询能力，查询依赖现有 Cloudflare 账号权限；不在浏览器放管理密钥。收藏和取消按服务端 UTC 日期、内容 ID 和类型汇总至 D1 `favorite_daily`。不保存访客标识、IP、原始请求、标题、来源页、搜索词或个人收藏夹。平台本身仍可能记录网络安全日志。

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
