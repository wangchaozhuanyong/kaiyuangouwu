# 购物车选中结算技术设计

状态：已实现。`storefront-cart-plugin`、数据库迁移、Shop API、登录合并、支付快照与移动客户端已接入。

## 1. 目标

实现移动端购物车的完整业务闭环：

- 顶部支持全选、半选、取消全选和已选数量。
- 商品可以单独选中或取消，未选商品继续保留在购物车。
- 底部商品金额、优惠金额和结算数量只对应已选商品。
- 提交订单、运费、优惠、库存和支付金额只计算已选商品。
- 游客登录后合并购物车，多标签页修改不会静默覆盖。
- 支付成功后只扣除本次购买的数量，未选商品不受影响。

本方案只解决“一个商家域名对应一个 Channel”的店铺购物车，不包含跨 Channel、跨商家的聚合订单。当前 multivendor 示例插件未启用，不能混入本期设计。

## 2. 已确认的 Vendure 约束

1. Vendure `Session` 原生只有一个 `activeOrderId`。
2. 默认 `activeOrder` 同时承担购物车、优惠计算、配送和支付订单职责。
3. Order 的价格、优惠、运费、库存检查和支付默认覆盖它的全部 OrderLine。
4. `DefaultActiveOrderStrategy` 会验证 Order 属于当前 Channel，并在登录时合并游客与客户的活动订单。
5. 现有客户端直接调用 `addItemToOrder`、`adjustOrderLine` 和 `removeOrderLine`，没有独立的选择状态。

因此，只在前端增加复选框只能改变显示，不能保证服务端支付金额只包含选中商品。

## 3. 方案选择

### 3.1 采用方案

新增独立的 Storefront Cart 作为“全部待购商品”的唯一来源；Vendure active Order 只保存当前已选商品，作为价格和结算投影。

```text
Storefront Cart
  ├─ 未选商品：只保存在 CartLine
  └─ 已选商品：保存在 CartLine
         ↓ 同步
Vendure active Order
  ├─ 计算活动优惠和税费
  ├─ 计算配送资格与运费
  ├─ 校验库存
  └─ 进入支付状态机
```

优点：

- 未选商品不会进入支付订单，也不需要支付后重新加回。
- 继续使用 Vendure 原生 Order 金额、Promotion、Shipping 和 Payment 能力。
- 不修改 Vendure Core 的价格计算逻辑，升级风险更低。
- 能兼容现有的实物、虚拟和混合订单插件。

### 3.2 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 仅在前端保存勾选状态 | 服务端 Order 仍包含全部商品，金额和支付范围错误 |
| 结算前删除未选项，结束后重新加回 | 支付跳转、会话失效或库存变化时可能丢商品，优惠也会重新计算 |
| 在 OrderLine 增加 `selected` 后让价格计算忽略未选项 | 需要改造价格、税、优惠、配送、库存、支付和履约多条核心链路 |
| 同一会话维护两个 active Order | Session 原生只有一个 `activeOrderId`，所有原生 mutation 都需额外路由，复杂度和误操作风险高 |

## 4. 建议数据模型

以下字段已落地到 `packages/storefront-cart-plugin/src/entities`，对应迁移为 `1786517100000-add-storefront-cart.ts`。

### 4.1 StorefrontCart

| 字段 | 用途 |
| --- | --- |
| `id` | 购物车 ID |
| `channelId` | 强制隔离商家店铺 |
| `ownerType` | `SESSION` 或 `CUSTOMER` |
| `ownerId` | 服务端从当前会话或客户推导，不接受浏览器指定 |
| `revision` | 乐观并发版本，每次有效修改加一 |
| `state` | `OPEN`、`PAYMENT_PENDING` |
| `checkoutOrderId` | 当前已选商品对应的 Vendure Order，可为空 |
| `projectedRevision` | active Order 已同步到的购物车版本 |
| `lastActivityAt` | 匿名购物车过期清理依据 |

唯一约束：`channelId + ownerType + ownerId`。

游客 `ownerId` 使用服务端 Session ID，不保存 Session token；登录客户使用 Customer ID。`ownerId` 不建立到 Session 的外键，因为 Vendure 登录时会先删除旧匿名 Session；匿名购物车由合并流程和过期任务负责清理。所有查询同时校验当前 Channel 与当前所有者。

### 4.2 StorefrontCartLine

| 字段 | 用途 |
| --- | --- |
| `cartId` | 所属购物车，删除购物车时级联删除 |
| `productVariantId` | Vendure ProductVariant |
| `quantity` | 购物车数量 |
| `selected` | 是否参与当前结算 |
| `orderLineId` | 当前投影 Order 中的对应行，可为空 |

