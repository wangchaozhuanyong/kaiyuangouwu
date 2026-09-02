# Vendure 新管理后台功能等价审计报告

更新日期：2026-09-02

项目：`packages/next-admin`

分支：`fix/next-admin-two-factor-codes-20260901`

## 0. 2026-09-01 纠偏与补齐结论

2026-08-31 的真实浏览器审计只证明当时的新页面可达、可加载，没有逐项对账旧 Dashboard 中的 route、action、pageBlock、widget 和 alert。因此本报告原先的“没有明显遗漏”结论作废，后文中的浏览器数据仅保留为 2026-08-31 历史基线，不能当作本轮新增功能的 UAT 证据。

本轮已完成代码级补齐：

- 商品供应链：供货商页面、高级 SKU 运营工作区、采购成本/条码/单位/包装换算/保质期/库存上下限/供应商关联、批次效期、自动拆包、完整性检查及 XLSX/CSV 导出。
- 支付与订单：币种汇率、USDT 收款地址申请/审核/流水/手工退款记录，以及手工支付、支付结算/取消/状态转换、退款结算、优惠券分摊和多商家子订单。
- Vendure 原生等价：客户创建/删除/批量分组、通用 Promotion 条件与动作编辑、SKU 多币种价格、商品批量 Channel、集合规则与预览、配送试算、API Key 名称/角色/扩展字段、素材与库存点批量操作。
- 动态扩展字段：补到 Customer、ProductVariant、Asset、Collection、PaymentMethod、ShippingMethod、Seller 和 ApiKey；可翻译实体同时保存 locale 扩展字段。
- 插件表面：商业服务页文案、今日推荐数据、翻译待办提醒已进入新后台。
- 兼容和防遗漏：`legacyPaths` 由扩展路由层统一生成，28 个旧本地插件路由都映射到精确新地址；静态能力合同同时检查 action、pageBlock、widget 和 alert，禁止用无关工作台重定向充数。

本轮还完成了隔离运行时 UAT：

- 使用临时 SQLite 数据库 `/tmp/vendure-next-admin-uat-20260901.MHe4xG/uat.sqlite` 启动生产构建挂载和真实 Admin API；没有连接生产数据库。
- 分别使用合成超级管理员与受限管理员验证登录、菜单/路由权限、后端拒绝和跨 Channel 隔离。
- 2FA 工具完成新增、加密落库、管理员归属隔离、旧 URL 跳转和动态码显示；它仍是“第三方 TOTP 密钥保存工具”，不是登录 2FA。
- 商品侧完成高级 SKU、包装与自动拆包、多币种价格、供货商、批次效期、标准导出、集合规则预览和配送试算；批次 `UAT-LOT-20260901` 的生产/到期时间已按 UTC ISO 保存并回读。
- 系统与插件侧完成 API Key 名称/角色编辑、商业服务页文案、推荐数据组件、翻译告警、币种汇率、USDT 页面及代表性旧链接跳转。
- 订单侧完成状态可用性校验：`Draft`、`PaymentSettled` 和未结金额为零时不再显示“手工添加支付”；`ArrangingPayment` 且有未结金额时才显示。
- 资金链路在合成订单上完成真实 mutation：手工支付成功落库；数字订单自动进入 `PaymentSettled`/`Delivered`；退款从 `Pending` 经管理员密码和真实退款交易号结算到 `Settled`。
- UAT 发现并修复退款兼容参数缺口：`RefundOrderInput` 现在同时发送 `amount` 及旧非空列的 `lines: []`、`shipping: 0`、`adjustment: 0`，避免数字订单退款触发数据库非空约束。
- 浏览器验收未发现持续加载或页面级错误；前序全路由检查的 console error/warning 为 0。
- 在独立 MySQL 8.0.46 证据库 `vendure_next_admin_uat_20260901_2312` 完成 37 个待执行迁移、单步回滚、重新应用和无待执行迁移幂等复跑；迁移数从 58 到 95，回滚为 94，再次恢复到 95。
- 在独立 MySQL 业务库 `vendure_next_admin_fixture_uat_20260901_2331` 完成实物订单手工支付、全额退款和并发库存竞争。两个订单争抢最后一件可用库存时只有一个进入 `PaymentSettled`，另一个返回库存不足且没有残留 Payment，未超卖。
- MySQL UAT 发现并修复两项资金一致性问题：纯实物订单不再被人工数字交付邮箱校验误拦截；付款结算时订单无法进入 `PaymentSettled` 会抛错并回滚 Payment，避免“付款已结算、订单仍待付款”的部分成功。
- API server 与 worker 同时运行后，15 个定时任务和 17 个任务队列在系统运维页可见；一分钟级 USDT、优惠券、返利和生图任务均执行成功，`apply-collection-filters`、`send-email`、`update-search-index` 记录全部为 `COMPLETED`，无 pending/running/retrying。
- 破坏性矩阵在隔离 MySQL 库完成客户创建/删除、草稿创建/删除、API Key 创建/改名/删除、付款取消、订单取消、返利余额正负调整、提款 `PENDING → APPROVED → PAID`；超额提款和删除非草稿订单分别被后端拒绝，API Key 明文未写入证据输出。
- 本机会话响应头已确认 `HttpOnly; SameSite=Lax` 且 Cookie 值脱敏；生产配置代码在 `NODE_ENV=production` 强制 `Secure`、HTTPS CORS 白名单和强 Cookie/2FA 密钥。Apollo 层关闭内置 CSRF 是因为 CORS 由 Express 统一处理；生产仍必须使用精确 Origin 白名单，不能启用通配来源。

