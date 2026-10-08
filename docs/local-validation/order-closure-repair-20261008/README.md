# 下单及后台闭环修复：本地验收

状态：代码完成、本地验证完成；未推送、未合并、未部署，未操作真实订单、支付、退款或库存。

项目：Vendure。工作区：`.codex-worktrees/responsive-three-surfaces-20261008`，分支：`fix/responsive-three-surfaces-20261008`。本轮起点为 `aed52cc975e1144496256d4519904ecc4f9df65d`，保留此前购物车异常恢复、物流选择及三处响应式修复。主工作区的其他未提交修改未复制或覆盖。

## 已修复范围

| 审计问题 | 处理结果 |
| --- | --- |
| 付款响应丢失后可重复提交 | 原尝试锁定；只允许核对原订单结果，确认成功后的导航或读回失败不会重新开放付款 |
| 余额抵扣与普通付款可并发 | 同一个同步操作锁，连续点击和表单提交最多发起一次写入 |
| 刷新丢失付款核对状态 | sessionStorage 仅保存非秘密的原订单、币种与尝试摘要；本人订单只读核对，不保存确认 token、登录信息或付款凭据 |
| 核对付款成功后返回页面出现旧入口 | 同步全局最新订单；离开再返回仍显示已确认，不再次提交 |
| 切换展示币种导致原付款核对失效 | 原订单币种贯穿本人订单和确认回执查询，继续复用现有身份客户端 |
| 换算币种导致确认付款被拒绝 | 按订单币种和现有价格策略校验，不增加数据库价格或新币种配置 |
| USDT 核对准备失败无恢复入口 | 显示准备错误并仅重试确认 token；不重复报价或付款；请求有超时和原尝试范围保护 |
| 两个退货入口重复入库 | 锁定订单及申请；旧入口仅处理历史申请，新流程读取旧入库回执，仅入库新增验收数量 |
| 售后关联错误商品退款也可结束 | 核对商品行及数量；分拆退款按实际退款行合并；仅退款的纯金额补偿保留既有支持 |
| 退款后重试交付重新占用已退款数量 | 只重新占用未退款部分；全退不重新占库存、包装或数字资源，并保留人工核对状态 |
| 调拨重试产生新操作身份 | 保留原参数、引用与幂等键；结果未知先查原流水，确认成功后只读刷新 |
| 批量发货后读回失败又允许写入 | 保留固定订单和输入；区分已确认、待核对及只读刷新，避免复用可编辑旧表单重复写入 |
| 售后写入成功但读回失败显示提交失败 | 已确认写入与读回失败分开反馈；恢复操作只刷新 |
| 只读人员仍看到售后写入操作 | 根据现有权限隐藏或禁用写入入口；没有修改登录或权限模型 |
| 订单通知重连后列表陈旧 | SSE 就绪/重连使已有订单与相关库存资源失效并读回 |
| 换货/补发登记未扣库存 | 在现有事务内完成店铺归属、真实资金与订单状态校验、可用库存及批次检查、补发出库流水；同一申请重跟踪不重复扣库存 |
| 发货输入带入 Apollo 附加字段而被真实接口拒绝 | 单笔和批量共享输入只输出 orderLineId、quantity，实际 GraphQL 输入校验回归通过 |

补发复用现有库存表、流水、事务与操作字段。新增的是已有 VARCHAR 操作类型的 TypeScript 枚举值，没有数据库迁移、公开接口、依赖或环境变量变更。历史回执和数据保留。

## 实际验证

- 本轮累计 **510 个唯一有效测试通过**，重跑与失败定位不重复计数：前台193、订单/付款/资源与交付167、管理后台94、退货/售后与补发库存56。
- 后端两个受影响包 TypeScript 与构建通过；前台完整构建（含两步验证独立入口、字体、路由、显示语言和体积检查）通过；管理后台完整构建及其反馈/架构/挂载检查通过。
- 修改范围内 lint 无错误；管理后台保留一项既有组件导出警告。格式及 git diff 检查通过。前台构建保留既有动态/静态重复导入警告，不阻断构建。
- **38 个本地浏览器功能场景通过**：真实 PaymentPage 32 个组合，真实后台发货/售后/调拨页面6个组合。使用内存模拟接口和样本订单，不连接真实 API、支付、客户或库存。
- 前台覆盖390/1440px、中英文、classic/neo-minimalist，以及未知付款、USDT核对重试、余额并发、展示币种切换。80次布局检查无横向溢出；无页面异常、控制台警告错误或外网业务请求。
- 前台分两批各16项：第一批USDT/余额，第二批未知付款/币种恢复。每批48个来源文件指纹前后稳定；批次间只有无 token 的 paid 分支新增 `onOrderChange(latest)` 一行及对应回归测试。该分支不影响第一批两场景，第二批验证了返回重挂无付款入口。没有将两批声称为同一个源码指纹。
- 后台覆盖390/1440px，使用实际Apollo链和GraphQL输入校验：调拨丢失响应保留原参数/键、发货与售后已确认后读回失败只刷新；无异常或横向溢出。

