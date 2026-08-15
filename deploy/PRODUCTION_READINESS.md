# 生产上线准备清单

本文用于当前 Vendure 商城的中国站与马来西亚站上线准备。前台只提供简体中文和英文，不规划马来语。

## 当前结论

前台视觉、双语界面、响应式布局和基础错误兜底已经可以进入真实业务联调阶段，但当前配置还不能直接用于真实交易。

上线前必须解决以下阻塞项：

1. 确认两个站点的正式域名，并分别绑定、验证对应的 Vendure Channel。
2. 确认马来西亚站价格是否含税，以及应使用的税区和税率。当前马来西亚 Channel 仍引用中国税区。
3. 删除测试配送方式，为两个市场配置真实配送范围、费用、免邮门槛和无法配送规则。
4. 选择真实支付渠道并完成服务端回调、退款、失败重试和对账测试。当前仅有 `dummy-payment-handler`。
5. 选择支持 SMTP 的邮件服务商，并配置正式发件地址和连接参数。
6. 确认生产数据库、持久化商品图片方案、备份恢复方案和监控方案。

以上事项完成前，只能视为本地或预览环境，不应开放真实下单。

## 本地预览验收状态

- 游客可以完成联系信息、收货地址、配送方式、提交订单、选择测试支付和查看订单成功页。
- 待支付购物车支持继续支付，也支持返回修改后重新结算。
- 测试支付失败后可重试，支付请求期间会锁定按钮并阻止重复提交。
- 简体中文与英文、桌面端与移动端均已完成本地流程验证。
- `测试支付` 仅在 Vite 开发模式显示，生产构建不会开放该测试付款入口。

上述结果只证明本地结账交互与订单状态衔接可用，不代表真实支付渠道、税务、配送、邮件或退款已经验收。

## 建议执行顺序

### P0：先完成交易规则

- 中国站：确认商品价是否含税、配送区域、运费规则、支付方式、退款规则。
- 马来西亚站：确认商品价是否含税、税区与税率、配送区域、运费规则、支付方式、退款规则。
- 明确数字商品与实物商品各自的交付方式。
- 删除或禁用 `crud-shipping`、`测试支付` 等测试配置。
- 使用真实地址分别完成中国和马来西亚的下单计算测试。

验收标准：购物车、地址、配送、税费、支付、订单、退款的金额在前台、后台和支付渠道中一致。

### P0：接入正式域名和邮件

- 为中国站和马来西亚站提供各自的正式域名。
- 在 Store Domain 中分别创建域名记录，并完成 DNS 验证。
- 每个 Channel 只能有一个有效主域名，账户验证和密码重置邮件将使用该主域名。
- 生产环境使用 `STORE_DOMAIN_ROUTING_MODE=require-domain`。
- 生产环境清空 `STORE_DOMAIN_BYPASS_HOSTS`，除非入口层已明确禁止公网访问旁路主机。
- `VITE_CLIENT_CHANNEL_SWITCHING=false`，由已验证域名决定 Channel，不在浏览器中暴露固定 Channel Token。
- 选择支持 SMTP 的邮件服务商，配置发件域名、SPF、DKIM 和 DMARC。
- 验证注册、邮箱验证、忘记密码、修改邮箱、订单确认五类邮件。

验收标准：两个域名访问到正确市场；邮件中的链接回到对应站点，不串 Channel、不使用本地地址。

### P0：建立生产基础设施

- 使用独立的生产 MySQL/MariaDB 或 PostgreSQL，不使用仓库内 SQLite 文件。
- 保持 `DB_SYNCHRONIZE=false`，上线前先在备份副本上验证迁移。
- 将商品资源目录放到持久磁盘，或在明确选型后接入对象存储。
- API Server 和 Worker 使用同一数据库及同一资源存储。
- 单独运行 API Server 与 Worker；Server 设置 `RUN_JOB_QUEUE=0`，避免与 Worker 重复消费队列。
- 迁移只由一个受控进程执行一次，其余实例设置 `RUN_MIGRATIONS=false`。
- 建立每日自动备份，并至少完成一次恢复演练。

