# 移动端客户端与 Vendure 后端能力对照

## 1. 文档目的

本文把已经确认的移动端高保真方案转换成可开发、可验收的功能清单，避免页面先做完后才发现后台没有对应能力。

当前客户端范围：

- 底部固定导航：首页、商品、购物车、我的。
- 补充页面：搜索、商品详情、确认订单、支付结果、订单列表、订单详情、物流、地址、登录注册。
- 一个外部域名对应一个 Vendure Channel，商家数据按 Channel 隔离。
- 中文/英文是当前店铺内的界面与内容语言切换，不应顺带切换到另一个店铺或市场。

## 2. 当前项目基线

| 项目项 | 当前状态 |
| --- | --- |
| 前端 | `packages/storefront`，React 19 + TypeScript + Vite 7 |
| 后端 | Vendure / NestJS / GraphQL Shop API |
| 包管理器 | Bun，仓库使用 `bun.lock` |
| 店铺域名 | `StoreDomainPlugin` 已接入开发配置，可将已验证域名路由到 Channel |
| 实物/虚拟商品 | `CommerceFulfillmentPlugin` 已接入，可识别 physical / digital / mixed 订单 |
| 搜索 | `DefaultSearchPlugin` 已启用，但当前前端仍一次读取 100 个商品后在浏览器过滤 |
| 支付 | 开发环境是 `dummyPaymentHandler`；客户端只推进到 `ArrangingPayment`，没有真实支付闭环 |
| 评价 | 开发配置启用了测试性质的 `ReviewsPlugin`，不能直接视为生产评价系统 |
| 多商家订单 | 仓库内有 multivendor 示例插件，但开发配置未启用，不能视为现成功能 |

能力标记：

- **现有**：Vendure 或本项目插件已经提供，主要工作在客户端接线。
- **前端**：不依赖新增后端能力。
- **配置**：后端已有能力，但必须先完成后台数据或生产配置。
- **扩展**：需要新增 Shop API、插件、实体、自定义字段或索引能力。

## 3. 总体调用链

```text
商家外部域名
  -> 入口层完成 TLS 并保留原始 Host
  -> StoreDomainPlugin 校验 Host 并选择 Channel
  -> /shop-api 创建对应 Channel 的请求上下文
  -> language-code 选择该 Channel 内的中文或英文翻译
  -> 移动端渲染商品、价格、库存、购物车和订单
```

生产环境不得由浏览器发送公开 Channel token。域名是店铺身份，`language-code` 只负责语言，两者必须解耦。

## 4. 页面功能对照

### 4.1 全局框架

| 功能 | 能力 | 后端/实现依据 | 开发结论 |
| --- | --- | --- | --- |
| 底部四栏导航 | 前端 | React 路由与固定导航 | 一期实现；页面切换保留各页滚动位置 |
| 首页 Logo 与店铺名 | 现有 + 配置 | Channel 的 `storefrontNameZh` / `storefrontNameEn` 自定义字段 | 客户端按当前语言读取对应网站名称，未配置时使用兼容默认值 |
| 中文/英文点击切换 | 现有 + 前端 | Shop API 支持 `language-code` | 一期实现；只切语言，不切 Channel/币种 |
| 消息通知入口 | 扩展 | Vendure Core 没有客户消息收件箱 | 一期只保留入口/空状态；消息中心放二期 |
| 骨架屏、错误、空状态、重试 | 前端 | 当前客户端已有基础加载和错误状态 | 四个主页面及弹层统一实现 |
| 安全区与固定底栏 | 前端 | CSS `env(safe-area-inset-*)` | 一期实现，覆盖小屏与全面屏 |
| 域名绑定店铺 | 现有 + 配置 | `StoreDomainPlugin` | 上线前完成 DNS、TXT 验证、泛域入口和自动证书 |

### 4.2 首页

