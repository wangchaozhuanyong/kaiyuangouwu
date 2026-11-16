# 2FA 与邮箱查询独立域名

开发使用项目内独立工作树。正式部署以发布账本和 GitHub 的 Production Release 记录为准。

## 入口行为

| 入口 | 地址 | 行为 |
| --- | --- | --- |
| 独立 2FA | `https://2fa.moyaoai.com/` | 只显示 2FA 工具，无主站导航、登录、商品、客服或返回主站链接 |
| 独立邮箱 | `https://mail.moyaoai.com/` | 只显示查询表单、查询结果和帮助，无主站导航或客服链接 |
| 主站插件点击 | 同标签页进入上述工具 | 显示原生浏览器返回按钮；刷新后仍能返回 |
| 复制链接／新标签页直达 | 干净的工具 URL | 不携带返回标记，不出现主站入口 |

沿用免税地址的 `#back` 临时标记，打开后立即移除，历史条目只保留布尔标记，不记录主站 URL。英文链接使用 `?lang=en`。邮箱结果页的返回按钮只回到工具查询表单。

主站原有 `/two-factor`、`/mail-query` 路由及其功能保留；后台插件启用、停用和排序继续由各店铺已发布配置决定。两个独立站和主站复用同一工具组件与查询服务。

## 文件与实现

- `packages/storefront/src/client-plugins/client-plugin-registry.tsx`：现有 2FA／邮箱插件改为独立工具链接；地址入口共用同一点击逻辑。
- `packages/storefront/src/standalone-tool-navigation.ts`：干净链接、临时返回标记、语言和历史条目状态；独立文档入口负责原生后退。
- `packages/storefront/two-factor-tool/main.tsx`、`styles.css`：复用原独立构建，新增直接访问模式，保留原受信 iframe 握手模式。
- `packages/storefront/src/client-plugins/two-factor/two-factor-page.tsx`、`vault-controls.tsx` 与 `src/storefront-ui/page-shell.tsx`：可省略返回入口，直接访问使用本地保管库说明，不改变加密和账号校验逻辑。
- `packages/storefront/mail-query-tool/`、`vite.mail-query.config.ts`、`src/api/standalone-mail-query.ts`：独立邮箱文档和最小匿名查询适配器。
- `packages/storefront/src/client-plugins/mail-query/mail-query-page.tsx`：独立模式仅从表单接收查询码，隐藏主站入口，保留结果内返回、错误、历史及实时收信。
- `packages/storefront/src/api/mail-events.ts`：复用原流消费和重连，仅为独立入口提供不带商城凭据的同源传输。
- `packages/icloud-relay-plugin/src/api/icloud-standalone-query.controller.ts` 与插件注册：新增单一查询入口，复用 `IcloudUnifiedQueryService` 的本地／托管邮箱查询及原查询码规则。
- `deploy/nginx/damatong.conf`：两个精确虚拟主机；2FA 仅静态资源，邮箱仅静态资源、查询和收信接口，其余商城／后台路径 404。邮箱代理不携带商城 Cookie、Authorization 或 Channel 覆盖，不暴露通用 Shop API。
- `packages/storefront/vite.public-server.config.ts`：在现有独立工具构建步骤产出邮箱页面。运行时制品检查邮箱入口文件。

## 验证

证据目录：`outputs/customer-tools-20261116/`，包含失败原因、修复后的日志、实际浏览器截图与 JSON 回执。

- 前端定向 Vitest：9 个文件、84 项通过；最后 2FA 文案补充后，该文件 11 项通过（原 9 项加 2 项，合计覆盖 86 项）。
- 邮箱新控制器 8 项、原公开查询 resolver 8 项通过。新控制器复用服务以测试替身验证，没有读取客户邮箱。
- 发布前运行了邮箱插件 234 项单元测试及真实 HTTP/数据库回归。SQL.js 37 项通过（3 项 MySQL 专用测试跳过），MySQL 40 项通过。独立接口验证了有效买家码仅返回对应邮箱、空请求在查询前拒绝、过期码不返回邮件。
- `node --test deploy/nginx/storefront-fallback.spec.mjs`：14 项通过，使用本地 Nginx 容器验证真实路径隔离、请求方法和凭据剥离。
- `bun run build`：商城、公开 HTML 渲染器、2FA、地址工具、邮箱工具构建通过；包含 TypeScript、排版和生产构建交互检查。
- 邮箱插件 `bun run build` 通过。新工作区的 core/common 编译依赖只在本地准备，没有启动业务服务器或数据库测试矩阵。
- `node scripts/lint-check.mjs`、`node scripts/check-storefront-unification.mjs`、`git diff --check` 通过；未改锁文件或升级依赖。
- `e2e/customer-tools/verify.mjs`：实际构建页面与实际客户端插件，390／1440px、中英文、两套现有语义皮肤，共 19 个场景；验证本地动态码、模拟邮件结果、失败保留输入、刷新、干净链接、主站点击后返回和无横向溢出。使用当前 Nginx CSP；邮箱返回数据和查询码均为合成测试内容。

初次构建发现父工作区依赖版本与当前锁文件不一致，已在隔离工作区执行冻结安装。后端回归依赖本工作区的 core/common 编译产物，补齐后原 resolver 回归通过。初始前端失败（按钮改链接后的旧断言、输入字体规格、独立文档返回归属）及邮箱桌面 CSS 顺序问题均已修正。

## 发布和数据边界

上线先准备两个域名的 TLS 证书，部署并核对精确虚拟主机，再添加公网 DNS 记录。证书路径为 `/etc/letsencrypt/live/2fa.moyaoai.com/` 与 `/etc/letsencrypt/live/mail.moyaoai.com/`。公开验收只提交会在查库前拒绝的空查询，邮箱业务范围由本地测试库验证。

2FA 使用既有 `/var/www/kaiyuangouwu-two-factor-current` 独立指针；邮箱随商城制品放在 `dist/.mail-tool`，地址工具仍在 `dist/.address-tool`。无需新增 API Key 或环境变量。既有可选 2FA iframe 配置保持原规则。

子域名的本地存储与主站隔离。原主站保存的 2FA 账号和邮箱查询记录不会自动迁移；原路由和数据仍保留。现有加密备份绑定保管库身份，不能把它宣传为任意域名／账号之间的迁移工具。本次未改变该安全边界，也未复制客户密钥或查询码。

本地模拟验收不代表真实邮箱收信、DNS/TLS 生效或生产发布成功。
