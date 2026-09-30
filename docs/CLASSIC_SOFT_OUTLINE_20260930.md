# 经典皮肤浅色轮廓落地 · 2026-09-30

状态：实现与视觉本地验证完成；用户已授权合并 main、统一部署和线上验证。发布结果以 `artifacts/classic-soft-outline-release/RELEASE_LEDGER.md` 的实际回执为准。

## 完成结果

- 经典皮肤的独立模块统一为 `1px solid #d2ddea`，弱分隔 `#e4ebf3`，常规阴影 `0 2px 8px rgba(34,65,102,.04)`，悬停阴影收轻。
- 账户身份、邀请卡、订单区以及服务、商品、购物车、地址、结账、物流、通知和浮层按共享表面角色接入。仍由各原组件 CSS / 工具类拥有样式，没有皮肤后代选择器或全局通配覆盖。
- 结账费用明细只保留外层轮廓；相接商品与选项的接缝无双线。平铺商品行、透明分类条、通知内行及阅读正文保留原有结构；圆角按现有模块层级保留。
- 输入框、选中态、焦点的控件边界没有淡化；原图片、后台内容、商品/账户/支付数据逻辑没有修改。
- 三个可复用轮廓变量在新锐皮肤显式返回 `initial`，保留各组件原样式回退。对应表面修改前后的深色比较未发现视觉属性差异。
- 后台皮肤组件样例与实际客户端共用主题变量。现有旧的无边框断言已按本次授权更新；保留了针对平铺结构及焦点的检查。

## 来源与隔离

- 主项目：`/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master`。
- 实施工作树：`.codex-worktrees/classic-soft-outline-20260930`；分支 `fix/classic-soft-outline-20260930`。
- 开发基线：`c4c4dcc8d92833e0a36ac698047be335ff827908`，包含已登记账户礼盒设计与后续文案、服务密度修改。
- 最新授权：本聊天用户确认 `design-proposals/classic-soft-outline-20260930/DESIGN.md` 并要求执行。
- 主工作区与其他工作树已有 WIP 保留。本地工作树工具因聊天位于仓库父目录返回 `Not a git repository`，因此在项目已有 `.codex-worktrees/` 内使用 Git 创建隔离工作树。
- 比较已登记账户、服务卡来源及其相关 WIP 清单；以本轮已确认方案为新的边界规则，不移入其他未完成任务的修改。

## 验证记录

| 检查 | 结果与证据 |
| --- | --- |
| 皮肤结构、语义色板、账户组件、邀请显隐、主题生命周期、后台皮肤样例 | 6 个规格文件，共 80 项通过。首轮 79 项通过；后台样例原字符串断言随新边框更新后 6 项通过；最终 CSS 修正后皮肤结构 35 项复验通过。见 `targeted-tests.log`、`admin-test-repair.log`、`skin-final.log`。 |
| 改动文件 lint | `node scripts/lint-check.mjs`：7 个 TypeScript 源文件通过；Admin 原有告警在既定预算内。 |
| 多店共享规则 | `node scripts/check-storefront-unification.mjs`：865 个运行时文件检查通过。 |
| Storefront 构建 | `bun run --cwd packages/storefront build`：通过类型检查、主客户端构建与独立 2FA 构建及产物校验；见 `storefront-build-final.log`。 |
| NextAdmin 构建 | `bun run --cwd packages/next-admin build`：通过反馈审计、类型检查、构建与生产入口检查；见 `admin-build-final.log`。 |
| 实际客户端页面 | Playwright 使用真实组件与本地 QA fixture。最终 320 / 390 / 1440px 的账户、分类、购物车、订单、地址、结账、支付、搜索 24 个组合均无横向溢出或脚本错误；分类与搜索手机为商品行，桌面为商品卡。 |
| 重复套框修复 | 390 / 1440px 结账、分类、通知共 6 个组合复验通过；见 `nesting-repair-observations.json`。 |
| 其他表面与暗色回归 | 首轮手机和桌面覆盖服务、物流、通知等；深色账户、服务、商品、购物车、地址与基线比较无视觉属性差异。见 `after-observations.json`、`comparison.json`。 |
| 后台样例与焦点 | 使用实际 `storefrontVisualPreviewDocument` 导出文件进行浏览器验证，两套皮肤的卡片与控件边界区分正确；客户端账户操作键盘焦点为 2px；关闭阴影后 6 个账户模块仍有 1px 轮廓。见 `controls.json`。 |
| Git 差异 | `git diff --check` 通过。 |

