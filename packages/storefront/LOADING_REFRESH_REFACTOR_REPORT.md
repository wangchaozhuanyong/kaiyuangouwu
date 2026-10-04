# 客户端加载、刷新与交互重构交付记录

日期：2026-10-03。状态：**代码完成、受影响的本地验证完成**。未提交、未推送、未合并、未部署；线上功能和真实交易未验收。

## 工作区与协调

- 分支：`refactor/storefront-interaction-standard-20261003`。
- 基线：`192c7fc648a8fe00eef1e5be73ba86786569a0d2`。
- 工作区：`/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/storefront-interaction-standard-20261003`。
- 改动全部位于 `packages/storefront`。原 checkout 的现有 WIP、后台、后端、数据库和根规则未修改。
- 已核对并向用户指定的“审计管理后台加载与刷新体验”窗口发送跨端方案。对方工作区为同仓库的 `.codex-worktrees/admin-unified-runtime-ui-20261003`，分支为 `refactor/admin-unified-runtime-ui-20261003`。
- 对方已在 `packages/next-admin/LOADING_REFRESH_REFACTOR_PLAN.md` 的“跨端行为约定”中写入一致规则：首载占位、刷新保留数据、局部重试、作用域隔离、写操作防重复、写入和刷新结果分开。客户端 TanStack Query / Router、后台 Apollo / React Router 各自维护缓存和包内规则，文件边界无冲突。此结论是方案与修改范围核对，不是后台实现验收。

## 审计发现与处理

| 发现                                              | 影响                                                   | 本轮处理                                                                     |
| ------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 公共首载状态部分按商品数量判断                    | 已有商品时，内容读取失败可能被掩盖；空数组也可能被误判 | 按 `data === undefined` 判定是否取得结果；首载、空状态与后台更新分开         |
| 公共重试列举少数查询，遗漏内容                    | 页面重试未必恢复实际失败的数据                         | 当前店铺／币种／语言下统一刷新 active reads；私有读取按明确范围加入          |
| 页面普遍无参数 `refetch` / `fetchNextPage`        | 连续操作可能取消正在进行的读取并重新请求               | 显式 `cancelRefetch: false`，复用正在进行的请求                              |
| 部分页面用 query error 替换缓存内容               | 一次后台读取失败清空优惠券、返利、评价或账户内容       | 共用首载错误判断和非模态刷新反馈；分页错误留在分页区域                       |
| 搜索无条件保留上一查询内容                        | 店铺、币种、语言变化可能沿用不兼容占位                 | `storefrontPlaceholderData` 统一检查作用域；同作用域筛选仍可平滑切换         |
| 收藏／足迹查询使用单独的语言和客户 key 格式       | 漏出统一刷新及客户私有缓存管理范围                     | 使用标准私有客户 key，保留已确认收藏，补齐断网和首载错误                     |
| public session cache 只保存 success 状态          | 后台刷新失败后丢弃此前确认的公共内容                   | 保存已有公共数据，去除错误对象，保留原始更新时间及现有白名单                 |
| 地址保存成功后，后续读取失败再次提交会重放 update | 将展示更新失败与保存失败混在一起                       | 相同表单内容只重试读取；修改过的草稿才产生新写入，提交有同步防重保护         |
| 浏览器原生确认和粘贴 prompt                       | 与应用主题、键盘及移动交互不一致                       | 提取既有 `DialogSheet`；地址／邮箱删除使用应用内确认；粘贴失败返回现有输入框 |
| 一个销量读取未传递查询取消信号                    | 切换作用域后仍可能继续批量读取                         | 传递现有 `AbortSignal`；不改变服务器 API 合约                                |

统一更新提示超过 200ms 才出现，保留内容，不获取焦点，只重试当前失败的活动查询。订阅使用查询框架的批量通知，避免在其他组件 render 时同步触发更新。提示与统计选择浮层错开，并验证两者按钮均可操作。

钱包金额继续遵守现有业务确认要求：读取失败显示“暂不可用”和局部重试，不将缓存余额当作已确认金额。支付报价、订单确认 token、登录、权限和业务插件的专用流程沿用原契约。

为满足现有入口包体积门禁，反馈组件与独立装修预览入口复用现有 `lazyRouteComponent`。预览首载使用共用骨架。没有提高性能预算、改构建配置、增加依赖或修改 lockfile。

## 修改文件

