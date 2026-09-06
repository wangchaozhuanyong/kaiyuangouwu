# 中文保存与异步英文同步

业务服务在原有事务中调用 `prepareLocalizedFields` / `prepareLocalizedColumns` 和 `recordPreparedFields`，仅校验中文、保留有效英文、登记字段状态。禁止在业务保存事务中调用 `translate`。唯一外部提供方调用位于 `TranslationExecutionService`；后台 worker 与管理端测试翻译共用数据库限流锁。

## 执行与恢复

- Vendure Scheduler 每分钟扫描最多 100 个到期字段；按格式合批，单批最多 50 个字段及 5,000 个 Unicode 码点，批内相同文本只提交一次。单个长字段隔离处理，Google 提供方再校验 128 段及请求字节限制。
- 字段状态使用 revision、sourceHash、translatedHash、leaseToken 和 leaseUntil 进行写回校验。原生实体按实际 Channel 关系检查；装修子项通过父区块核验；共享原生英文尊重其他关联店铺的人工审核。
- 提供方全局并发 1，租约 30 秒；Google 每次 HTTP 请求超时 10 秒。字段租约 60 秒，每轮工作预算 40 秒。配额与临时错误从 60 秒指数退避至 15 分钟，并遵守更长的 Retry-After。配置和永久内容错误暂停自动尝试，管理员修复后重试。
- 自动状态依次为 PENDING → TRANSLATING → NOTIFY_PENDING → AUTO_TRANSLATED。重试原子认领记录，过期响应不得覆盖新版本。删除或越店铺任务取消；人工锁定保持 MANUAL_LOCKED / STALE。
- 译文和 notificationVersion 同事务落库，然后等待默认搜索索引任务入队。通知失败只重试通知，已经写入的译文不会再次请求提供方。API 每 3 秒读取通知版本以刷新已连接前台的公共缓存；各 API 进程自行消费，断线客户端重连时重新读取数据。通知可能重复，消费者须保持幂等。
- 历史扫描使用持久化游标分批登记，不在 API 启动中翻译，不重置已有失败退避或人工决定。审计接口区分排队数与完成数。后台人工重试不绕过提供方限流时间。

## 内容与表单

中文按原业务发布规则立即展示；有效旧英文保留，新内容所需英文未齐时等待补齐。表单传递实际修改过的英文；装修区块使用 updatedFields 兼容标记，空值表达清除人工覆盖。保存成功后刷新错误单独提示，保存错误保留草稿。

字段登记与存储映射集中在 `customer-facing-content-registry.ts`、`translation-content-adapter.ts`。新内容类型必须同时登记字段、归属关系和事务入队入口。

## 迁移与上线

先执行 dev-server 中 `AddTranslationOutbox1788739200000`，再启动新版 API 和 worker。迁移只新增翻译状态字段、提供方状态表及索引；down 保留新增状态和内容。代码回退不会删除数据，但旧代码可能恢复同步翻译行为，需结合旧版本评估。没有运行 worker 时中文照常保存，英文队列等待 worker 恢复。

生产上线需独立授权、备份、正式迁移及真实业务验收；普通 PR 的 Build & Test 不执行部署。

## 本地验证

在仓库根运行相关包的 `check-types`、`test`、`build`，以及 `bun run lint:check`、`bun run check:migration-registry`、`bun run check:storefront-publishing`。

真实 Admin/Shop API 集成测试：在 `packages/storefront-content-plugin` 运行：

```sh
bunx vitest run --config ../../e2e-common/vitest.config.mts e2e/translation-outbox.e2e-spec.ts
```

`TRANSLATION_BROWSER_ACCEPTANCE=1` 保持隔离 API（3298）运行，并输出临时控制文件。使用项目真实 Next Admin 连接本地 API；控制值 paused / rate-limit / recover / conflict / stop 仅用于测试提供方故障注入，不访问 Google 或生产数据库。

PostgreSQL 额外验收固定连接到 loopback `127.0.0.1:15492`、数据库 `translation_outbox_e2e`。使用一次性容器和临时存储；这些测试会重建专用测试 schema，禁止绑定到业务数据库。构建本插件后，在本包运行：

```sh
TRANSLATION_TEST_POSTGRES=1 bunx vitest run src/content-translation-retry.service.spec.ts src/provider-process.spec.ts
```

并在 `packages/dev-server` 运行：

```sh
TRANSLATION_TEST_POSTGRES=1 bunx vitest run --config vitest.config.mts migrations/translation-outbox.spec.ts
```

未设置该测试开关时，一致性测试使用 SQL.js，两个独立进程测试单独跳过。进程测试包含并发争抢、SIGKILL 中断及持久化租约到期后的恢复；提供方为本地确定性测试实现。

`Build & Test` 的 unit-tests 作业使用一次性 PostgreSQL 服务执行上述队列、跨进程恢复和迁移测试，并运行真实 Admin/Shop API 验收；提供方故障由测试夹具注入。
