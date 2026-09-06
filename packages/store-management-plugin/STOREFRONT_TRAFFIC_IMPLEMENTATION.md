# 简版网站访问统计

状态（2026-09-06）：已从混合工作区提取到独立发布分支。用户已确认新增数据库结构及发布流程；下面区分当前分支验证和原开发记录。生产生效仍以合并、部署和线上验收记录为准。

## 使用与口径

仪表盘新增“网站访问统计”，显示今日三个指标、最近 7／30 天访客趋势及每日明细；每分钟自动刷新，也可手动刷新。原“今日客户与邀请数据”和邀请报表的访客卡片统一使用新版口径。

| 指标 | 计算方法 |
| --- | --- |
| 独立访客（估算） | 当前店铺、北京时间自然日内按账号或匿名浏览器去重；同一账号跨浏览器合并，同一浏览器当天匿名访问与已识别登录关联 |
| 浏览量 | 页面打开、路由切换、刷新各计一次；重渲染和只更新登录身份不增加；失败重试保留事件 ID |
| 独立 IP | 当天不同可信网络地址数量，同一 IP 多次访问只计一个地址 |

例如同一 Wi-Fi 下两台设备各浏览三个页面，通常是 2 个独立访客、6 次浏览、1 个独立 IP。“25 个独立 IP”不能解释为“25 个不同真人”。

数据来自实际收到并写入的访问事件，访客数仍是估算：共享设备、匿名跨设备、屏蔽统计、断网及未识别机器人都可能影响结果。没有采集记录的日期显示 `—`；任一事件缺少可信 IP 时，该日独立 IP 显示 `—`。首次采集当天与当前日可能不足全天。旧汇总不能还原浏览量或独立 IP，不回填猜测值，也不把无记录保证为真实零访问。

在店铺网站“我的 → 访问统计”使用“不统计本浏览器访问”排除自己检查网站的访问，恢复后已打开的前台标签页也能继续采集。后台仅显示操作指引，避免在不同后台域名设置无效 Cookie。只作用于同一浏览器、同一网站域名，不修改历史数据。

## 实现

新增 `storefront_page_view`，保留原 `storefront_daily_visitor` 的结构与历史记录。

| 字段 | 用途 |
| --- | --- |
| id、createdAt、updatedAt | Vendure 实体规范，时间由服务端写入 |
| channelId | 引用 Channel，按当前店铺隔离 |
| businessDate | 北京时间自然日 YYYY-MM-DD |
| eventId | UUID v4，同店铺唯一；跨午夜重试也不能重复插入 |
| visitorKeyHash | 浏览器标识的每日 HMAC 摘要 |
| customerKeyHash（可空） | 服务端会话识别的客户每日 HMAC 摘要 |
| ipHash（可空） | 可信请求上下文中 IP 的每日 HMAC 摘要 |

复用现有签名密钥，摘要按用途、店铺、日期隔离；新表不保存原始 IP、UA、URL、账号信息或登录凭据。身份复用已有持久访客 ID 和签名 Cookie。索引为 `(channelId, eventId)` 唯一及 `(channelId, businessDate, visitorKeyHash)`。

- Shop API：`recordStorefrontPageView(input)` 公开上报，事务写入、事件幂等；不接收客户端指定 IP、客户 ID 或统计日期。
- Admin API：`storefrontTraffic(days)` 接受 1／7／30 天，要求现有 `ReadReferral` 权限。
- 原 `referralTodayMetrics.visitorCount` 改为可空并读取新口径，相关后台组件同步处理。
- 排除本机、后台路径、隐藏页面、浏览器自动化和主动排除的浏览器；服务端再次过滤常见机器人及排除 Cookie。
- 迁移已注册；重复执行不重复建表，代码回滚不删除新表或已采集数据。

## 修改文件

以下路径相对仓库根目录。当前工作区还有其他任务的已有改动；这些共享文件的全部差异不一定都属于访问统计。