| 区域 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 顶部 Logo、店铺名 | 现有 + 配置 | Shop API 的 `activeChannel.customFields` | 管理后台按 Channel 维护中英文网站名称，客户端切换语言时同步更新 |
| 中间搜索框 | 现有 | `search(input: SearchInput!)` | 改为服务端搜索、分页、防抖和取消旧请求 |
| 语言与通知 | 现有/扩展 | 语言现有，通知缺少后端 | 一期语言可用，通知先空状态 |
| 轮播广告 | 扩展 | Vendure Core 无首页广告位 | 店铺装修插件按 Channel、语言、有效期下发 |
| 通知条 | 扩展 | 无公开内容接口 | 与轮播统一管理，不另造一套配置 |
| 金刚区 | 扩展 + 现有 | 展示配置缺失；目标可关联 Collection | 配置图标、名称、排序、Collection/链接目标 |
| 优惠活动区 | 部分现有 | 订单能应用优惠码，但没有“可领取优惠券列表” | 一期支持输入/应用优惠码；领券中心放二期 |
| 限时精选/倒计时 | 扩展 | Shop API 不公开活动开始结束时间 | 装修插件下发活动窗口，倒计时由前端计算 |
| 推荐商品 | 配置/扩展 | 可用 Collection 做人工推荐；无个性化推荐 | 一期用运营 Collection，个性化放三期 |
| 内容故事/灵感 | 扩展 | 无内容模型 | 一期可纳入装修区块，避免写死在前端 |
| 页尾条款 | 前端 + 配置 | 链接目标需配置 | 展示隐私政策、服务条款，缺失时不显示假链接 |

建议新增一个统一的店铺装修能力，不分别为轮播、公告、金刚区创建零散接口。建议职责如下，字段名称需在真正开发插件时再评审确认：

- 数据按 Channel 隔离，并支持语言翻译。
- 支持区块类型、启停时间、排序、图片、标题、副标题和跳转目标。
- 跳转目标使用结构化类型：Collection、Product、内部页面或已校验外链。
- Dashboard 提供预览、上下线、排序和移动端图片裁切提示。

### 4.3 商品分类与列表

| 功能 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 一级分类横向滑动 | 现有 + 前端 | `collections` / Collection 层级 | 一期实现滚动吸附、当前项自动居中、边缘渐隐提示 |
| 二级分类左栏 | 现有 | Collection 父子层级 | 点击一级分类后只加载/显示对应子分类 |
| 右侧顶部小广告 | 扩展 | 缺少分类广告位 | 纳入店铺装修插件，绑定 Collection |
| 右侧商品列表 | 现有 | `search` 支持 Collection、分页 | 图片左、信息右；使用 `take/skip` 分页，不再一次取 100 件 |
| 综合排序 | 现有 | 搜索相关度 `score` | 搜索词场景用相关度；无搜索词时用运营默认顺序 |
| 价格排序 | 现有 | `SearchResultSortParameter.price` | 一期直接支持升序/降序 |
| 新品排序 | 扩展 | Search API 原生只支持 name/price 排序 | 需要索引 `createdAt` 或独立新品 Collection |
| 销量排序 | 扩展 | Search API 没有销量字段 | 需要聚合销量并写入搜索索引；不能在浏览器伪排序 |
| 库存筛选 | 配置 | Default Search 支持 `inStock` 扩展，但当前 `indexStockStatus` 为 false | 若一期启用，需调整搜索插件配置并重建索引 |
| 颜色/类型等筛选 | 现有 + 配置 | Facet / FacetValue | 商家后台必须规范维护 Facet，前端按返回值动态生成筛选项 |
| 价格区间 | 扩展 | 原生 `SearchInput` 没有最低/最高价格 | 需扩展搜索输入与索引；禁止拉全量后前端过滤 |
| 加载更多 | 现有 + 前端 | `totalItems`、`take`、`skip` | 一期实现触底加载、失败重试、无更多状态和防重复请求 |

### 4.4 商品详情

