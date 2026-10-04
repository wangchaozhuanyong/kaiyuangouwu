# 客户端统一交互规则

此文件仅约束 `packages/storefront`，与仓库及用户的项目隔离、保护 WIP、发布授权规则一起生效。

- 开发前读取 [统一加载、刷新与交互标准](LOADING_REFRESH_INTERACTION_STANDARD.md)。新增页面、路由、功能和客户端插件必须使用相同状态契约；不得自行建立第二套刷新、加载遮罩或缓存机制。
- 保留当前已确认的共享布局、装修配置、主题、内容和业务流程；客户端与管理后台各自使用既有查询框架。两端统一行为，不共享会话或查询缓存。
- 首载没有数据才显示 `PageSkeleton` 或 `AsyncRouteStatePage`；使用 `storefrontQueryPresentation` / `storefrontInitialQueryError` 分离首载失败与后台更新失败。成功的 `[]`、`null`、零条结果都属于已加载，不能按数组长度判断请求成功与否。
- 刷新保留可用内容、滚动、筛选和草稿。统一状态提示由 `StorefrontQueryFeedback` 提供。只重试当前作用域的查询；`refetch` 与 `fetchNextPage` 使用 `{ cancelRefetch: false }`。不得重放写操作、重新提交表单或自动整页刷新。
- `queryKey` 必须包含影响查询的店铺、结算币种、语言、客户及筛选条件；复用 `storefrontQueryKeys`。跨作用域 placeholder 使用 `storefrontPlaceholderData` 清空旧内容。私有数据不得进入 public session cache。
- 查询向 API 传递 TanStack 提供的 `AbortSignal`，复用现有请求超时、重试与缓存策略；不要新增业务请求 `setInterval`。隐藏窗口不轮询，返回及联网时按过期状态刷新。
- 路由、必要数据及首屏媒体使用现有 `PageReadinessBoundary` / `SafeImage`；不要以刷新动作重新播放整页首载动画。只有版本更新提示和资源加载错误边界可以整页 reload。
- 搜索、筛选、分页、页面切换以 URL 为准；中文输入组合期间不查询未完成文字。追加加载保留已有条目，错误留在分页区域。主导航、返回、键盘焦点和移动端交互遵守完整标准。
- 表单校验、写操作 busy、防重复提交、成功／失败反馈继续复用所属业务的现有机制。写入成功与后续读取失败必须分开，禁止把刷新失败当成“保存失败”诱导重复写入。
- 修改后先执行 `bun run check:interaction`、受影响的 Vitest 测试和 `bun run build`。涉及可见交互时使用实际组件做本地浏览器验收，记录模拟数据来源；构建或模拟验收不代表线上验收。
- 标准门禁测试 `src/interaction-standard.spec.ts` 随既有 `bun run test` 执行。禁止为了通过检查扩大白名单或删除断言；有明确业务例外时先说明实际触发路径、边界和验证。