- `packages/dev-server/migrations/1788678000000-add-storefront-page-views.ts`
- `packages/dev-server/migrations/add-storefront-page-views.spec.ts`
- `packages/dev-server/migrations/index.ts`
- `packages/store-management-plugin/src/entities/storefront-page-view.entity.ts`
- `packages/store-management-plugin/src/traffic/traffic-metrics.ts`
- `packages/store-management-plugin/src/traffic/traffic-metrics.spec.ts`
- `packages/store-management-plugin/src/traffic/storefront-traffic.service.ts`
- `packages/store-management-plugin/src/traffic/storefront-traffic.service.spec.ts`
- `packages/store-management-plugin/src/traffic/storefront-traffic.resolver.ts`
- `packages/store-management-plugin/src/store-management.plugin.ts`
- `packages/store-management-plugin/src/api-extensions.ts`
- `packages/store-management-plugin/src/referral/referral.resolver.ts`
- `packages/store-management-plugin/src/dashboard/referral.graphql.ts`
- `packages/store-management-plugin/src/dashboard/referral-page.tsx`
- `packages/store-management-plugin/src/dashboard/referral-today-widget.tsx`
- `packages/store-management-plugin/e2e/storefront-traffic.e2e-spec.ts`
- `packages/store-management-plugin/e2e/referral-rebate.e2e-spec.ts`
- `packages/next-admin/src/extensions/installed-extensions.tsx`
- `packages/next-admin/src/graphql/storefront-traffic.graphql.ts`
- `packages/next-admin/src/graphql/dashboard-extensions.graphql.ts`
- `packages/next-admin/src/graphql/marketing.graphql.ts`
- `packages/next-admin/src/pages/Dashboard/StorefrontTrafficPanel.tsx`
- `packages/next-admin/src/pages/Dashboard/StorefrontTrafficPanel.spec.tsx`
- `packages/next-admin/src/pages/Dashboard/DashboardExtensionPanels.tsx`
- `packages/next-admin/src/pages/Marketing/ReferralPanels.tsx`
- `packages/next-admin/e2e/traffic/fixture.tsx`
- `packages/next-admin/e2e/traffic/index.html`
- `packages/storefront/src/api.ts`
- `packages/storefront/src/api.spec.ts`
- `packages/storefront/src/api/referrals.ts`
- `packages/storefront/src/hooks/useStorefrontAppState.ts`
- `packages/storefront/src/hooks/useStorefrontTraffic.ts`
- `packages/storefront/src/storefront-traffic.ts`
- `packages/storefront/src/storefront-traffic.spec.ts`
- `packages/storefront/src/storefront-ui/storefront-traffic-preference.tsx`
- `packages/storefront/src/pages/account-page.tsx`
- `packages/store-management-plugin/STOREFRONT_TRAFFIC_IMPLEMENTATION.md`（本文）

## 当前发布分支验证（2026-09-06）

- 迁移编号改为 `1788678000000`，避免与主干管理员双重验证迁移冲突；102 个活动迁移注册检查通过。
- 本机独立 MySQL 8.4：迁移测试 5 项（含真实 SQLJS/MySQL 创建、重复执行、唯一约束和旧记录保留）；服务测试 11 项（含跨日重试、跨店隔离、登录关联、并发去重）；真实 Shop/Admin API 与 Chromium 桌面/手机报表联调 6 项通过；后台与店铺使用不同测试域名，验证排除设置确实保存于店铺域名。
- 修复 MySQL 重复事件 `INSERT IGNORE` 没有新 ID 时的 TypeORM 自动回填错误；仍通过数据库唯一索引实现幂等，并读取原事件验证归属。
- Storefront 相关 73 项、服务相关 27 项、Next Admin 相关 14 项通过；前台/后台构建、服务构建和类型检查、仓库规定的 lint/架构/发布策略检查通过。
- 既有返利配置并发回归仍有失败，已定位到主干旧实现的事务快照读取；由独立并发修复 PR 解决后再重跑，不能将该失败隐藏为通过。
- 运行凭据均为本机临时测试夹具，不读取生产凭据；未把测试数字当作线上访客。

## 原开发阶段验证（2026-09-05，历史记录）