| 功能 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 商品图片、价格、规格、库存 | 现有 | `product`、ProductVariant、Asset | 一期直接接入；切规格同步价格、图片、库存 |
| 实物/虚拟标识 | 现有插件 | `fulfillmentType` | 一期显示，并影响结算必填项 |
| 优惠价格与订单优惠 | 现有 | Promotion 计算进入价格/订单折扣 | 显示以后端金额为准，不由前端自行算折扣 |
| 可领优惠券 | 扩展 | 没有客户优惠券钱包 | 二期实现 |
| 配送地址与运费预估 | 部分现有 | 运费资格依赖 active Order 与地址 | 一期在加入订单后精确计算；详情页未入车预估需扩展 |
| 参数/保障说明 | 配置/扩展 | 可用 Facet 和 Product custom fields，但尚未定义 | 先确认商家后台录入模型，再开发展示 |
| 商品评价 | 扩展 | 当前 Reviews 是开发测试插件 | 生产版需审核、评分汇总、分页、防重复评价和图片能力 |
| 店铺信息 | 现有 + 扩展 | active Channel 可取基础信息；品牌装修信息缺失 | 与装修插件统一返回 |
| 推荐商品 | 配置/扩展 | 可用关联 Collection | 一期人工推荐，三期个性化 |

### 4.5 购物车

| 功能 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 服务端购物车 | 已扩展 | `storefrontCart` | 独立保存全部待购商品，已选行投影到 Vendure active Order |
| 加入、改数量、删除 | 已实现 | Storefront Cart mutations | 已接入 optimistic revision 并显式处理错误结果 |
| 全选、半选、选中数量 | 已实现 | `selectionState`、`selectedQuantity` | 顶部显示全选和已选阿拉伯数字，底栏金额只对应选中项 |
| 只结算选中商品 | **已实现** | `beginStorefrontCheckout`、`prepareStorefrontCartPayment` | 未选行保留在独立购物车，不进入当前订单金额、配送和支付 |
| 实物/虚拟分组 | 现有插件 + 前端 | `checkoutFulfillment` 和行快照 | 一期实现 |
| 失效商品 | 部分现有 | 加购/改量会返回库存或可售错误 | 前端展示失效原因；批量清理可调用删除接口 |
| 优惠码 | 现有 | `applyCouponCode`、`removeCouponCode` | 一期在购物车或确认订单页提供输入和移除 |
| 可领取优惠券 | 扩展 | 无优惠券列表/归属模型 | 二期实现 |
| 推荐商品 | 配置 | 运营 Collection | 一期用于填补空购物车和页面尾部 |
| 合计、优惠、运费 | 现有 | Order 金额字段 | 全量结算可直接使用；部分结算必须以后端新结算订单金额为准 |

#### 选中结算的推荐方案

“勾选状态”确实是前端交互，但“只对勾选商品计算优惠、运费并付款”不是纯前端功能。推荐新增购物车领域扩展：

1. 用户购物车保存全部待购项及选择状态。
2. 点击结算时，服务端以选中项创建或同步本次 active Order。
3. 未选中项继续保留在购物车，不参与当前订单价格、优惠、运费和库存校验。
4. 支付成功后只移除已购买项。
5. 登录前后的购物车支持合并，冲突时以后端当前价格和库存为准。

不采用“先从 active Order 删除未选中项，结算后再加回来”的方案。该做法在跳转支付、会话失效、库存变化和优惠重算时会丢商品或金额不一致。

该扩展的实体、数据库迁移、Shop API 与客户端接入已完成。

### 4.6 确认订单与支付

| 功能 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 联系人和收货地址 | 现有 | `setCustomerForOrder`、`setOrderShippingAddress` | 游客和登录用户分别处理 |
| 地址簿选择 | 现有 | `activeCustomer.addresses` | 一期实现新增、编辑、删除和默认地址 |
| 配送方式 | 现有 | `eligibleShippingMethods`、`setOrderShippingMethod` | 地址更新后重新获取，处理方式失效 |
| 虚拟商品免地址/配送 | 现有插件 | `checkoutFulfillment` | 一期按后端结果决定表单，不用商品名称猜测 |
| 订单备注 | 部分现有 | Shop API 有 `setOrderCustomFields`，但当前未定义公开备注字段 | 需新增 Order custom field，涉及配置/迁移确认 |
| 优惠码与金额明细 | 现有 | coupon mutation、Order discounts/totals | 一期以后端金额为唯一准值 |
| 提交到付款 | 部分已实现 | `prepareStorefrontCartPayment`、`eligiblePaymentMethods`、`addPaymentToOrder` | 购物车快照与订单状态转换已完成，真实支付方式和错误页待接入 |
| 微信/支付宝/银行卡等真实支付 | 配置/扩展 | 当前仅 dummy handler | 上线阻塞项；需选支付服务商、回调、签名校验和退款策略 |
| 防重复提交 | 前端 + 后端 | 状态机可拒绝非法转换 | 按钮锁定、请求幂等、恢复支付中订单 |