| 领域                   | 文件                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共用状态、缓存与运行时 | `src/loading-state.ts`、`src/query-client.ts`、`src/StorefrontQueryFeedback.tsx`、`src/App.tsx`、`src/StorefrontShell.tsx`、`src/route-loading.tsx`、`src/styles/state-surfaces.css`                                                                                                                                                                 |
| 查询及作用域           | `src/hooks/useStorefrontAppState.ts`、`useStorefrontBootstrap.ts`、`useStorefrontPublicData.ts`、`useStorefrontCustomerData.ts`、`useStorefrontRouteData.ts`、`useStorefrontMerchandising.ts`、`useCustomerProductActivity.ts`、`useCategoryPagination.ts`                                                                                           |
| API 取消信号           | `src/api.ts`、`src/api/catalog.ts`                                                                                                                                                                                                                                                                                                                   |
| 页面                   | `src/pages/account-page.tsx`、`browsing-history-page.tsx`、`category-page.tsx`、`coupon-center-page.tsx`、`desktop-catalog-page.tsx`、`favorite-products-page.tsx`、`logistics-page.tsx`、`notifications-page.tsx`、`referral-page.tsx`、`search-page.tsx`                                                                                           |
| 路由重试               | `src/route-pages/account-route-pages.tsx`、`catalog-route-pages.tsx`、`content-route-pages.tsx`、`order-route-pages.tsx`、`shared.tsx`                                                                                                                                                                                                               |
| 功能与共用弹窗         | `src/addresses-page.tsx`、`src/components/common/dialog-sheet.tsx`、`src/order-pages.tsx`、`src/payment-pages.tsx`、`src/review-pages.tsx`、`src/storefront-ui/daily-recommendation-section.tsx`、`src/client-plugins/mail-query/mail-query-page.tsx`                                                                                                |
| 规则与门禁             | `AGENTS.md`、`LOADING_REFRESH_INTERACTION_STANDARD.md`、本记录、`package.json`、`scripts/check-interaction-standard.mjs`、`scripts/check-interaction-standard.d.mts`                                                                                                                                                                                 |
| 回归验证               | `src/loading-state.spec.ts`、`src/query-client.spec.ts`、`src/StorefrontQueryFeedback.spec.tsx`、`src/storefront-refresh.spec.ts`、`src/interaction-standard.spec.ts`、`src/addresses-page.spec.tsx`、`src/api/catalog.spec.ts`、`src/hooks/useCustomerProductActivity.spec.tsx`、`src/pages/search-page.spec.tsx`、`e2e/loading-refresh/verify.mjs` |

## 验证记录

| 检查                                      | 实际结果与边界                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 首次客户端完整 Vitest                     | 167 文件、1481 项：1479 通过，2 项钱包不可用显示断言失败。随后恢复敏感金额确认语义；`account-referral-visibility`、`account-referral-refresh`、共享反馈共 17 项通过                                                                  |
| 收口影响验证                              | 查询作用域、搜索、地址、取消、就绪及门禁等定向测试执行。最后两批为 6 文件 46 项通过，以及地址／Shell／门禁 3 文件 48 项通过；销量取消和 merchandising 等直接依赖测试亦通过。修复中发现的问题均已定向复验；没有重复整套测试           |
| `bun run check:interaction`               | 通过。TypeScript AST 检查普通及可选链读取，要求显式合并请求；拒绝非批准 reload、不兼容占位、隐藏页面轮询和浏览器原生弹窗                                                                                                             |
| 根 `node scripts/lint-check.mjs`          | 50 个变更源文件通过，零错误、零警告；新增浏览器预览断言另做定向 Lint                                                                                                                                                                 |
| `bun run build`                           | 通过，含 Router 工具链核验、`tsc --noEmit`、主客户端构建、生产产物／本地化检查、独立 2FA 构建。入口 375 KiB、主 CSS 339 KiB、最大路由 CSS 23 KiB，均在既有预算内                                                                     |
| 实际本地页面浏览器验收                    | 23 项通过；390px／中文／classic 与 1440px／英文／neo-minimalist；首载失败局部恢复、慢刷新内容保留、连续刷新仅一次请求、更新失败键盘重试、浮层按钮可达、7 类路由烟测、硬刷新 URL 筛选及装修预览按需加载；无控制台异常、无页面横向溢出 |
| `git diff --check`                        | 通过                                                                                                                                                                                                                                 |
| GitHub CI、合并、部署、线上功能／业务交易 | 未执行、未验证                                                                                                                                                                                                                       |

这些记录组合使用有效的受影响检查，不代表最终版本重新执行了整套测试，更不代表远端 CI 或线上验收。浏览器使用现有视觉验收样本补齐的内存 Shop API 数据，所有请求被本地拦截，未使用真实客户、线上订单或生产后端。

## 后续开发约束与交付物

新增页面及功能先读 `AGENTS.md` 和统一标准。门禁随现有 `bun run test` 自动执行，单独可运行 `bun run check:interaction`。门禁覆盖声明的常见回退模式，query key、草稿保护和业务正确性仍需按标准审查，不能保证以后绝无错误。

本地浏览器复验：在此包运行 `bun run dev -- --port 5326 --strictPort`，另运行 `node e2e/loading-refresh/verify.mjs`。该脚本要求开发服务器，用实际组件和拦截数据验收，不是生产测试入口。

手动测试入口：本包已有 `dist/` 构建时运行 `node e2e/loading-refresh/preview-server.mjs`，打开 `http://127.0.0.1:5326/__interaction-test`。工具栏可切换正常、慢速 3 秒、读取失败，触发实际客户端的后台更新、清除本测试页公共缓存后首次加载、重载当前路由，以及 1440px／390px 宽度。服务器仅监听本机，返回既有样本数据并拒绝业务写入。已验证慢速刷新保留内容、连续触发合并请求、更新失败与恢复、手机宽度、首次加载失败与恢复、硬刷新；已在应用浏览器打开中文实际页面供用户测试。此记录不代表用户验收或真实后端验收。

证据位于本包的 `artifacts/loading-refresh/`：`checks.json`、`build.log`、`classic-390-refresh-error.png` 和 `neo-minimalist-1440-refresh-error.png`。构建产物位于本包 `dist/` 与 `dist-two-factor/`。这些本地生成物不纳入生产代码交付。发布仍需单独授权，由统一发布窗口收集本候选和后台候选后处理。