一期一个 Variant 在一个购物车中只保留一行，唯一约束为 `cartId + productVariantId`。价格和库存不落购物车快照，读取和结算时始终以当前 Channel 的服务端结果为准。

如果以后支持刻字、上传文件等定制商品，再增加结构化定制输入及稳定 fingerprint，不能直接把任意 JSON 当作唯一键。

### 4.3 StorefrontCartCheckout

| 字段 | 用途 |
| --- | --- |
| `cartId` | 来源购物车 |
| `orderId` | 本次 Vendure Order，唯一 |
| `cartRevision` | 创建结算快照时的购物车版本 |
| `state` | `PREPARED`、`PLACED`、`ABANDONED` |
| `createdAt` / `completedAt` | 审计与补偿任务依据 |

### 4.4 StorefrontCartCheckoutLine

| 字段 | 用途 |
| --- | --- |
| `checkoutId` | 所属结算快照 |
| `cartLineId` | 来源行；购物车行删除后允许为空 |
| `productVariantId` | 本次购买的 Variant 快照 |
| `quantity` | 本次实际准备购买的数量 |

结算行快照用于支付成功后的精确扣减。若用户支付期间把同一商品从 2 件增加到 3 件，本次支付成功只扣除快照中的 2 件，购物车仍保留 1 件。

## 5. Shop API 设计

Shop API 不接收 `channelId`、`customerId`、`sessionId` 或任意 Order ID。服务端一律从 `RequestContext` 确定店铺和所有者。

### 5.1 查询

```graphql
storefrontCart: StorefrontCart!
```

返回至少包括：

- `revision`
- `state`
- `lines`
- `totalQuantity`
- `selectedLineCount`
- `selectedQuantity`
- `selectionState`：`NONE`、`PARTIAL`、`ALL`
- `checkoutOrder`：已选商品的 Vendure Order，用于读取精确商品小计、折扣、税费和当前配送金额

### 5.2 修改

```graphql
addStorefrontCartItem(input, expectedRevision): StorefrontCartResult!
setStorefrontCartLineQuantity(lineId, quantity, expectedRevision): StorefrontCartResult!
removeStorefrontCartLines(lineIds, expectedRevision): StorefrontCartResult!
setStorefrontCartLinesSelected(lineIds, selected, expectedRevision): StorefrontCartResult!
setAllStorefrontCartLinesSelected(selected, expectedRevision): StorefrontCartResult!
beginStorefrontCheckout(expectedRevision): StorefrontCheckoutResult!
prepareStorefrontCartPayment(expectedRevision): StorefrontCheckoutResult!
reopenStorefrontCart(expectedRevision): StorefrontCartResult!
```

规则：

- 修改数量使用绝对值，不使用“加一后的数量”作为最终输入。
- 新加入的 CartLine 默认选中，符合常见购物流程。
- 每个 mutation 都携带 `expectedRevision`，事务内通过带 revision 条件的原子更新抢占新版本，不依赖特定数据库的悲观锁语法。
- 版本不一致时返回 `CartRevisionConflictError`，客户端刷新购物车，不自动覆盖另一标签页的操作。
- 第一次请求已成功但响应丢失时，原 `expectedRevision` 的重试只会产生冲突，不会重复加购。
- GraphQL 返回 ErrorResult union，客户端必须按 `__typename` 显式处理。

建议错误类型：

- `CartRevisionConflictError`
- `CartLineNotFoundError`
- `CartLineUnavailableError`
- `CartEmptySelectionError`
- `CartCheckoutLockedError`
- `CartProjectionError`

## 6. active Order 同步算法

每次购物车内容或选择发生变化，都在同一事务中执行以下步骤：

1. 根据当前 Channel 和 owner 查询 `StorefrontCart`。
2. 用 `id + expectedRevision + state` 条件执行 revision 原子更新；没有更新到记录即返回冲突。
3. 保存本次 CartLine 修改并将 `revision` 加一。
4. 加载所有已选 Variant，并确认启用、属于当前 Channel、可售且数量有效。
5. 获取 `checkoutOrderId` 对应的活动订单；不存在时通过 `OrderService.create()` 创建。
6. 确保该 Order 属于当前 Channel 和当前会话/客户。
7. 将选中 CartLine 与 OrderLine 对齐：新增缺少行、调整绝对数量、删除已取消选择的行。
8. 更新 CartLine 的 `orderLineId` 和 Cart 的 `projectedRevision`。
9. 通过 `SessionService.setActiveOrder()` 将投影订单设为当前会话的 active Order。
10. 返回包含最新 `checkoutOrder` 的购物车。