| 工作目录 | 命令 | 结果 |
| --- | --- | --- |
| `packages/storefront` | `bun run test src/storefront-traffic.spec.ts src/referral-attribution.spec.ts src/api.spec.ts` | 72 项通过 |
| `packages/storefront` | `bun run build` | 类型检查及生产构建通过 |
| `packages/store-management-plugin` | `bun run test src/traffic/traffic-metrics.spec.ts src/traffic/storefront-traffic.service.spec.ts src/referral/referral-visitor.spec.ts src/referral/storefront-visitor-identity.spec.ts src/referral/referral-today-metrics.spec.ts` | 27 项通过 |
| `packages/store-management-plugin` | `bun run check-types`、`bun run build` | 通过 |
| `packages/store-management-plugin` | `PACKAGE=store-management-plugin bunx --no-install vitest --config ../../e2e-common/vitest.config.mts --run e2e/storefront-traffic.e2e-spec.ts e2e/referral-rebate.e2e-spec.ts` | 7 项通过；原套件已有 1 项跳过 |
| `packages/dev-server` | `bunx --no-install vitest run migrations/add-storefront-page-views.spec.ts` | 4 项通过 |
| `packages/next-admin` | `bun run test src/pages/Dashboard/StorefrontTrafficPanel.spec.tsx src/extensions/extension-api.spec.ts src/extensions/installed-extensions.spec.tsx src/extensions/legacy-capabilities.spec.ts` | 14 项通过 |
| `packages/next-admin` | `bun run build` | 类型检查、生产构建及 /dashboard/ 挂载校验通过 |
| 仓库根目录 | `bun run check:migration-registry` | 96 个活动迁移注册通过 |
| 仓库根目录 | 对相关 TypeScript 文件执行 `bunx --no-install eslint --max-warnings=0` | 通过 |
| `packages/next-admin` | 对相关 TypeScript 文件执行 `bunx --no-install oxlint` | 无错误；已有 ReferralPanels fast-refresh 警告 1 项 |
| 仓库根目录 | `git diff --check` | 通过 |

合计 124 项测试通过、1 项既有跳过。Next Admin 构建仍有依赖的 `use client` 提示及大分包提示，本次未改构建配置。

数据库集成使用新建临时 SQLJS 数据库，真实 SQLite 引擎验证重复迁移、唯一约束及旧记录保留。MySQL／PostgreSQL 仅验证迁移定义，未连接这些数据库运行。

浏览器验收使用 Chromium、实际前台采集 Hook／Shop API 客户端、实际后台统计组件和临时 Vendure 服务。测试专用上下文模拟普通浏览器，同时单独验证自动化浏览器不采集；没有放宽生产过滤。已核验：

- 首次打开、切换、刷新、重渲染、请求重试、登录关联及店铺隔离。
- 后台权限、不可信 IP、7／30 天明细、1440px 桌面及 390px 手机显示。
- 排除本浏览器后停止计数，恢复后继续计数；无页面脚本错误。

截图是隔离测试数据，不是线上访客证据：

- [桌面截图](/var/folders/y2/73zzsdhn3d78m_qqhkb2lrq80000gn/T/vendure-traffic-browser-rs9H61/desktop.png)
- [手机截图](/var/folders/y2/73zzsdhn3d78m_qqhkb2lrq80000gn/T/vendure-traffic-browser-rs9H61/mobile.png)

## 上线时需要处理

生产发布必须完成以下步骤：

1. 按现有发布流程备份、运行新增迁移，再发布后端、前台和后台。前台依赖新接口，应让后端先可用。
2. 核实已有 `VENDURE_TRUST_PROXY` 配置与真实代理链一致，入口应覆盖不可信转发头；不直接信任任意客户端上送的 IP。没有可信公网 IP 时显示缺失。
3. 用受控线上访问核对数据库记录与后台数字，再观察完整自然日。

本次未新增依赖、框架版本、环境变量或付费统计服务。当前方案逐页面保存摘要事件，未加入自动删除或复杂监控；流量增长后再按实际存储与查询表现决定是否归档。
