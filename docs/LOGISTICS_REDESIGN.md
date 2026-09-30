# 物流与关联订单详情改版

## 范围和来源

- 用户确认范围：物流相关页面及关联订单详情；要求独立的「物流动态」导航、合理返回路径和数据表布局。
- 使用 `web-dev-toolkit:website-redesign` 插件技能，沿用项目语义色板、公共账户框架、商家图片与已有业务接口。
- 工作区：`vendure-master/.codex-worktrees/logistics-redesign-20260928`；分支：`feat/logistics-redesign-20260928`。
- 基础版本：`1562ab4d`。已比对相关工作区的旧卡片实现和当前配送事件功能；本次方案依据用户最新截图与要求重新设计。主仓库已有购物车遮挡修复和其他修改未合入本工作区。
- 交付状态：本地代码与构建完成。未推送、未合并、未部署，未修改生产数据。

## 信息架构与功能安放

| 页面 | 主体内容 | 主要操作 | 返回关系 |
| --- | --- | --- | --- |
| 物流动态 | 状态筛选、搜索、配送订单数据表 | 查看物流 | 返回账户；桌面侧栏独立选中物流动态 |
| 物流详情 | 包裹切换、配送状态、运单、真实配送记录 | 查看关联订单详情 | 返回物流列表，保留状态及关键词 |
| 关联订单详情 | 订单状态、配送与交付表、商品及金额、订单资料 | 沿用既有订单业务操作 | 按来源返回物流列表或物流详情 |
| 订单内物流弹窗 | 与物流详情共用包裹信息和事件列表 | 联系客服 | 关闭回到当前订单，恢复键盘焦点 |

桌面列表使用列对齐和浅分隔线，替换高度不一致的双列大卡片。手机将同一份数据排成带字段标签的记录，主要操作始终可达。详情桌面为配送记录与关联订单两栏，手机纵向排列。

导航地址：`/logistics` → `/logistics?id=<orderId>` → `/order-detail?id=<orderId>&source=logistics-detail`。`deliveryStatus`、`term` 随关联页面保留；直接从列表查看订单时使用 `source=logistics`。来源和状态参数经过白名单规范化。

## 数据表设计

只组织现有接口字段；未新增数据库表、字段或接口。

| 列 / 区域 | 现有数据来源 | 显示规则 |
| --- | --- | --- |
| 订单 / 商品 | `order.code`、实物 `lines`、`productVariant`、`featuredAsset`、`quantity` | 保留商品图与名称；虚拟商品不进入物流记录 |
| 配送状态 | `order.state`、实物 `fulfillments.state` | 待发货、运输中、已送达、已取消；部分发货/部分送达不会误标全部送达 |
| 配送方式 / 运单 | 最近更新的 `fulfillment.method`、`trackingCode`，缺省用 `checkoutShipping.methodName` | 多包裹显示数量；详情逐包查看；无单号明确显示暂无运单号 |
| 最近更新 | 实物 `fulfillments.updatedAt`，缺省用 `orderPlacedAt` | 按项目业务时区格式化 |
| 配送记录 | `deliveryEvidence.events` | 最新在前；显示事件时间、状态、备注及来源类型 |
| 配送异常 | `deliveryEvidence.status`、`exceptionReason` | 包裹标签、详情状态和关联订单配送表中显式提示 |
| 收货操作 | 现有确认收货回调与资格条件 | 保留原业务操作及错误反馈；浏览器样本未执行写入 |

订单列表接口没有完整配送事件，因此列表状态使用订单/履约状态，详情加载完整订单后展示异常与事件。无轨迹时只展示已确认的当前包裹状态和订单创建记录，不生成虚构中转站或签收记录。

列表每次加载 10 个订单。搜索、筛选和数量仅作用于已加载配送订单，界面明确标明这一范围；即使筛选无匹配项，也保留「加载更多」入口。未登录、加载、失败重试、无配送记录和无搜索结果分别处理。

## 修改文件

