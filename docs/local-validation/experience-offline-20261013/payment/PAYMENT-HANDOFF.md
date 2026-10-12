# 正式人工支付本地完成证据

新正式支付使用 `offline-manual-payment-handler` / `offline-manual-payment-checker`，服务器 `kind=OFFLINE_MANUAL`。提交后为 `PendingManual` / `AwaitingManualPayment`，形成订单号和下单时间，退出购物车；没有核款时不交付、不记返利。保护了 0 金额单。

`confirmOfflinePayment` 验证当前财务岗位、管理员密码、应付金额、实际到账时间、银行交易号、凭证引用和幂等键；锁订单与同店铺收款引用，结算原付款。真实收款业务校验失败保留 `Error` 收款证据，可按原款重核；另有受保护 `prepareOfflinePaymentRefund`，保持业务复核限制，仅开放原款退款，再走原人工退款凭证核验。

历史恢复先 `prepareLegacyOfflineOrder`，在原模拟付款 JSON 留私有关联记录，重报当前价格、数量、税、配送和可用优惠；`submitLegacyOfflineOrder` 要求报价 hash 和正式有效方式。原付款/订单金额/状态保留，真实混合款、退款、发货、领取、发布交付内容不可恢复。并发与重放返回同一关联单。

前台已去固定测试说明；使用商户名称，提交后联系客服/复制订单号/查看待核款订单。后台设置有正式方式入口，订单详情核款与历史逐单恢复入口。查询和敏感写入沿用公共框架，写后读取失败只重试读取。

隔离 MySQL 十个场景按输入与最小依赖组合验收：`offline-payment-complete.log` 的八项业务通过；历史重价夹具使用真实 owned catalog 当前价格更新后 `offline-legacy-quote-final.log` 一项通过；新增有限份数占用过期→释放→收款时库存已无→保收款且无履约→补货重试 `offline-limited-inventory-query-corrected.log` 一项通过。全部为合成店铺、合成客户、合成收款，无真实银行转账。原失败日志保留，没有放宽断言。

Core/cart/store-management/commerce 构建和支付 E2E 类型检查通过；新 HMAC/coupon 付款时间与资源测试通过。前台人工提交/订单确认及既有恢复测试45项通过；后台新面板权限/缺凭证/原款退款/失败读取4项通过。详细日志在同目录；root集中前后台全构建与发布验收。

## 生产配置过渡（由根代理统一执行）

1. 平台读取旧 controlled test 方式的 id、代码、全部翻译、描述、customFields、绑定与启用状态；逐店读 `myStorePaymentOptions`。只处理已确认用于“下单后提交联系客服”的准确店铺映射。
2. 平台 `createPaymentMethod` 建新 `offline-manual-<旧id>` 代码，完整保留商户翻译与描述，handler/checker 使用上述正式代码、空 arguments；沿原全局 enabled 状态。不修改旧 method 或历史 Payment.method，不使用 controlled-test-payment 前缀。
3. 仅对原已开启且已确认正式用途的店铺 `setMyStorePaymentOptionEnabled(newId,true)`；其余店铺默认关闭。确认新 quote.kind、名称与正常提交后，再在这些店铺关闭旧 id 的 switch。平台治理模式不需盲目 assign 到所有 channels。
4. 原模拟单不自动转换，运营逐单复核并通过关联草稿/报价确认恢复。现有账户、密码和敏感字段不写入证据文件。

本代理没有提交、推送、发布、配置生产方式或批量改历史单。root持有最终发布授权与责任。

最后管理端支付／配送设置13项测试、管理端类型检查、支付标签公共工具的零警告 ESLint 通过；`referral-today-time-final.log` 4项通过，断言保持实际到账毫秒值，不比较 Date 实例引用。隔离数据库控制会话36111处于空闲，端口37406与 owned 产物目录保留，关闭由 root统一收敛。

## 最终真实订单接口与隔离实例关闭

原 owner 控制会话完成 `admin-order-projection-owner-scope`（MySQL分类2项通过）及 `admin-order-api-integrated-scale-owner-scope`（完整后台HTTP测试通过）。后者使用真实 Vendure 数据库表与当前完整 `GET_SALES_ORDERS`，1千／1万单每阶段21次完整读取，实际p95为343.65／597.98ms，cold为311.68／394.49ms；每次唯一装载Order20、OrderLine20。查询数量范围分别103–308／103–106，与旧纯投影3查询证据分开报告。原启动、权限、商品规格、schema与真实pool归属失败均分开保留；真实pool归属修复保留跨店supplier供卡。

最终绑定源、夹具、锁文件与canonical依赖证明在 `api-scale-final-evidence.json`；此数据属于本地合成实验，生产p95尚未测量。owner发送shutdown后runner退出0，PID20295与37406监听均消失，数据与报告保留，详见 `mysql-final-api-shutdown.json`。未连接或关闭其他MySQL实例。

额外完成固定底栏与二维码保存两个QA文件的无non-null／无空模拟函数／正确分享方法引用；13项原断言通过，零错误零警告lint通过。原业务UI源码未改。
