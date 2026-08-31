# Vendure 商家后台

面向中文运营团队的独立管理后台。前端使用 React 19、TypeScript 6、Vite 7、Apollo Client 和 Tailwind CSS 4，数据全部来自 Vendure Admin GraphQL API。

## 页面结构

- 工作台：经营指标、待办事项、最近订单。
- 商品：商品列表与编辑、分类/专辑/规格/属性、库存与仓库、数字卡密、素材库。
- 订单与售后：订单、履约发货、退款售后、买家评价。
- 客户：客户资料、分组、订单关系和内部备注。
- 营销：优惠券/秒杀/ROI，以及分销返利、钱包、提款和海报。
- 店铺：商城装修，以及公告、法律内容和推广落地页。
- 插件与服务：客户端插件、AI 生图、多语言翻译；服务商密钥仅超级管理员可见。
- 系统与权限：多店铺/域名/商家/支付配送、员工角色，以及超级管理员运维工具。

为减少重复入口，旧页面按业务闭环合并：

- 分类、专辑、规格模板、筛选属性 → `/catalog/categories` 的子标签。
- 库存、库存点、出入库流水 → `/catalog/inventory` 的子标签。
- 发货与物流 → `/sales/orders?tab=to-fulfill`。
- 优惠券与秒杀 → `/marketing/promotions`。
- 提款审批 → `/marketing/referrals?tab=withdrawals`。
- 公告与推广页 → `/storefront/content`。
- 角色权限 → `/settings/team?tab=roles`。
- 任务队列、定时任务、配置仓库、API 密钥 → `/settings/system-ops`。

旧地址在 `src/App.tsx` 中保留跳转兼容，不要重新创建重复页面。当前后端没有独立的管理员 TOTP/2FA 管理接口，因此没有展示不可用的伪 2FA 页面。

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
