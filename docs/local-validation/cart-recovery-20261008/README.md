# 购物车恢复与配送币种修复（2026-10-08）

已完成代码和本地验证，未推送、未合并、未部署。代码版本：6b206f0e2922005e00d3401a5e528575132303a3。

## 修复结果

- 购物车提交后响应丢失：保留原操作身份，手动核对读取服务端；未确认时继续禁止改数量和结算，确认后恢复操作，避免重复提交。刷新和自动核对并发时共享同一核对流程。
- 不再长期显示“计算中”：显示最近已确认的金额，并注明当前操作待核对。核对和取消恢复为正常按钮。
- 结果已经确认、最新购物车暂时读不到时：仅重读购物车，不再重发已成功的操作；隐藏不适用的取消入口。
- 跨页、重载、其他页面更新购物车后：防止旧会话、旧运费和旧金额覆盖已经确认的新状态。
- “立即购买”可直接进入购买页；本地验证地址、配送和进入支付选择页的链路。未进行真实支付。
- 配送计算使用订单自身币种，避免界面币种与订单币种不一致时误判免运费、收费金额或抛错。
- 前一轮物流五按钮、首页信任区/页码、邀请卡片改动保留，见[三处排版验收](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/responsive-three-surfaces-20261008/README.md)。

## 实际验证

共341项唯一的定向测试通过：前端318项（最终改动相关207项、输入未变复用111项），配送后端23项。前端构建、后端构建/类型检查、定向 lint、格式、交互规范、共享店铺检查和提交前检查通过。未启动全仓或远端 CI。

16个本地浏览器用例通过：320/390/1440px四类恢复/直接购买状态共12例；Chromium/WebKit在1200/3000ms模拟延迟下的快速勾选、数量、删除、响应丢失、重载共4例。页面异常0，变更请求最大并发1，真实收费请求0。最后四例均在生产构建预览上验收；较早开发服务测试曾出现时延超限，未将该次失败计为通过。

这些记录使用明确的合成顾客、商品、购物车和服务回复，所有外部调用拦截。截图展示本地候选状态，不证明线上闪铸订单或支付已恢复。全站各页面与其他屏幕宽度未逐一检查。

[结构化本地记录](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/local-receipt.json) · [恢复/直接购买浏览器记录](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/browser-recovery-results.json) · [快速购物车浏览器记录](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/browser-cart-results.json)

## 修改文件

- [commerce-shipping-options.spec.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/commerce-fulfillment-plugin/src/commerce-shipping-options.spec.ts)
- [commerce-shipping-options.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/commerce-fulfillment-plugin/src/commerce-shipping-options.ts)
- [order-fulfillment.resolver.spec.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/commerce-fulfillment-plugin/src/order-fulfillment.resolver.spec.ts)
- [order-fulfillment.resolver.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/commerce-fulfillment-plugin/src/order-fulfillment.resolver.ts)
- [verify-recovery.mjs](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/e2e/cart-commands/verify-recovery.mjs)
- [verify.mjs](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/e2e/cart-commands/verify.mjs)
- [api.spec.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/api.spec.ts)
- [cart-checkout.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/api/cart-checkout.ts)
- [helpers.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/api/helpers.ts)
- [cart-page.spec.tsx](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/cart-page.spec.tsx)
- [cart-controller.spec.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/cart/cart-controller.spec.ts)
- [cart-controller.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/cart/cart-controller.ts)
- [cart-repository.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/cart/cart-repository.ts)
- [useStorefrontAppState.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/hooks/useStorefrontAppState.ts)
- [useStorefrontCartActions.spec.tsx](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/hooks/useStorefrontCartActions.spec.tsx)
- [useStorefrontCartActions.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/hooks/useStorefrontCartActions.ts)
- [cart-page.tsx](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/pages/cart-page.tsx)
- [cart-route-page.tsx](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/route-pages/cart-route-page.tsx)
- [shop-api-errors.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/shop-api-errors.ts)
- [storefront-errors.spec.ts](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/storefront-errors.spec.ts)
- [cart-layout.css](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/packages/storefront/src/styles/cart-layout.css)

## 待办及边界

- 支付提交后响应丢失的订单结果核对：等待用户确认。用户本轮提供的 AGENTS.md 指令要求“修改……支付逻辑前，先询问我”；本次没有修改实际收费逻辑。
- 测试支付配置继续按用户要求跳过。
- 店铺正式营业切换、公开预览提示和生产订单验收未执行；本地代码不会自动改变线上营业状态。
- 发布需要另行授权。本地已保留代码提交，可恢复，不影响主工作区已有未提交改动。

## 设计来源

更新本次购物车恢复来源并保留旧登记历史。桌面无标题、全选在订单摘要、紧凑数量控件保持；其他入口登记未改动。主工作区购物车 WIP 未复制或覆盖。[历史登记](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/previous-design-baselines.json) · [当前候选登记](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/current-design-baselines.json)

## 本地状态截图

![320px待核对状态](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/cart-pending-320.png)

![1440px待核对状态](/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/responsive-three-surfaces-20261008/docs/local-validation/cart-recovery-20261008/cart-pending-1440.png)