### 4.7 我的

| 区域 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 登录、注册、退出 | 现有 | `login`、`registerCustomerAccount`、`logout` | 一期实现完整校验、验证邮件和错误状态 |
| 头像、昵称 | 部分现有 | Customer 有姓名，无已确认头像字段 | 一期文字头像；上传头像需扩展 |
| 订单数量入口 | 现有 | `activeCustomer.orders` | 一期按状态统计，状态映射集中维护 |
| 待付款/待发货/待收货/售后 | 部分现有 | 订单状态现有；客户自助售后缺失 | 前三项一期，售后二期 |
| 物流摘要 | 现有 | Order.fulfillments、trackingCode | 一期展示；实时轨迹需物流服务商接口 |
| 地址管理 | 现有 | Customer Address mutations | 一期实现 |
| 优惠券包 | 扩展 | 无客户券钱包 | 二期 |
| 收藏/足迹 | 扩展/前端 | Core 无收藏；足迹可先本地保存 | 收藏二期；足迹一期本地、登录同步二期 |
| 客服 | 配置/扩展 | 无客服会话 | 一期配置电话/外链；站内客服以后扩展 |
| 隐私与服务条款 | 前端 + 配置 | 需真实条款地址 | 一期实现 |
| 猜你喜欢 | 配置/扩展 | 可用人工 Collection | 一期人工推荐，三期个性化 |

### 4.8 订单列表、详情与售后

| 功能 | 能力 | 数据来源/缺口 | 开发结论 |
| --- | --- | --- | --- |
| 全部订单和状态 Tab | 现有 | `activeCustomer.orders(options)` | 一期服务端分页和状态筛选 |
| 订单卡商品、数量、实付款 | 现有 | Order lines/totals | 一期直接接入 |
| 再买一单 | 现有 + 前端 | `addItemsToOrder` | 一期逐项校验库存与现价，失败项单独说明 |
| 加入购物车 | 已扩展 | `addStorefrontCartItem` | 一期已实现，再买一单也应统一调用新购物车 API |
| 查看物流 | 现有/扩展 | trackingCode 现有；实时轨迹缺失 | 一期展示承运商和单号；轨迹二期 |
| 评价 | 扩展 | 生产评价系统缺失 | 二期 |
| 取消未付款订单 | 扩展/流程 | Shop API 没有客户取消订单 mutation | 需自定义权限、可取消状态和退款规则 |
| 退款/售后 | 扩展 | Core 退款主要是后台操作 | 二期建立申请、审核、凭证、退款和状态通知闭环 |
| “更多”菜单 | 前端 | 动作由订单状态决定 | 只展示当前状态真实可执行的动作，不放无效按钮 |

## 5. 一期 API 清单

| 场景 | Query / Mutation |
| --- | --- |
| 应用初始化 | `activeChannel`、`activeCustomer`、`storefrontCart` |
| 分类 | `collections`、`collection` |
| 搜索与列表 | `search`，使用 `collectionId`、`term`、Facet、`take/skip`、price sort |
| 商品详情 | `product(id/slug)` |
| 购物车 | `storefrontCart`、`addStorefrontCartItem`、`setStorefrontCartLineQuantity`、`removeStorefrontCartLines`、`setStorefrontCartLinesSelected`、`setAllStorefrontCartLinesSelected` |
| 优惠码 | `applyCouponCode`、`removeCouponCode` |
| 结算 | `beginStorefrontCheckout`、`setCustomerForOrder`、`setOrderShippingAddress`、`eligibleShippingMethods`、`setOrderShippingMethod`、`prepareStorefrontCartPayment` |
| 支付 | `nextOrderStates`、`transitionOrderToState`、`eligiblePaymentMethods`、`addPaymentToOrder` |
| 账号 | `login`、`authenticate`、`logout`、`registerCustomerAccount`、验证与密码重置 mutations |
| 地址 | `createCustomerAddress`、`updateCustomerAddress`、`deleteCustomerAddress` |
| 订单 | `activeCustomer.orders`、`order`、`orderByCode` |
| 店铺装修 | 待新增 Shop API；按当前 Channel 自动返回，不接受前端传任意 Channel id |
| 选中结算 | 已由 Storefront Cart API 实现，服务端重新校验 Channel、价格、库存与归属 |