任何一步失败都回滚购物车和 Order 修改。不能出现“复选框已取消但服务端订单仍保留该商品”的半成功状态。

若检测到 Order 中存在无法映射到 CartLine 的外部行，返回投影错误并重新构建，不把未知商品带入支付。新移动端接入后，加购和改量必须统一走 Storefront Cart API，不再直接调用原生 OrderLine mutation。

`projectedRevision` 只能减少重复同步，不能作为安全凭据。进入确认订单和准备支付时都必须把选中 CartLine 与实际 OrderLine 逐行核对 Variant、数量和归属；发现不一致时，以 Cart 为准重新同步。

## 7. 页面状态规则

| 购物车情况 | 顶部状态 | 结算按钮 | 金额显示 |
| --- | --- | --- | --- |
| 没有商品 | 不显示选择控件 | 禁用 | `¥0` |
| 有商品但未选 | 未选中，“全选”，数量 0 | 禁用 | `¥0` |
| 部分选中 | 半选状态，“已选 N” | `结算（N）` | 投影 Order 的已选商品小计与优惠 |
| 全部选中 | 已选中，“全选 N” | `结算（N）` | 投影 Order 的全部商品小计与优惠 |

`N` 使用 `selectedQuantity`，即选中商品件数之和；商品种类数另用 `selectedLineCount`，两者不混用。点击已选中的“全选”控件会取消全部选择，无需再增加一个常驻“取消”文字按钮。

购物车页的金额是已选商品金额；运费在地址和配送方式确定前显示“结算页计算”，不能伪造包邮结果。

## 8. 结算与支付生命周期

### 8.1 进入确认订单

`beginStorefrontCheckout`：

1. 校验至少有一项选中，并确认 active Order 已同步到当前 revision。
2. 返回 active Order，前端进入确认订单页面。
3. 此时 Order 保持 `AddingItems`，客户仍可返回购物车修改。
4. 地址、配送和优惠码继续使用 Vendure 原生 mutation。

### 8.2 提交支付

`prepareStorefrontCartPayment`：

1. 再次锁定购物车并校验 revision、价格、库存、地址和配送。
2. 将选中 CartLine 与 OrderLine 做一次强制逐行对账。
3. 创建 `StorefrontCartCheckout` 与 CheckoutLine 快照。
4. 将购物车状态设为 `PAYMENT_PENDING`。
5. 将 Order 转换到 `ArrangingPayment`。
6. 返回 Order，客户端再调用 `eligiblePaymentMethods` 和 `addPaymentToOrder`。

同一 cart revision 和同一 Order 重复调用时返回已有快照，不创建第二个支付订单。

插件同时注册一个附加 OrderProcess 校验：凡是关联 Storefront Cart 的 Order 从 `AddingItems` 进入 `ArrangingPayment`，必须已存在与当前 Order、Cart revision 和选中行完全匹配的 `PREPARED` Checkout 快照。这样旧客户端或直接调用原生 `transitionOrderToState` 不能绕过购物车结算边界。

### 8.3 支付成功

使用 `registerBlockingEventHandler` 监听 `OrderPlacedEvent`，只处理存在 Checkout 快照的订单：

1. 锁定 Checkout 和 Cart。
2. 若 Checkout 已是 `PLACED`，直接结束，保证幂等。
3. 按 CheckoutLine 数量从当前 CartLine 扣减；结果为 0 时删除该行。
4. 清空 CartLine 上属于已完成 Order 的 `orderLineId`。
5. Checkout 标记为 `PLACED`，Cart 回到 `OPEN`，清空 `checkoutOrderId`。
6. revision 加一并提交事务。

该处理必须快速、事务化且幂等。另加定时补偿任务，扫描“订单已完成但 Checkout 未标记 PLACED”的记录，处理进程中断等极端情况。

### 8.4 支付失败、取消和返回修改

- 支付失败但 Order 仍可重试时，购物车保持 `PAYMENT_PENDING`，不删除商品。
- `reopenStorefrontCart` 只在没有已授权或已结算支付时允许执行。
- 可返回时把 Order 从 `ArrangingPayment` 转回 `AddingItems`，Checkout 标记 `ABANDONED`，然后恢复编辑。
- 已授权、已结算或状态未知时禁止修改，前端进入支付结果查询，不自行判定失败。

## 9. 游客、登录和退出

### 9.1 游客

