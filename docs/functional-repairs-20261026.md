# 商城功能修复与验收记录（2026-10-26）

状态：七项代码修复完成；下列本地隔离验证通过。生产发布、真实账户和支付沙箱验收尚未执行。

- 仓库：`wangchaozhuanyong/kaiyuangouwu`
- 报告与候选基线：`0a07e2c193f6d16cf38035e3e1926c18f07a9795`
- 分支：`fix/storefront-admin-functional-20261026`
- 修复工作区：仓库内 `.codex-worktrees/functional-repairs-20261026`
- 原始代码复验工作区：仓库内 `.codex-worktrees/functional-repairs-baseline-20261026`
- 前一轮已有的商城修复按文件复制到候选，先对原始代码运行测试，避免重复实现。原主工作区、邮件策略及其他并行修改均保留；本分支不包含这些邮件或其他任务的修改。
- 没有改变布局、样式、正常页面文案、导航、商品、价格、权限规则或数据库结构。仅在已有支付方式后台刷新失败时增加错误与重试反馈。

## 证据分类与方法

前端四项与后台三项均有本地运行证据。充值、客服的既有线上复现来自用户报告，本次没有重新操作生产站点。结算、排序、分页和人数的本次证据来自隔离运行，不能写成线上错误订单、错误投递或实际扣款失败。

测试使用实际 CheckoutPage、邮箱选择器、PaymentPage、充值路由、SupportPage、CatalogModule、RolesModule、ShopApi、QueryClient、Apollo、GraphQL 输入转换和 OrderService。订单排序还经过实际 ListQueryBuilder、TypeORM 和内存 SQL.js 数据库；只有外围数据、接口、时钟和资料为测试夹具。

修复前后使用相同业务断言。原始运行日志、测试脚本故障及中间失败均保留，不把导入/语法/控件定位错误计作业务复现，也不把中间失败记作最终通过。新增测试曾修正查询定位（同名归属查询中区分主分页与辅助查询）、React 提交通知等待、夹具导航回调和异步接口实现；业务期望没有被放宽。

完整本地日志目录：[`packages/storefront/test-results/functional-repairs-20261026`](../packages/storefront/test-results/functional-repairs-20261026)。该目录是本地生成证据，不纳入源代码提交；同目录的 `functional-repairs-20261026-evidence.json` 保存结果、关键失败和文件摘要，测试源码随代码提交以便复验。

## 1. 同一客户/订单刷新覆盖交付邮箱

- 根因：邮箱初始化依赖整个客户对象，数据刷新生成新对象时重新选择默认邮箱；未受控的新邮箱输入随输入区卸载丢失。
- 触发：客户与订单 ID 不变，父级传入新客户对象，或首次地址簿请求迟到。
- 文件：`packages/storefront/src/checkout-page.tsx`、`checkout-page.spec.tsx`。
- 行为：以店铺、客户 ID、订单 ID 区分初始化边界；单独管理已选择邮箱、草稿、确认及保存选项。首次成功初始化后不重新覆盖，已编辑草稿优先；身份切换清理旧草稿并拒绝迟到结果。未持久化邮箱草稿。
- 修复前：原对象对照两项通过；相同 ID 新对象的两项失败；迟到初始化也覆盖输入。见 `baseline-final-storefront.log`。
- 修复后：上述四个对照，以及迟到结果、客户/订单切换均通过。`storefront-final-component.log`；手机/桌面浏览器对应选择与草稿检查通过，见浏览器结果。

## 2. 同单切币后支付方式缓存不一致

- 根因：API Map 按订单缓存 30 秒，页面 key 不含实际付款币种，initialData 可注入旧结果；SSE 或手动重试只刷新查询层，无法穿透 API Map。
- 文件：`packages/storefront/src/api/cart-checkout.ts`、`api.ts`、`query-client.ts`、`checkout-page.tsx`、`payment-pages.tsx`、`hooks/useStorefrontAppState.ts`，及关联测试/夹具。
- 行为：移除 API Map 及其预取/缓存快照接口，由现有 QueryClient 管理唯一缓存。key 包含店铺结算作用域、语言、订单、客户和实际付款币种；结算预取使用同一个 key，删除支付页旧 initialData。切币确认后取消并移除该店铺/订单的支付方式查询。保留原 SSE 的订单前缀匹配，SSE、refetch 均访问真实 API，不等待缓存过期。
- 同时修复：保留已有支付方式时，后台刷新失败也显示现有错误组件和重试按钮；原列表保持可用。
- 修复前：切币继续命中旧条目；旧币种请求未被取消，且不会发起新币种请求。见 `baseline-final-storefront.log`、`payment-late-before-final.log`。新增后台失败重试用例也确实暴露了缺失按钮，见 `payment-final.log`、`payment-final2.log`。
- 修复后：`payment-acceptance-final2.log` 的 5 项通过，覆盖 CNY→USDT、USDT→CNY、真实 ShopApi 预取、SSE、失败后实际点击重试、离线首读后恢复、旧币种响应迟到。`api.spec.ts` 的原 API 双向读写检查与实际结算组件提交/预取检查也通过。
- 浏览器：手机/桌面的实际 CheckoutPage→PaymentPage→返回编辑→切币→提交预取→PaymentPage 两方向通过；三个模拟店铺切换、回到经 SSE 失效的原店铺均重新正确读取。该夹具模拟外围接口和父级继续回调，未运行完整 AppState 的真实服务端 reopen 链路。