本轮当前验证：

```text
next-admin test                              通过，24 files / 99 tests
next-admin TypeScript                        通过
next-admin lint                              通过，0 warning
next-admin production build                  通过
新增/修改 GraphQL operation + 插件 SDL    通过，56 / 56
敏感管理操作后端测试                      通过，27 / 27
catalog/commerce/store 插件 typecheck/test/build 通过
store-management-plugin test                  通过，48 files / 279 tests
core 支付事务回滚回归测试与 build             通过
dev-server typecheck                           通过
dev-server migration tests                     通过，58 files / 219 passed / 1 skipped
dev-server workflow tests                      通过，140 / 140
git diff --check                              通过
```

MySQL UAT、worker 和隔离破坏性流程已完成。2026-09-02 又对真实生产环境做了只读复核：当前生产数据库明确为 MySQL 8.0，不需要 PostgreSQL UAT；线上版本 `2cbe9f57ab14d798b8c2bdb79ed58554cb74b103` 的发布记录中，migration/server/worker 三套 `audit:production-env` 分别以 `35/0/0`、`36/0/0`、`34/0/0` 通过，并留下异地 MySQL 备份、恢复演练/健康检查 timer、不可变运行时和回滚指针证据。公网 HTTPS、安全头、精确 CORS 白名单和 9 项发布链路验证均通过；独立生产监控和脱敏支付配置审计也通过。

本地不注入生产环境变量时，`audit:production-env` 仍会按设计返回 `BLOCKED`（28 blocker / 5 manual）；这只证明门禁会拒绝空配置，不能再用于代表线上生产状态。当前 worktree 的功能补齐差异仍未 commit、push、创建 PR 或部署，线上通过的是既有生产版本，不包含本地未提交差异。

本次复核另修复了一项持续监控缺口：外部生产监控现在会检查健康检查与 MySQL 恢复演练 timer 是否启用/运行、对应 service 最近结果是否成功且未过期；本机 systemd 健康脚本也会拒绝缺失或超过 9 天的恢复演练证据。相关 shell 语法、部署安全和商城 readiness 共 28 项测试已通过。该监控增强同样只存在于当前未提交 worktree，需随本批代码发布后才会在线上生效。

## 1. 2026-08-31 历史浏览器基线

当前新管理后台的页面合并方向合理，适合中国电商运营人员的高频操作习惯。设计与页面架构可以结束 Gemini 阶段并进入工程接管，不需要恢复成原先大量彼此割裂的小页面。

- 设计完整性：通过。
- 23 个正式登录态路由：全部可达并使用真实接口数据加载。
- 商品与订单真实详情页：通过。
- 1440px 桌面端与 390px 移动端：无页面级横向溢出。
- 浏览器运行时：0 条 console error/warning。
- 自动检查：lint、build、19 个前端测试、16 个敏感操作后端测试、2 个会话响应头测试全部通过。
- 生产发布：有条件通过；目标数据库迁移、普通管理员权限矩阵和会改变业务数据的 UAT 仍需上线前单独完成。

## 2. 页面是否遗漏或多余

### 2.1 应保留的 8 个一级入口

1. 工作台
2. 商品
3. 订单与售后
4. 客户
5. 营销
6. 店铺
7. 插件与服务
8. 系统与权限

从最初 10 大分类收敛为 8 类是合理简化。客户管理虽不在 Gemini 最初清单中，但它是订单、分组、营销和售后的共同基础，不属于多余页面。

### 2.2 合并合理的页面