验收标准：重启或替换应用进程后，订单、客户、商品图片和任务队列数据不丢失；备份可以恢复到隔离环境。

### P1：监控与安全加固

- 为 `/health` 配置外部存活监控，并增加从公网执行的首页、Shop API 和静态资源检查。
- 记录 API Server、Worker、Nginx、数据库和邮件发送错误。
- 监控端点和服务名已由标准 OTEL 环境变量控制；确定监控平台后填写真实值并启用插桩启动方式。
- 为错误率、支付失败、邮件失败、队列积压、磁盘空间和证书到期设置告警。
- `VENDURE_CORS_ORIGINS` 只保留正式前台和管理端来源。
- 仅在可信反向代理前启用 `VENDURE_TRUST_PROXY` 和 `STORE_DOMAIN_TRUST_PROXY`。
- 关闭生产 GraphiQL，公共域名继续禁止 `/admin-api`，管理后台保留独立域名。
- 评估并补齐 HSTS、Content Security Policy 和 Permissions Policy；先在预览环境验证第三方支付与资源域名，避免误拦截。
- 密钥只进入部署平台的 Secret 管理，不写入仓库或构建产物。

验收标准：关键异常能够在 5 分钟内触发告警，公共域名无法访问管理 API，生产响应不暴露开发工具。

### P1：真实内容和发布验收

- 按 `packages/storefront/PRODUCT_CONTENT_GUIDE.md` 补齐真实商品、双语文案、SKU、库存、价格和图片。
- 上线数据中不得存在 `DEMO-` SKU 或 `storefront-demo` 资源标签。
- 替换首页及分类页临时内容，并逐项确认链接目标。
- 分别使用简体中文和英文完成桌面端与移动端全流程验收。
- 覆盖加载、空状态、接口错误、图片失败、无库存、支付失败和重复提交。
- 核对隐私政策、服务条款、退款政策、配送政策及经营主体信息。

验收标准：两个市场均使用真实数据完成测试订单、支付、履约、退款和邮件通知，且金额与语言正确。

### 自动生产预检

当预发布环境已导入待上线数据后，运行只读 Admin API 预检：

```bash
VENDURE_API_ORIGIN=https://<preview-api-domain> \
SUPERADMIN_USERNAME=<preview-admin> \
SUPERADMIN_PASSWORD=<preview-password> \
READINESS_TAX_POLICY_JSON='{"cn-mainland":{"pricesIncludeTax":false},"my-malaysia":{"pricesIncludeTax":true}}' \
bun run --cwd packages/dev-server audit:storefront-readiness
```

`READINESS_TAX_POLICY_JSON` 必须来自已批准的业务税价规则，上述布尔值仅为命令格式示例。未提供时预检会保留人工阻塞，不会猜测价格是否含税。

预检会拒绝未验证域名、错误税区/配送区、测试支付或配送、`DEMO-` 商品、`storefront-demo` 资源、演示装修内容、缺失中英文、缺图/缺价以及搜索索引积压。命令为只读数据检查，除了管理员登录会话外不会写入业务数据；失败时返回非零退出码，可作为发布流水线阻断条件。

部署变量需要在 API Server、Worker 和迁移进程各自的运行环境中分别预检：

```bash
READINESS_PROCESS_ROLE=server \
READINESS_OPERATIONS_JSON='{"persistentAssetStorage":true,"databaseBackups":true,"restoreDrill":true,"externalHealthChecks":true,"alerting":true,"secretManager":true}' \
bun run --cwd packages/dev-server audit:production-env
```

将 `READINESS_PROCESS_ROLE` 依次改为 `server`、`worker`、`migration`，并使用对应部署环境执行。迁移进程要求 `RUN_MIGRATIONS=true`，API Server 和 Worker 要求为 `false`；非 Worker 进程还要求 `RUN_JOB_QUEUE=0`。

