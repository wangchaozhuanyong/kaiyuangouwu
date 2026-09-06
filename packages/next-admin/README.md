# MOYAO AI｜模钥管理后台

面向中文运营团队的独立管理后台。前端使用 React 19、TypeScript 6、Vite 7、Apollo Client 和 Tailwind CSS 4，数据全部来自 Vendure Admin GraphQL API。

## 页面结构

- 工作台：经营指标、待办事项、最近订单。
- 商品：商品列表与编辑、供货商与采购属性、包装拆包、批次效期、多币种 SKU 价格、分类/集合规则、库存与仓库、数字卡密、素材库及 XLSX/CSV 报表。
- 订单与售后：订单、履约发货、手工支付、支付/退款结算、优惠券分摊、多商家子订单、退款售后、买家评价。
- 客户：客户资料、分组、订单关系和内部备注。
- 营销：优惠券/秒杀/ROI，以及分销返利、钱包、提款和独立的分享设置。
- 店铺：商城装修，以及公告、法律内容和推广落地页。
- 插件与服务：客户端插件、商业服务页文案、AI 生图、多语言翻译，以及按管理员隔离的 2FA 动态码工具；服务商密钥仅超级管理员可见。
- 系统与权限：多店铺/域名/商家/币种汇率/USDT/支付配送、员工角色，以及超级管理员运维与 API Key 工具。

为减少重复入口，旧页面按业务闭环合并：

- 分类、专辑、规格模板、筛选属性 → `/catalog/categories` 的子标签。
- 库存、库存点、出入库流水 → `/catalog/inventory` 的子标签。
- 发货与物流 → `/sales/orders?tab=to-fulfill`。
- 优惠券与秒杀 → `/marketing/promotions`。
- 提款审批 → `/marketing/referrals?tab=withdrawals`。
- 分享设置 → `/marketing/sharing`，独立管理分享海报的默认模板、启停、背景、中英文文案与预览；旧的 `/marketing/referrals?tab=posters` 自动转到这里。分享专用内容不属于商城装修楼层。
- 首页轮播图 → `/storefront` 右上角“首页轮播图”；图片、文案、跳转、排期、顺序与间隔统一管理，左侧只保留一个轮播楼层。
- 公告与推广页 → `/storefront/content`。
- 角色权限 → `/settings/team?tab=roles`。
- 任务队列、定时任务、配置仓库、API 密钥 → `/settings/system-ops`。

旧地址在 `src/App.tsx` 和扩展注册表中保留跳转兼容，不要重新创建重复页面。`/two-factor-codes`
会跳转到 `/plugins/two-factor-codes`。该工具用于保存第三方服务的 TOTP 密钥并生成动态码，
不是管理员账号登录 2FA；数据按当前管理员隔离，并通过后端加密存储。

28 个旧本地插件 URL 的精确新地址由
`src/extensions/legacy-capabilities.ts` 统一记录并测试。新扩展能同时注册路由、旧路径、
页面操作、页面块、工作台组件和告警；旧 URL 不得重定向到无关工作台冒充已迁移。

## 多店铺装修规则

所有 Channel 共用首页模块清单、客户端插件清单、编辑器和发布规则。店铺只保存自己的配置；新店没有保存的装修楼层不会由客户端自动补出。`/storefront`、`/storefront/content` 和客户端插件页使用 `ReadStorefrontContent` 及对应写入权限；分享设置使用 `ReadReferral` 及对应写入权限，全局系统公告仅超级管理员可管理。

结构预览使用与 Shop API 相同的启用、排期、双语和图片条件，支持切换中文/英文。它显示已保存的内容结构，不替代真实客户端的商品数据和样式验收。完整约定见 [店铺配置契约](../storefront-content-plugin/CONFIGURATION_CONTRACT.md)。

## 本地命令

在本目录执行：

```bash
bun run dev
bunx tsc -b --pretty false
bun run lint
bun run build
bun run preview
```

复制 `.env.example` 为本地 `.env`，配置 Admin API：

```dotenv
VITE_VENDURE_ADMIN_API_URL=http://localhost:3000/admin-api
```

前端同时支持 Vendure Cookie 与 Bearer Token 登录。不要在代码或环境示例中写入真实账号、密码或 API Key。

生产构建固定挂载在 `/dashboard/`，未显式设置 `VITE_VENDURE_ADMIN_API_URL` 时使用同域
`/admin-api`。生产运行产物必须包含 `packages/next-admin/dist`，并由 Vendure
`DashboardPlugin` 提供 SPA 路由回退。

## 后端联调

对应后端位于 `../dev-server`。其开发启动默认执行仓库迁移，并可能按环境变量同步数据库结构。联调前必须确认：

1. 使用全新、一次性的本地开发数据库，不连接现有或生产数据库。
2. 明确设置独立的 `DB_NAME`、账号和端口。
3. 不执行 `populate`；该命令会清空数据库表。
4. 不启动共享 worker，除非测试确实依赖任务队列。
5. 完成后只停止本次启动的进程或容器。

## 设计与实现约束

- 页面必须具备加载、失败、空状态和可重试入口。
- 危险操作统一使用应用内确认弹窗，不使用浏览器 `alert`、`confirm` 或 `prompt`。
- 用户界面只显示可理解的业务错误，不直接暴露 GraphQL、SQL、堆栈或密钥信息。
- 所有新增标签页应使用 URL 查询参数保存状态，确保刷新和返回后仍处于原位置。
- 桌面端和移动端都需要可操作；图标按钮必须有可访问名称。
- 不得凭空增加 GraphQL 字段、配置项或没有后端实现的页面。

## 交付检查

提交前至少执行：

```bash
bunx tsc -b --pretty false
bun run lint
bun run build
```

本项目当前按路由懒加载页面。修改路由或引入大型依赖后，应同时检查生产构建的入口体积和页面分包情况。

## 利润、费用与优惠券归档

`/sales/profit` 按当前店铺、币种和下单日期核算已结算支付、已结算退款及商品历史成本。
买家运费包含在实收中；实际物流成本和手续费单独扣除。成本或费用缺失时不显示净利润，
没有费用时需明确填写 0。缺少历史成本时会标记估算；退货入库不会自动冲减商品成本，
此报表属于经营核算口径。

费用修改要求同时具有订单修改和商品经营数据修改权限，费用报表读取也要求两类读取权限。
CSV/XLSX 费用导入按当前店铺与所选币种匹配订单；导入前可在浏览器预览错误。

优惠券归档停止新的领取和发放，并从默认活动列表隐藏；已领取优惠券及核销记录保留。
可切换到“已归档”查看活动。已发券活动使用归档，删除失败会在确认弹窗中说明原因。

主要功能标题旁的说明按钮支持鼠标悬停、点击固定、键盘操作及移动端视口适配。