| 合并后的入口        | 覆盖能力                                 | 结论                         |
| ------------------- | ---------------------------------------- | ---------------------------- |
| 分类与属性          | 分类、专辑/集合、规格模板、筛选属性      | 同属商品信息模型，合并合理   |
| 库存与仓库          | SKU 跨商品库存、库存点、出入库           | 高频任务相关，合并合理       |
| 订单列表 + 订单详情 | 订单筛选、待履约、发货、物流、退款、备注 | 列表筛选和单据详情分工清楚   |
| 优惠与促销          | 优惠券、促销、秒杀、ROI                  | 同一营销任务下用标签区分合理 |
| 分销与返利          | 规则、推广员、佣金、钱包、提现、海报     | 同一资金链路集中管理合理     |
| 商城装修            | 首页区块、楼层、排序                     | 不需要再拆独立楼层页面       |
| 内容与页面          | 公告、法律内容、推广落地页               | 内容运营集中处理合理         |
| 店铺综合设置        | 多店铺、主体、支付、配送、税率、域名     | 同一店铺配置对象，合并合理   |
| 员工与权限          | 员工、角色、权限矩阵                     | 合并合理                     |
| 系统运维            | 健康、队列、定时任务、配置、API 密钥     | 只对超管开放，合并合理       |

旧路径仍通过重定向兼容，例如 `/catalog/collections`、`/sales/shipments`、`/marketing/flash-sales` 和 `/settings/job-queue`，不会因页面合并导致旧链接失效。

### 2.3 2FA 与监控能力边界

- 管理后台 2FA 动态码工具：现已明确为管理员保存第三方 TOTP 密钥的工具，不是买家或管理员账号登录 2FA；后端已实现按管理员隔离、AES-256-GCM 加密存储和删除流程，并在 `/plugins/two-factor-codes` 恢复入口。
- 管理员 TOTP 与恢复码：当前后端没有完整绑定、登录二次验证、恢复和哈希存储能力，不应只做前端假页面。
- CPU、内存、数据库连接池趋势：当前没有真实监控数据源，不应展示模拟图表。

管理员账号登录 2FA 与系统监控仍是后端能力缺口；第三方 TOTP 动态码工具已经独立交付，不能再与登录 2FA 混为一谈。

## 3. 真实浏览器覆盖

| 业务区       | 已审计路由                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 工作台与账号 | `/dashboard`、`/profile`                                                                                                                               |
| 商品         | `/catalog/list`、`/catalog/products/new`、`/catalog/products/21`、`/catalog/categories`、`/catalog/inventory`、`/catalog/card-pool`、`/catalog/assets` |
| 订单与售后   | `/sales/orders`、`/sales/orders/32`、`/sales/after-sales`、`/sales/reviews`                                                                            |
| 客户         | `/customers/list`                                                                                                                                      |
| 营销         | `/marketing/promotions`、`/marketing/referrals`                                                                                                        |
| 店铺         | `/storefront/decoration`、`/storefront/content`                                                                                                        |
| 插件与服务   | `/plugins/client-plugins`、`/plugins/ai-settings`、`/plugins/ai-access`、`/plugins/translations`                                                       |
| 系统与权限   | `/settings/store-profile`、`/settings/team`、`/settings/system-ops`                                                                                    |

审计结果：23 个正式路由和 2 个真实详情页均加载成功，无 `role=alert` 错误、持续加载或页面级横向溢出。商品详情显示真实 SPU、图片、分类和 SKU；订单详情显示真实商品行、履约、支付退款、备注、时间线和买家信息。

关键截图位于 `audit-screenshots/`：

- `dashboard-desktop.png` / `dashboard-mobile.png`
- `catalog-list-desktop.png` / `catalog-list-mobile.png`
- `product-detail-desktop.png` / `product-new-mobile.png`
- `sales-orders-desktop.png` / `sales-orders-mobile-fixed.png`
- `order-detail-desktop.png` / `order-detail-mobile-layout-fixed.png`
- `store-settings-desktop.png` / `store-profile-mobile-fixed.png`
- `system-ops-desktop.png` / `system-ops-mobile-fixed.png`

## 4. 本轮发现并修复的问题

### P0 阻断问题

- 修复分销海报素材选择器的远程搜索、旧素材保留和 TypeScript 构建错误。
- 修复分页 Hooks 的依赖和重复请求风险。
- 恢复 lint、test、build 全绿基线。

### P1 数据完整性

- AI 任务、API 密钥、客户分组、库存点、渠道、分类等不再静默停在固定 `take` 上限。
- 选择器改为远程搜索、分批完整读取或明确“最近 N 条”的范围。
- 当前 schema 下 169 个 GraphQL operation 校验为 0 错误。

### P2 业务与安全

- 商品/SKU 启停、分销余额调整、提现审批统一要求当前管理员密码并由后端验证。
- 删除操作校验 mutation 的真实 `DELETED` 结果，不再把失败误报为成功。
- 商品分阶段保存支持部分失败的真实反馈。
- 商品永久删除、订单退款和订单取消弹窗均有明确后果说明、密码字段、焦点锁定和安全退出。