既有授权的边界修复一并保留：切币写请求使用公共 20 秒截止时间，超时仍按“结果不明、先读取确认”恢复；备注保存回执与后续读取错误分离，重试只读，不重复保存。这些是此前已实现并验证的修复，不是新增交易流程。

## 3. 最近订单的排序优先级

- 根因：GraphQL 会按 schema 字段次序重建 sort 对象。`id` 在 `orderPlacedAt` 前面，ListQueryBuilder 的遍历因此生成 ID 主排序；调整前端 JSON 属性次序无效。
- 文件：`packages/core/src/service/services/order.service.ts`、`order-list-sorting.spec.ts`。
- 行为：仅当明确指定下单时间与 ID 这一对排序字段时，OrderService 在 GraphQL 转换后显式重建时间优先、ID 次序；不改变其他实体或其他组合的通用排序规则。
- 隔离证据：读取生产 Order SDL 生成实际 sort input，经 `getVariableValues` 后实际键序为 `[id, orderPlacedAt]`。实际服务与 SQL 查询使用订单 ID 90/10/11，对应时间 10月1日/26日/26日，并加入跨店及 active 订单对照。
- 修复前：降序返回 `[90,11,10]`，升序 `[10,11,90]`，两项失败，见 `orders-before-final.log`。
- 修复后：降序 `[11,10,90]`，升序 `[90,10,11]`；跨店/active 过滤仍有效，真实数据库与排序解析共 18 项通过，见 `orders-after.log`。无生产数据库操作。

## 4. 商品分页越界与 URL 修正

- 根因：URL 页码只校验正数，没有根据服务器 totalItems 限制上界；越界空页被当作筛选/店铺无商品。
- 文件：`packages/next-admin/src/pages/Catalog/CatalogModule.tsx`、`CatalogModule.spec.tsx`。
- 行为：仅在当前作用域读取成功、总数确定、搜索条件已就绪且没有错误时回正到最后有效页，并通过原 URL setter 保留搜索、分类、排序和店铺范围。确认总数为零回到第一页；未获取、失败或迟到的旧查询不能当成零。修正期间不显示“暂无匹配的商品”。相同归属查询后台刷新保持已有列表。
- 修复前：普通/多店归属/未分配列表的 page=99 均不回正；真实零、总数缩小、延迟总数也失败；归属后台刷新清空内容。见 `baseline-final-admin.log`。
- 修复后：上述用例通过，并覆盖旧搜索响应迟到不覆盖新 URL、真实 Apollo 店铺范围切换及已有列表功能。`admin-regression.log` 中 Catalog、URL 状态和版本恢复合计 60 项通过。

## 5. 角色关联员工人数

- 根因：独立角色页裁剪 GraphQL 文档时漏掉 manageableAdministrators，页面把未读取的数据折算为空数组，显示 0 人。
- 文件：`packages/next-admin/src/pages/Settings/RolesModule.tsx`、`RolesModule.counts.spec.tsx`。
- 行为：同一次读取包含已有 manageableAdministrators API，按返回的可管理范围计数；真实空数组显示 0，人数字段缺失或更新失败显示“未获取/读取失败”。不使用全局 administrators，不增加按角色逐条请求，不修改服务端权限。
- 修复前：实际 Apollo 文档没有员工字段，2 人误报 0；0 人用例也因没有查询字段而失败，见 `roles-before.log`、`baseline-final-admin.log`。
- 修复后：真实 2 人、真实 0 人、首次等待、失败均通过；现有管理员移交测试通过，见 `admin-after.log`。另运行既有后端店铺目录权限用例，验证跨店/平台账号限制，见 `role-permission-regression.log`。

## 6. 充值页切语言丢失草稿

- 根因：路由组件 key 包含语言，切语言重建组件。
- 文件：`packages/storefront/src/route-pages/gpt-recharge-route-page.tsx`、对应 spec，以及浏览器夹具。
- 行为：同店页面切语言保留内存草稿；离开再进入、硬刷新仍清理临时输入，不延长敏感结果缓存。
- 修复前：`synthetic-draft` 变为空字符串，见 `baseline-final-storefront.log`。
- 修复后：真实路由及组件测试通过；中英文、手机/桌面、两皮肤切换检查通过，硬刷新清理通过。无真实兑换或充值。

## 7. 客服校验重复提示

- 根因：同一个错误同时在外层与表单内部渲染。
- 文件：`packages/storefront/src/pages/support-page.tsx`、`customer-service-feedback-page.spec.tsx`。
- 行为：保留单一错误位置；修正星级后清除对应校验，正常继续。复用已有修复同时处理访客标识不可用时结束加载、等待剪贴板成功才提示复制成功、失败给出恢复操作。
- 修复前：同一评分错误出现两处，见 `baseline-final-storefront.log`。
- 修复后：一次错误只出现一处，纠正后提交成功；浏览器未评分点击不调用提交接口，后续提交仅针对合成接口。复制拒绝及存储异常恢复通过。