所有浏览器数据都是本地合成 QA 样本，包括账户、余额、商品、订单与地址。支付页通过本地待支付 fixture 展示，仅验证外观，没有提交支付。后台验收为同源组件导出与构建，没有登录生产后台或保存店铺配置；上述结果不代表线上业务验收。

发布前按 CI 的关联测试范围补查，NextAdmin 6 项通过，Storefront 41 个文件中 39 个通过；另两个文件保留的旧商品“无框/无阴影”断言已改为验证共享皮肤变量，修复后这两个文件共 109 项通过。对应 lint 与差异检查通过。运行时、发布清单和最终线上证据另记于发布台账，不将其他任务 WIP 合入。

验收过程中修正过 QA 脚本的礼盒可见条件、异步商品等待与支付待支付前置样本；未为通过样式验收修改业务行为。后台样例导出完成后，临时 Vite 中间件关闭时出现依赖扫描中止警告；正式 NextAdmin 构建成功，样例已在浏览器校验。

## 预览与截图

实际客户端只读样本：
`http://127.0.0.1:5197/account?storefrontPreviewEmbedded=1&storefrontPreviewPreset=classic&storefrontPreviewAuth=authenticated&storefrontPreviewScenario=aftercare&storefrontPreviewLanguage=zh`

预览服务目录为本工作树的 `packages/storefront`。本地服务需保持运行；服务结束后可在此目录执行 `bun run dev --port 5197`。

- `artifacts/classic-soft-outline/final-mobile-viewport.png`：手机实际首屏。
- `artifacts/classic-soft-outline/final-classic-1440-account.png`：桌面账户。
- `artifacts/classic-soft-outline/final-classic-1440-cart.png`：桌面购物车。
- `artifacts/classic-soft-outline/nesting-repair-classic-1440-checkout.png`：结账分组与内层去框。
- `artifacts/classic-soft-outline/admin-classic.png`：后台实际导出样例。
- 验证脚本、观察 JSON、构建日志均保存在同一 artifacts 目录，未纳入发布源码。

## 修改文件

- `packages/next-admin/src/pages/Storefront/StorefrontVisualPresetPanel.spec.tsx`
- `packages/next-admin/src/pages/Storefront/storefront-visual-preview.ts`
- `packages/storefront-content-plugin/src/shared/storefront-semantic-palette.spec.ts`
- `packages/storefront-content-plugin/src/shared/storefront-semantic-palette.ts`
- `packages/storefront/DESKTOP_SKIN_DESIGN_CONTRACT.md`
- `packages/storefront/src/skin-system.spec.ts`
- `packages/storefront/src/home-page.spec.tsx`
- `packages/storefront/src/product-navigation.spec.tsx`
- `packages/storefront/src/styles/account-catalog-surfaces.css`
- `packages/storefront/src/styles/account-identity.css`
- `packages/storefront/src/styles/account-security.css`
- `packages/storefront/src/styles/address-surfaces.css`
- `packages/storefront/src/styles/auth-flow.css`
- `packages/storefront/src/styles/cart-layout.css`
- `packages/storefront/src/styles/checkout-payment-surfaces.css`
- `packages/storefront/src/styles/coupon-center.css`
- `packages/storefront/src/styles/desktop-commerce.css`
- `packages/storefront/src/styles/desktop-pages.css`
- `packages/storefront/src/styles/home-showcase.css`
- `packages/storefront/src/styles/logistics.css`
- `packages/storefront/src/styles/modals-and-support.css`
- `packages/storefront/src/styles/notifications.css`
- `packages/storefront/src/styles/product-card.css`
- `packages/storefront/src/styles/referral.css`
- `packages/storefront/src/styles/service-entries.css`
- `packages/storefront/src/tailwind/checkout-page-styles.ts`
- `packages/storefront/src/tailwind/order-page-styles.ts`
