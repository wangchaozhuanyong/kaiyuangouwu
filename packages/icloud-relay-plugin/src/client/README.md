# iCloud Admin 接口契约

服务端 `../api/api-extensions.ts` 定义实际接口。两个后台统一从 `admin.graphql` 生成的 `admin.generated.ts` 读取请求文档、输入和结果类型；不要在页面重新手写 GraphQL 或用只声明结果的泛型覆盖变量类型推断。

从仓库根目录执行：

```sh
bun scripts/codegen/icloud-admin-contract.ts
bun scripts/codegen/icloud-admin-contract.ts --check
```

`admin-contract.spec.ts` 会检查全部请求与实际服务端 Schema 的兼容性、两套后台共享文档、旧错误参数被拒绝，以及生成文件是否过期。插件常规单元测试会运行该检查。

- 更新主邮箱和虚拟邮箱：`input.id` 必填，没有独立的 `id` 参数。
- 批量导入：发送 `input.rawInput`，由服务端统一解析；不是 `input.items`。
- 清空备注：发送空字符串；省略字段表示不修改。
- 只改备注时不提交未变化的查询码周期，避免刷新到期时间。

实际 HTTP GraphQL / SQL.js 回归：

```sh
cd packages/icloud-relay-plugin
CI=true DB=sqljs bun run test:integration
# 仅连接一次性本地 MySQL 测试实例，测试初始化会重建专用 e2e 数据库
CI=true DB=mysql E2E_MYSQL_PORT=33552 bun run test:integration
```

Next Admin 交互回归位于 `packages/next-admin/src/pages/Plugins/IcloudRelayModule.spec.tsx`，使用真实 Schema 校验和内存记录。`packages/next-admin/e2e/icloud-contract/` 是对应的本地浏览器验收入口，不连接生产服务、不包含真实凭据，也不进入生产构建入口。数据库持久化和并发分别以独立 SQL.js 和 MySQL 测试为证据。


## 状态与并发约定

- `admin-validation.ts` 是两个表单和服务端新增、修改、批量导入的共享业务校验；数据库约束继续作为最后防线。周期 0 表示不自动重置；非法周期、超长字段和非法邮箱不能落库。
- 已有实体禁止先读取再 `save(entity)`：管理员用 `updateIcloudRecord` 只修改提交字段，并对这些字段进行原值条件更新；重置周期同时检查原查询码。冲突提示刷新重试。
- 定时换码使用同一条件更新，候选记录发生变化时跳过。访问记录、收信计数与同步状态只更新各自负责的字段；计数原子递增，同步不得重新启用已禁用邮箱。
- Next Admin 用表单代次隔离异步结果；旧请求不能关闭、清空或报错到新表单。旧 Dashboard 保存期间禁用表单和关闭入口，并阻止重复提交。
- mutation 失败保留输入；mutation 成功但 refetch 失败明确提示“操作已完成”，刷新只重试读取。首次加载错误不得用空列表掩盖。
- 常规插件 `test` 覆盖共享契约及实际 TanStack hooks 的旧 Dashboard 交互；Build/Test 的 unit-tests 作业额外执行 SQL.js 和 MySQL 的 `test:integration`。生成脚本变化也会触发该作业。
- MySQL 并发用例使用两条独立事务，并确认 `performance_schema.data_lock_waits` 中真实发生行锁等待；SQL.js 明确跳过该项，不作为行锁证据。

## 类型检查与安装

在插件目录执行 `bun run check-types`，同时检查服务端、两套共享接口类型、Dashboard 页面及测试。配置继承 Dashboard 的路径别名，并加载其 Vite 环境声明；不要排除页面来消除类型报错。服务端构建继续使用独立的 `tsconfig.build.json`。

在仓库根目录执行 `bun install --frozen-lockfile`。`bunfig.toml` 固定使用与 CI 一致的 hoisted 布局，不升级锁定版本。旧目录如果曾交替使用 isolated 与 hoisted 安装，应先备份根目录和各包的 `node_modules`，再重新安装；直接覆盖安装可能遗留另一套 React 模块和类型。

CI 的 `iCloud plugin and dashboard extension types` 步骤执行同一个整包检查，阻止后续接口或类型配置回退。