所有 mutation 必须显式处理 Vendure 的 ErrorResult union，不能只判断 HTTP 200。

## 6. 分期执行顺序

### P0：先消除架构阻塞

1. “选中部分商品结算”服务端模型与客户端已实现。技术设计见 [购物车选中结算技术设计](./CART_SELECTION_CHECKOUT_DESIGN.md)。
2. 确认店铺装修数据模型和 Dashboard 管理范围。
3. 确认生产支付服务商、支持币种、回调域名和退款边界。
4. 将语言与市场/Channel 状态解耦。
5. 为每个自定义能力定义权限、Channel 隔离和迁移方案。

### P1：完成可下单的移动端一期

1. 建立移动端路由、页面壳、底部导航和统一状态组件。
2. 接入首页装修内容、服务端搜索、分类和商品详情。
3. 完成购物车选择、选中结算、优惠码和确认订单。
4. 完成登录注册、地址、订单列表、订单详情与基础物流。
5. 接入真实支付并完成成功、失败、取消、恢复支付流程。
6. 做移动端适配、无障碍、性能、错误监控和端到端测试。

### P2：运营与售后闭环

1. 优惠券领取与客户券包。
2. 消息中心和订单状态通知。
3. 商品评价与审核。
4. 取消订单、退款/售后申请和物流轨迹。
5. 收藏、跨设备足迹和客服能力。

### P3：增长能力

1. 个性化推荐。
2. 热门搜索与搜索分析。
3. 销量排序和更复杂的价格区间检索。
4. 首页区块实验和运营效果分析。

## 7. 开发前必须确认的变更

以下事项会修改数据库、后端配置、支付或公共 API，不能作为普通前端页面修改直接开始：

1. 店铺装修插件及其实体、迁移和 Dashboard 页面。
2. 购物车选中状态与“只结算选中项”的持久化模型。
3. Order 备注等 custom field 及对应迁移。
4. 搜索库存索引、价格区间、新品和销量排序扩展。
5. 生产支付处理器、密钥环境变量、Webhook 和退款流程。
6. 评价、通知、优惠券钱包和售后插件。

## 8. 一期验收标准

- 任意已验证商家域名只能读取对应 Channel 的商品、内容、价格、库存和订单。
- 中文/英文切换不改变店铺、币种和购物车，缺少翻译时有明确回退规则。
- 首页区块、分类广告和推荐位均可在后台按 Channel 配置，不写死商家内容。
- 分类、搜索、筛选和列表使用服务端分页；弱网下可取消旧请求并重试。
- 购物车全选、半选、取消和数量展示准确，提交订单只包含选中商品。
- 所有金额以服务端 Order 为准，优惠、税费、运费和支付金额一致。
- 实物、虚拟和混合订单显示正确的地址、配送与交付要求。
- 登录、地址、下单、支付、订单查询可完整跑通，刷新后状态可恢复。
- 所有页面具备加载、错误、空数据、禁用和重复提交状态。
- 覆盖 320px 小屏、常见移动端宽度、安全区、键盘弹起和长文本场景。
- 不在浏览器暴露生产 Channel token、支付密钥或可伪造的店铺标识。

## 9. 下一项实际开发任务

P0 第一项的技术设计已经完成，见 [购物车选中结算技术设计](./CART_SELECTION_CHECKOUT_DESIGN.md)。下一步经批准后新增 `storefront-cart-plugin`、实体和数据库迁移；与此同时可独立开发不依赖该决策的移动端路由与分类查询。
