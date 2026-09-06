# 后台每页条数

当前 `/dashboard/` 由本包提供。所有现有分页入口统一默认每页 **20 条**，可选 **20 / 50 / 100 条**。最大值保持在已接入 Admin API 的分页上限内；本次没有修改后端接口、数据库或新增依赖。

## 接入规则

- 复用 `src/components/PageSizeSelect.tsx`，选项及默认值只在 `src/utils/pagination.ts` 定义。
- 现有商品、订单、客户列表使用 `useUrlListState()` 返回的 `pageSize` / `setPageSize`；URL 的 `pageSize` 保存当前选择，缺省或不支持的值回退到 20。
- 使用本地页码的列表，调用 `usePageSize(setPage)`；同屏的独立列表分别保存条数。
- 查询参数必须同时使用 `skip: page * pageSize`、`take: pageSize`，总页数使用 `Math.max(1, Math.ceil(totalItems / pageSize))`。查询参数使用 `useMemo` 时必须包含 `pageSize` 依赖。
- 切换条数同时回到第一页，URL 搜索、筛选条件保持。批量操作列表清空临时勾选；商品编辑中的图片、分类、规格等关联选择继续保留。
- 加载时禁用条数与翻页控件，分页栏允许换行。空列表仍可调整条数，上一页/下一页按边界禁用。
- 分销 5 个列表的 GraphQL 查询共用一个 `take`，因此同步条数并同时重置全部 `skip`。以后拆分查询时才能改成独立条数。

本次覆盖商品、订单、售后、客户、供货商、素材、库存各标签、卡密与交付记录、优惠券流水、分销报表、AI 任务、API 密钥、支付与退款明细、导入明细、商品编辑及商城装修的选择分页；集成版同时覆盖品牌素材选择器。商品分类保持完整树加载与本地搜索，不恢复会截断父子层级的旧平铺分页。完整数据预加载、下拉候选、批量导出和工作台摘要的查询数量沿用原规则。

## 验证

```bash
bunx tsc -b --pretty false
bun run lint
bun run test
bun run build
bun run dev -- --host 127.0.0.1 --port 5307 --strictPort
# 另一个终端，在本包目录运行：
node e2e/pagination/verify.mjs
```

浏览器测试渲染实际商品、订单、客户、供货商页面以及复用的选择/报表分页组件，使用内存 GraphQL 数据验证行数、请求数量、偏移、URL 状态、错误重试及 1440/768/390px 布局。不会读取线上账号或业务数据，也不替代真实后端联调和上线验收。