- 使用当前匿名 Session ID 作为服务端 owner key。
- 浏览器不保存或传递数据库 Session ID。
- 同一域名下沿用 Vendure 会话 Cookie，刷新后购物车可恢复。

### 9.2 登录合并

Vendure 登录成功前会先合并游客与客户的 active Order，之后发布 `LoginEvent`。插件使用阻塞事件处理器执行购物车合并：

1. 通过事件上下文取得旧匿名 Session ID，通过 User 查询当前 Customer。
2. 锁定该 Channel 下的游客购物车与客户购物车。
3. 相同 Variant 的数量相加；任一来源已选中时，合并结果为选中。
4. 获取 Vendure 已合并的客户 active Order，并关联到合并后的 Storefront Cart；不要再尝试更新已经被登录流程删除的旧匿名 Session。
5. 再执行一次投影同步，确保 Order 与合并后的选择完全一致。
6. 删除游客购物车，保留客户购物车。

合并处理必须幂等。若同一事件重试，不能再次叠加数量。

### 9.3 退出

- 客户购物车继续归客户所有，不复制给退出后的匿名用户。
- 退出后首次加购创建新的匿名购物车。
- 再次登录时按上述规则合并。

## 10. Channel 与安全边界

- 每次 Cart、CartLine、Checkout 和 Order 查询都包含 `ctx.channelId` 条件。
- Variant 必须重新确认分配给当前 Channel，不能只相信前端提交的 ID。
- 所有 owner 信息由服务端从 RequestContext 推导。
- Order 必须同时匹配购物车 Channel、所有者和当前活动状态。
- 外部域名只负责确定 Channel；语言请求头不能改变购物车归属。
- 不把生产 Channel token、Session token、支付密钥或内部 owner key暴露到页面。
- 匿名购物车按 `lastActivityAt` 定期清理；已关联支付或未完成订单的记录不能直接删除。

## 11. 兼容现有购物车

上线时不能让已有 `activeOrder` 中的商品消失。首次调用 `storefrontCart` 时执行一次兼容导入：

1. 当前 owner 尚无 Storefront Cart 时查询原生 active Order。
2. 将每个 OrderLine 导入为默认选中的 CartLine，并保存对应 `orderLineId`。
3. 将该 Order 设置为 `checkoutOrderId`，写入当前投影版本。
4. 后续所有修改切换到新的 Storefront Cart API。

导入必须是事务和幂等操作；重复请求不能重复数量。

## 12. 测试矩阵

### 单元测试

- 空、无选、半选、全选的数量和状态计算。
- 加购、绝对数量修改、删除和选择切换的 revision 变化。
- 同 revision 并发请求只允许一个成功。
- Checkout 快照扣减数量，重复事件不重复扣减。
- 游客与客户购物车合并不重复、不丢未选商品。

### 集成测试

- CartLine 只能读取当前 Channel 的 Variant。
- 选择变化后 OrderLine、优惠和商品小计同步。
- 缺货、禁用、删除、超限商品阻止结算并返回具体行错误。
- 实物、虚拟、混合订单继续返回正确的配送要求。
- 地址、配送方式、优惠码、状态转换和支付使用同一个投影 Order。
- 支付成功、失败、取消、重试和返回修改的 Cart/Checkout 状态正确。
- 登录时 Vendure Order 合并与 Storefront Cart 合并结果一致。

### 端到端测试

- 选 2 件、留 1 件未选，支付后未选商品仍在购物车。
- 同一商品选 2 件，支付期间增加到 3 件，成功后剩 1 件。
- 两个标签页同时改数量，后提交页面收到冲突并刷新。
- 中文/英文切换不改变选择、数量、币种和 Order。
- 两个商家域名无法交叉读取购物车或订单。
- 320px 宽度下全选、数量、金额和结算按钮不重叠。

## 13. 实施拆分

经批准后按以下顺序开发，每一步单独检查：

1. 新建 `storefront-cart-plugin` 包、实体、迁移和基础权限边界。
2. 实现 Cart service、事务锁、revision 和 active Order 投影同步。
3. 实现 Shop API、错误 union、登录合并和旧 active Order 导入。
4. 实现 Checkout 快照、OrderPlaced 清理及补偿任务。
5. 将 `packages/storefront` 的加购、改量、删除和选择切换迁移到新 API。
6. 接入确认订单与真实支付流程。
7. 补齐单元、集成与移动端端到端测试。

## 14. 需要确认

本方案已实现并通过 SQL.js 真实 Shop API 流程验证。正式上线前仍需在目标数据库运行迁移，并接入真实支付方式。店铺装修和售后系统不在本次范围内。
