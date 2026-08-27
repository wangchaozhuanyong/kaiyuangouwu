# USDT 展示与 TRC20 自动到账说明

## 当前已完成

- 客户端币种选择器支持 `CNY`、`MYR` 和虚拟展示币种 `USDT`。
- 商品、购物车和结账金额切换到 USDT 后按参考汇率显示；订单账务仍保存为 CNY 或 MYR。
- 后台每 5 分钟读取 Binance 与 OKX P2P 中“客户购买 USDT、商家出售 USDT”的广告。
- 每个平台独立筛选高完成率、高成交量的认证商家，剔除偏离平台中位价 3% 以上的异常值，再对两个平台中位价等权合并。
- 单一平台临时不可用时使用另一平台；两个平台中位价偏差超过 5% 时停止更新，继续使用尚未过期的上一轮报价。
- MYR/USDT 使用双源 CNY/USDT 报价与 Bank Negara Malaysia 的 CNY/MYR 汇率推导。
- 报价超过 15 分钟自动失效，客户端不再提供 USDT 切换。
- 进入支付页后生成服务器端持久化的 10 分钟锁价快照；订单金额变化或返利抵扣后会生成新报价。
- 每个报价增加百万分之一 USDT 级别的订单专属尾数，同一收款地址 7 天内不重复。
- 后台每分钟查询一次 TRON 已确认转账，并通过 SolidityNode 收据再次确认交易已经固化成功。
- 确认收款地址、官方 USDT 合约、精确金额、到账时间及交易哈希均正确后，自动把 Vendure 付款结算并将订单推进到待发货。
- 客户端不能提交“我已付款”来改变订单状态；只有服务器生成的短时 HMAC 凭证能够创建已结算付款。

## 收款钱包防篡改

收款地址只读取服务器环境变量 `STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS`，没有 Admin API、Shop API 或 Dashboard 修改入口。生产环境启用地址时，还必须提供 `STOREFRONT_USDT_TRC20_ADDRESS_SHA256`；地址与固定指纹不一致会拒绝启动。

离线生成指纹示例：

```bash
STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS=T... bun -e 'import { createHash } from "node:crypto"; const address = process.env.STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS ?? ""; console.log(createHash("sha256").update(`storefront-usdt-wallet:v1:${address}`).digest("hex"))'
```

必须由第二名发布审核人员对照钱包 App 中的完整地址、环境变量地址和页面显示的前 16 位校验码。拥有服务器代码和全部部署密钥的攻击者仍可修改程序本身，因此生产主机权限、CI/CD 审批和密钥管理仍然属于安全边界。

## 正式开放前必须配置

1. 填写公开的 TRC20 收款地址；不要把私钥、助记词或钱包密码放入服务器。
2. 生成并独立复核地址 SHA-256 指纹。
3. 生成独立的 `USDT_PAYMENT_PROOF_SECRET`，API 与 Worker 必须使用同一个值。
4. 建议申请只读 `TRONGRID_API_KEY`，API 与 Worker 使用同一个收款地址配置。
5. 执行数据库迁移并启动 Vendure Worker；没有 Worker 就不会自动补扫到账。
6. 使用小额真实 USDT 完成一次端到端验收，确认订单只进入“待发货”，不会直接标记为“已发货”。

## 需要人工处理的情况

- 少付、多付、锁价超时后到账、发错网络或订单金额在付款前发生变化。
- 区块交易已经到账，但 Vendure 订单因优惠券失效等原因无法按原金额结算；系统会标记为 `MANUAL_REVIEW`，不会重复入账。
- 退款不会自动从钱包转出，避免服务器持有私钥；必须人工复核后从安全钱包处理。

## OKX 数据源注意事项

当前 OKX 报价来自 OKX 官方 P2P 市场页面使用的公开只读接口，不需要账户、API Key 或交易权限。该接口不是 OKX API v5 中承诺稳定的正式 P2P API，可能调整字段或访问规则；系统已设置 Binance 单源降级和 15 分钟失效保护，但上线后仍需监控报价来源及刷新失败告警。如后续取得 OKX 正式商家 P2P API，应优先切换到正式接口。