精简结构化记录：[local-receipt.json](local-receipt.json)。选定页面截图位于本目录。原始浏览器夹具、逐项截图和每批来源记录仍保留于候选工作区 `packages/storefront/tmp/order-closure-browser/` 与 `packages/next-admin/tmp/order-recovery-browser/`，没有暂存整个 tmp 目录。

## 验证边界及剩余事项

当前结论适用于上述修复的代码和本地模拟。未执行真实支付/退款、线上后台操作、真实多连接数据库并发及整个应用硬刷新 bootstrap；本地缓存清空+重挂覆盖恢复状态丢失路径。实际支付配置、网关回调、资金到账以及发布后的完整下单/退款/库存闭环仍需在获准发布后单独验收。

保留一项非阻塞呈现问题：390px英文USDT错误说明与较长重试按钮并排，说明列偏窄；没有裁切、重叠或横向溢出，按钮可操作。此次未扩大为共享错误组件改版。

支付恢复已按本轮用户明确授权修复。店铺上线设置、真实支付测试、统一发布以及此前其他工作区的修改不混入本次交付。主仓库共享来源登记仅新增本次付款恢复条目，保留旧设计登记与未提交工作。


## 修改文件

- `packages/catalog-management-plugin/src/entities/inventory-operation.entity.ts`
- `packages/catalog-management-plugin/src/inventory-control.service.spec.ts`
- `packages/catalog-management-plugin/src/inventory-control.service.ts`
- `packages/commerce-fulfillment-plugin/src/after-sales.service.spec.ts`
- `packages/commerce-fulfillment-plugin/src/after-sales.service.ts`
- `packages/commerce-fulfillment-plugin/src/checkout-resources.service.spec.ts`
- `packages/commerce-fulfillment-plugin/src/checkout-resources.service.ts`
- `packages/commerce-fulfillment-plugin/src/commerce-order-process.spec.ts`
- `packages/commerce-fulfillment-plugin/src/commerce-order-process.ts`
- `packages/commerce-fulfillment-plugin/src/physical-return.service.ts`
- `packages/next-admin/src/components/OrderNotifications.spec.tsx`
- `packages/next-admin/src/components/OrderNotifications.tsx`
- `packages/next-admin/src/pages/Catalog/InventoryControlModule.tsx`
- `packages/next-admin/src/pages/Catalog/InventoryLotDialog.spec.tsx`
- `packages/next-admin/src/pages/Catalog/InventoryWarehouseModule.tsx`
- `packages/next-admin/src/pages/Sales/AfterSalesModule.tsx`
- `packages/next-admin/src/pages/Sales/PhysicalReturnPanel.tsx`
- `packages/next-admin/src/pages/Sales/SalesModule.tsx`
- `packages/next-admin/src/pages/Sales/admin-mobile-lists.spec.tsx`
- `packages/next-admin/src/pages/Sales/sales-utils.spec.ts`
- `packages/next-admin/src/pages/Sales/sales-utils.ts`
- `packages/next-admin/src/runtime/admin-resource-events.spec.ts`
- `packages/next-admin/src/runtime/admin-resource-events.ts`
- `packages/storefront/src/api.spec.ts`
- `packages/storefront/src/api.ts`
- `packages/storefront/src/api/account.ts`
- `packages/storefront/src/api/base-domain-api.ts`
- `packages/storefront/src/api/cart-checkout.ts`
- `packages/storefront/src/api/client-context.ts`
- `packages/storefront/src/api/referrals.ts`
- `packages/storefront/src/payment-balance-completion.spec.tsx`
- `packages/storefront/src/payment-currency-page.spec.tsx`
- `packages/storefront/src/payment-pages.tsx`
- `packages/next-admin/src/pages/Sales/AfterSalesModule.spec.tsx`

## 本地保存与来源核对

代码提交：`5d5aa0ee9149232351926db473710361094ff698`，未推送。提交钩子使用已有 lintFiles 范围，覆盖全部34个暂存源码/测试文件，未关闭钩子；默认准备轮次扫描了不属 TypeScript 项目的未暂存浏览器夹具而失败，该失败未冒充产品检查通过。

新增 storefront-payment-recovery 来源登记，旧83条完整保留；19个生产源文件与登记提交一致，5428预览服务实际目录为当前候选，来源检查通过。源码指纹与验收输入一致。检查结束后仅关闭自有预览服务，原始样本和记录保留。