`READINESS_OPERATIONS_JSON` 是运维证据确认，不是默认配置。只有持久资源、自动备份、恢复演练、外部健康检查、告警和 Secret 管理已经真实完成时才可填 `true`；缺少字段会保留人工阻塞，显式填写 `false` 会成为发布阻塞。预检不会输出管理员、数据库、SMTP 或 Cookie 密钥值。

## 生产环境变量

以下变量均已在当前代码或 `.env.example` 中存在。实际值必须由部署环境注入，不提交到 Git。

### Vendure Server 与 Worker

| 变量                                    | 生产要求                                 |
| --------------------------------------- | ---------------------------------------- |
| `NODE_ENV`                              | `production`                             |
| `VENDURE_HOSTNAME`                      | 只监听预期网络接口                       |
| `PORT`                                  | 与反向代理 upstream 一致                 |
| `VENDURE_TRUST_PROXY`                   | 仅在可信代理前设置正确跳数或地址         |
| `VENDURE_SERVE_GRAPHIQL`                | `false`                                  |
| `VENDURE_SERVE_STATIC_DASHBOARD`        | 按部署拓扑设置                           |
| `VENDURE_DASHBOARD_URL`                 | 正式管理后台 HTTPS 地址                  |
| `VENDURE_STOREFRONT_URL`                | 没有有效主域名时的安全兜底地址           |
| `VENDURE_CORS_ORIGINS`                  | 逗号分隔的正式来源白名单                 |
| `SUPERADMIN_USERNAME`                   | 非默认管理员账号                         |
| `SUPERADMIN_PASSWORD`                   | 强随机密码，由 Secret 管理               |
| `COOKIE_SECRET`                         | 长随机密钥，由 Secret 管理               |
| `DB`                                    | `mysql`、`mariadb` 或 `postgres`         |
| `DB_HOST`、`DB_PORT`                    | 生产数据库地址与端口                     |
| `DB_USERNAME`、`DB_PASSWORD`、`DB_NAME` | 最小权限数据库账号和库名                 |
| `DB_SCHEMA`                             | PostgreSQL 使用的 Schema，未使用时可省略 |
| `DB_SYNCHRONIZE`                        | `false`                                  |
| `RUN_MIGRATIONS`                        | 只在受控迁移进程中为 `true`              |
| `RUN_JOB_QUEUE`                         | 独立 Worker 模式下 Server 设为 `0`       |
| `VENDURE_ASSET_UPLOAD_DIR`              | Server 与 Worker 可访问的绝对持久目录    |
| `VENDURE_IMPORT_ASSETS_DIR`             | 受控且持久的绝对导入目录                 |
| `VENDURE_EMAIL_FROM`                    | 已验证发件域名下的发件人和地址           |
| `SMTP_HOST`、`SMTP_PORT`                | SMTP 服务地址与端口                      |
| `SMTP_SECURE`                           | 服务商要求的 TLS 模式                    |
| `SMTP_USER`、`SMTP_PASSWORD`            | 需要 SMTP 认证时必须同时配置             |
| `IS_INSTRUMENTED`                       | 启用监控时设置为 `true`                  |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`    | 生产 Trace 接收端点                      |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`      | 生产日志接收端点                         |
| `OTEL_SERVICE_NAME`                     | 区分 API Server 与 Worker 的服务名       |
| `STORE_DOMAIN_CNAME_TARGET`             | 商家域名实际指向的公共 DNS 目标          |
| `STORE_DOMAIN_ROUTING_MODE`             | `require-domain`                         |
| `STORE_DOMAIN_TRUST_PROXY`              | 仅在入口层覆盖转发 Host 时启用           |
| `STORE_DOMAIN_BYPASS_HOSTS`             | 生产默认留空                             |
| `VENDURE_BOOTSTRAP_BASE_SCHEMA`         | 正常启动必须为 `false`                   |

开发环境继续通过 `VENDURE_EMAIL_OUTPUT_DIR` 落盘预览邮件；生产环境自动切换到 SMTP，并在缺少必要参数时拒绝启动。

### Storefront 构建