### P3 设计与可访问性

- 命令面板、菜单、搜索框和图标按钮补齐名称、状态与键盘语义。
- 嵌套弹窗仅最上层响应 Escape，关闭后恢复焦点。
- 商品编辑补充未保存离开提醒。
- 移动端侧栏展开时隔离背后的主工作区，焦点自动进入侧栏，关闭后返回菜单按钮。
- 横向标签保留滑动能力但隐藏系统滚动条。
- 订单详情网格补充 `min-width: 0`，修复移动端内部撑宽和底部横向滚动条。

## 5. 已验证的核心交互

- ⌘K 打开、输入搜索、上下键选择、Enter 跳转、Esc 关闭。
- 顶部标签“更多”菜单打开与 Esc 关闭。
- 管理员菜单打开、菜单项可访问、Esc 关闭。
- 移动侧栏打开后的焦点进入、背景隔离、Esc 关闭和焦点返回。
- 商品永久删除确认、订单退款、订单取消的密码与危险操作说明。
- 复杂商品编辑触发未保存离开提示。

2026-08-31 历史审计没有提交删除、退款、取消、改密、提现或余额调整等业务 mutation。2026-09-01 本轮只在隔离 SQLite/MySQL UAT 中提交合成 2FA、库存批次、API Key、经营模式、付款/退款、订单取消、客户/草稿删除、返利余额和提款数据，未触碰生产数据。

## 6. 仍需上线前完成

| 优先级 | 项目                                                   | 原因                                                                                     |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| P0     | 将当前未提交差异走代码审查、CI 和不可变制品发布链      | 现网基础设施门禁已 READY，但线上版本 `2cbe9f57...` 不包含当前 worktree 的未提交功能补齐 |
| P0     | 若要开放 USDT 收款，完成商户钱包申请和超管审核         | 脱敏生产审计显示 2 个 Channel 均未配置钱包，当前 `active=0`，不得自动代商户启用           |
| P1     | 使用生产只读管理员凭据复核登录 Cookie 与商城 readiness | 未使用生产账号登录；Cookie 实际响应及税率、配送、邮件、真实支付可售条件仍需业务配置证据 |
| P1     | 持续保留定时备份、恢复演练和告警送达证据               | 本次发布链已校验 timer 与最近成功结果；后续仍需按计划持续监控，不能把一次通过当永久通过  |
| P1     | 为 Gemini 生图配置第二个健康密钥                       | 当前监控为健康，但只有一个 Gemini Key，没有故障切换                                       |
| P2     | 渐进拆分 1000～2200 行的大型模块                       | 不阻塞当前功能，但会增加后续维护和测试成本                                               |
| P2     | 审核根工作区 `pacote@21.0.1` high 漏洞                 | 应单独评估依赖与锁文件影响，不与页面修复混改                                             |

## 7. 最终门禁结果

```text
bun run lint                                      通过，0 error / 0 warning
bun run test                                      通过，24 files / 99 tests
bun run build                                     通过
新增/修改 GraphQL operation + 插件 SDL            通过，56 / 56
敏感管理操作后端测试                              通过，27 / 27
store-management-plugin typecheck                 通过
store-management-plugin test                      通过，48 files / 279 tests
core 支付事务回滚测试与 build                     通过
dev-server typecheck / migrations / workflow      通过，219 + 140 tests
登录态浏览器 console                              0 error / 0 warning
```

Vite 构建仅提示第三方依赖中的 `use client` 指令被忽略，不影响构建产物。

## 8. 当前交付判断

- 可以结束页面设计阶段并由工程侧接管：是。
- 原“没有明显遗漏”结论：已作废。当前静态能力合同中的旧插件路由和本轮列出的原生能力均已有新页面或嵌入点；已验收表面获得隔离 SQLite UAT 的运行时证据，未验收项仍不能仅凭重定向或静态存在判定等价。
- 是否存在多余页面：没有；客户管理和 AI 服务商接入分别承担核心运营与平台级密钥隔离职责。
- 真实生产基础设施门禁是否通过：是。现网 MySQL、HTTPS/CORS、备份、恢复演练、监控、不可变制品和 API/worker readiness 已有 2026-09-02 只读证据。
- 当前 worktree 是否可以直接部署生产：否。功能差异尚未提交和经过对应提交的完整 CI/制品构建；必须走既有发布链，不能把现网基础设施 READY 误当作这批代码已经上线。

说明：本轮修改位于独立 Git worktree，仅修改功能补齐相关文件；未 commit、push、创建 PR 或部署。2026-09-02 只触发了既有的只读生产健康/支付配置监控，没有修改生产配置或业务数据。