## 已执行检查

以下是各组结果，存在交叉用例，不能直接相加当作去重测试总数：

| 检查 | 实际结果 | 本地日志 |
| --- | --- | --- |
| 商城 6 个基础修复测试文件 | 235 通过 | `storefront-after.log` |
| 最终结算/客服/充值及支付回归 6 文件 | 139 通过 | `storefront-final-component.log` |
| QueryClient、目录路由、导航历史、模块预载与支付缓存 | 68 通过 | `storefront-regression.log` |
| 最终支付缓存验收（含新增迟到响应） | 5 通过 | `payment-acceptance-final2.log` |
| 后台商品、URL、版本恢复 | 60 通过 | `admin-regression.log` |
| 角色计数、移交、Dashboard 查询及商品首轮 | 49 通过、2 个测试定位问题；后续商品 4/4 与 60 项回归通过 | `admin-after.log`、`catalog-after-final.log`、`admin-regression.log` |
| 实际 OrderService/SQL、列表构建器、排序解析 | 18 通过 | `orders-after.log` |
| 员工可管理范围权限对照 | 1 通过 | `role-permission-regression.log` |
| 商城构建（客户端/SSR/独立2FA与预算） | 通过 | `storefront-build.log` |
| Admin 构建/交互架构/生产挂载检查 | 通过；既有大 chunk 提示保留 | `admin-build.log` |
| Core 类型检查 | 通过 | `core-typecheck.log` |
| 仓库定向 lint（按包选择 oxlint/ESLint） | 通过，未提高既有 warning 预算 | `lint-package-final.log` |
| 商城最终类型/交互/三店共用检查 | 通过 | `storefront-final-typecheck.log`、`storefront-interaction.log`、`store-unification.log` |
| 浏览器实际组件 | 首轮21项＋流程8项通过；无 pageerror | `browser-final2.log`、`browser-journey-final2.log` |
| 原工作区保护 | 原已修改文件摘要未变化 | `main-wip-verification.json` |

曾直接将根 ESLint 套用到 Admin，暴露了不适用于该包既有源文件的基线问题；保存于 `lint.log`。最终采用仓库自带 `scripts/lint-check.mjs --base 0a07e2c`，按其既有规则调用 Admin oxlint、其余文件 ESLint。没有更改规则、豁免、预算或关闭检查。

## 回归范围与仍未验证

- 已验证：390/1440 视口，中英文与两种既有皮肤，邮箱选择与草稿刷新、同单双向切币、实际查询/预取/SSE/手动重试、旧请求迟到、离线查询恢复；直接打开夹具、硬刷新、前进后退；商品越界及总数变化，URL 参数保留，实际 Apollo 店铺隔离。
- 复用并运行既有导航/目录返回与 Admin build-recovery 单元测试；这不是部署后旧标签页与 CDN 资源保留的真实浏览器验收。
- 未执行：真实后台浏览器的完整详情往返/连续切页矩阵、三个实际域名切换、完整 AppState→后端 reopen→结算链路、支付沙箱付款/退款、真实邮件/交付、生产旧版本资源切换。这些需要独立测试环境或发布候选，不能写成通过。
- 没有做性能参数优化。本次响应迟到和离线测试用于功能正确性，未测真实设备弱网时序、浏览器性能 trace、线上加载速度或商业效果。
- 只执行测试夹具与内存 SQL.js 数据，没有生产订单、商品、用户、库存、资金或配置写入。

## 审查、复验与回滚

在相应包目录运行本记录列出的测试文件；原始工作区可复验相同断言的失败，修复工作区可复验通过。浏览器脚本在 `packages/storefront/e2e/checkout-state-repair`，仅连接本地 Vite 5188，并阻断外部请求。

代码按商城、订单排序、后台三组本地提交，另附本记录。各组通过 `git show <commit>` 审查。未推送、未合并、未部署。

无迁移和业务数据变更。若以后需要撤销候选，在新的回滚分支按相反顺序 `git revert` 本次代码提交并执行对应定向测试；不得 reset/覆盖原主工作区的未提交修改。已发布版本的回滚需沿用仓库发布流程，不能仅凭本地 revert 声称线上恢复。

本地代码提交：

| 范围 | 提交 |
| --- | --- |
| fix(storefront): Preserve checkout drafts and scope payment method reads | `7d53cd947` |
| fix(core): Order recent orders after GraphQL sort coercion | `931714224` |
| fix(admin): Correct catalog pages and scoped role member counts | `3d11ab74e` |

如需整体撤销代码候选，回滚分支上按顺序执行：

```sh
git revert 3d11ab74eca7afeb0923687602524ccb993ce673
git revert 9317142248c0b4e23fef6e2214f95d470ad359ba
git revert 7d53cd947df44933f0f1c8667aedeee97a4b3a0f
```

本记录及证据清单使用独立文档提交，不影响业务运行。