| 变量                            | 生产要求                                               |
| ------------------------------- | ------------------------------------------------------ |
| `VITE_SHOP_API_URL`             | 同域部署使用 `/shop-api`                               |
| `VITE_SHOP_API_PROXY_TARGET`    | 仅供本地 Vite 代理，生产静态构建不依赖它               |
| `VITE_MARKET_CODES`             | 只列出已完成 Channel、价格、配送、税区和域名配置的市场 |
| `VITE_CLIENT_CHANNEL_SWITCHING` | `false`                                                |

## 进程与发布方式

当前项目已提供以下命令：

```bash
cd packages/dev-server
bun run build
bun run start:server
bun run start:worker

cd ../storefront
bun run test
bun run build
```

生产发布建议使用以下顺序：

1. 备份数据库并记录当前版本。
2. 在隔离环境恢复备份并执行迁移验证。
3. 构建 Vendure Server、Worker、Dashboard 和 Storefront。
4. 只运行一次数据库迁移。
5. 先启动 Worker，再启动 API Server。
6. 发布前台静态文件，并原子切换到新版本目录。
7. 检查 `/health`、`/shop-api`、商品资源和 Dashboard。
8. 分别在中国站与马来西亚站完成一笔最小金额测试订单。
9. 观察错误、队列和支付回调后再开放流量。

失败回滚必须同时考虑应用版本与数据库迁移，不能只替换前台静态文件。

## 当前 Nginx 配置差距

`deploy/nginx/damatong.conf` 当前仅配置：

- `damatong.net` 与 `www.damatong.net` 前台；
- `console.damatong.net` 管理后台；
- Vendure upstream `127.0.0.1:3002`；
- `/shop-api`、`/health`、`/assets` 反向代理；
- 公共域名禁止 `/admin-api`。

仍需确认：

- 中国站与马来西亚站最终分别使用哪个域名；
- 两个站点是同机静态目录、独立构建目录，还是由 CDN 分发；
- 正式 API 监听端口是否为 `3002`；
- TLS 证书是否覆盖全部前台与管理域名；
- 是否需要 CDN、WAF、限流和真实客户端 IP 传递；
- 新域名加入前不可直接复用现有证书路径与跳转规则。

在上述信息确认前，不修改现有 Nginx 文件。

## 上线放行表

只有所有 P0 项都通过，才可以进入生产放量：

- [ ] 中国站正式域名已验证并绑定正确 Channel。
- [ ] 马来西亚站正式域名已验证并绑定正确 Channel。
- [ ] 两站税区、税率和价格含税规则已确认并复核。
- [ ] 测试配送方式已删除或禁用，真实运费计算已验证。
- [ ] 测试支付已禁用，真实支付、回调与退款已验证。
- [ ] 注册、验证、找回密码和订单邮件能够真实送达。
- [ ] 生产数据库迁移、备份和恢复演练通过。
- [ ] 商品图片使用持久存储，进程重启后仍可访问。
- [ ] 临时 `DEMO-` 商品与 `storefront-demo` 资源已被真实内容替换。
- [ ] API Server 与 Worker 独立运行且没有重复消费任务。
- [ ] 公共域名无法访问 Admin API，GraphiQL 已关闭。
- [ ] 中国站与马来西亚站完整 E2E 验收通过。
- [ ] 监控、日志和关键告警已生效。

## 需要业务方提供的决定

开始下一轮正式配置前，需要一次性确认：

1. 中国站正式域名和马来西亚站正式域名。
2. 马来西亚站商品价格是否含税，以及采用的税务规则。
3. 两个市场各自的配送公司、区域、价格和免邮规则。
4. 两个市场各自的支付渠道与收款主体。
5. 邮件服务商、发件域名和发件人名称。
6. 生产数据库类型与托管位置。
7. 商品图片使用服务器持久磁盘还是对象存储。
8. 监控平台、备份保留周期和可接受恢复时间。

这些决定涉及支付、税务、部署和生产基础设施，确认后再实施对应代码与环境配置。