- `pages/logistics-page.tsx`：列表、详情、筛选与搜索。
- `storefront-ui/delivery-details.tsx`：状态聚合、商品、运单复制与共享配送记录。
- `order-pages.tsx`：关联订单的交付表及物流弹窗。
- `styles/logistics.css`：上述页面的共享响应式排版。
- `components/common/desktop-account-navigation.tsx`：独立导航和来源选中。
- `route-pages/order-route-pages.tsx`、`storefront-router.ts`、`routes/logistics.tsx`：来源、筛选参数和返回行为。
- 对应现有 `order-pages.spec.tsx`、`routing.spec.ts`、`skin-system.spec.ts` 更新了布局与路由约定。

以上源码均位于 `packages/storefront/src/`。

## 实际检查与证据

- 相关 3 个现有规格文件此前执行结果：69 项通过。之后收尾修改了标题、包裹异常标签、部分送达归类及 CSS 选择器，未重复运行测试套件。
- 最终 `bun run --cwd packages/storefront build`：通过，包含路由工具链检查、TypeScript、商城生产构建、产物检查和独立双因素页面构建。首次构建因工作区引用旧依赖失败；按 `bun.lock` 执行冻结安装后恢复，依赖声明和锁文件未改变。
- 浏览器此前已确认：独立导航、筛选保留、包裹切换、异常记录、复制反馈、订单往返、390px 无横向溢出；记录见 `artifacts/logistics-redesign/result.json`。
- 最终截图重新采用减少动画设置，人工查看了桌面列表/关联订单、手机列表/详情，消除截到入场动画中间态的问题；订单内弹窗截图亦已保留。
- `git diff --check`：通过。

截图与脚本在 `artifacts/logistics-redesign/`，使用实际客户端组件和明确标记的合成只读样本；拦截生产请求及写操作。商品、订单、姓名、金额均为本地演示数据，不能作为线上业务验收或用户已确认视觉稿的证据。

- `desktop-list.png`、`desktop-detail.png`、`desktop-order.png`
- `desktop-tracking-dialog.png`、`mobile-list.png`、`mobile-detail.png`
- `build.log`、`result.json`、`capture.mjs`

设计来源登记：主仓库 `docs/design-preview-baselines.json` 的 `logistics-workspace`；登记源码核对记录将保存在 `artifacts/logistics-redesign/design-source-check.json`。

后续真实店铺验收应关注大量订单分页、多包裹配送数据及实际承运商事件；本地样本未验证生产配送或收货写操作。

## 表格对齐修订（用户追加反馈）

- 商品列从 30% 加宽至 38%，其余列按 12% / 22% / 16% / 12% 分配；单元格垂直居中，统一 16px 内边距。
- 桌面表格商品图保持 44px，数量占固定 32px 并右对齐，名称最多两行；名称和订单号保留原文本及悬停提示。详情及手机记录显示完整名称，多商品订单仍保留全部商品。
- 使用相同的四订单样本重新截图，行高为 104.5 / 105 / 105 / 104.5px（表格边线带来 0.5px 差异）；各行列起点和宽度相同。390px 视口的文档宽度仍为 390px。
- 新截图：`artifacts/logistics-redesign/aligned-desktop-list.png`、`aligned-mobile-list.png`；尺寸记录：`alignment-measurements.jsonl`。本轮只更新列表排版和完整名称提示，没有运行或新增测试套件。

## 2026-09-30 发布整理

- 从旧分支只移植物流核心提交 `b4281520`、`79b508ee` 到已发布的 `414a1c85` 基线；旧分支里的优惠券、分类、账户、政策及服务样式均单独处理或保留原状。合并冲突仅发生在订单文件的导入处，保留当前主分支订单状态逻辑并加入新配送组件导入。
- 最新基线下 `order-pages.spec.tsx`、`routing.spec.ts`、`skin-system.spec.ts` 共 72 项通过；Storefront/2FA 构建与预算通过。旧合成浏览器记录是设计来源，不等同于这一版或线上真实配送的验收。PR、部署和实际订单流程另记。
