# 中文保存与异步英文同步

业务服务在原有事务中调用 `prepareLocalizedFields` / `prepareLocalizedColumns` 和 `recordPreparedFields`，仅校验中文、保留有效英文、查询已完成的共享缓存并登记字段状态。禁止在业务保存事务中调用 `translate`。唯一外部提供方调用位于 `TranslationExecutionService`；后台 worker 与管理端测试翻译共用数据库限流锁。

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

## 翻译结果缓存

缓存复用现有 `settings_store_entry` 表，键为 `contentTranslationCache.result`，scope 为版本、供应商、源/目标语言、TEXT/HTML 格式、完整原文和术语表的 SHA-256。术语表先规范排序再参与缓存与真实请求；相同文字用于不同字段或商品时可复用，同一原文的不同格式/规则不会混用。该命名空间注册为仅 SuperAdmin 可读、GraphQL 不可写，不存储 API Key。无需新增数据库表、迁移或依赖。

成功且有效的自动英文译文逐段写入数据库，无时间过期；API/worker 重启后仍先查询这些结果。错误、空译文、仍包含中文的结果及人工锁定的英文不会写进共享缓存。原文或规则改变后使用新的缓存键；缓存不会替代字段长度校验，也不会覆盖人工锁定。历史记录的英文仍直接在原记录复用；旧审计没有保存供应商/术语规则指纹，因此不把它们自动复制为其他记录在当前规则下的译文，以免规则更新后复用错误结果。本次不扫描或重写历史业务数据。

缓存查询发生在供应商配置/冷却检查之前，因此 Google 限流甚至暂时未配置时，已缓存的文字仍可使用。缓存未命中的新文字继续走现有翻译容错与后台补译流程；缓存不能解除 Google 本身的配额限制。缓存查询失败时保留中文并等待补译，避免缓存故障引起额外外部请求；缓存写入失败时保留已获取的有效译文并记录告警。

同一次保存同时包含缓存命中与未命中字段时，命中字段正常保存，缺译字段进入等待补译，保存阶段不调用提供方。后台批次遇到部分缓存命中和提供方拒绝时，也分别保存已命中字段并延期未命中字段。

跨进程共享已完成的缓存结果；同一进程内正在执行的相同请求合并等待。多个进程同时首次请求同一未缓存原文时，仍通过数据库提供方租约串行执行；数据库唯一键保证只保留一条缓存结果。持久化缓存会随不同原文数量增长，本次不自动删除已有缓存或业务数据。

## 免费备用渠道

Google 保持主渠道。dev-server 通过 `VENDURE_TRANSLATION_FALLBACK_AZURE=true` 启用 Azure，通过 `VENDURE_TRANSLATION_FALLBACK_MYMEMORY=true` 启用 MyMemory，默认均关闭。顺序为：所有启用渠道的已有成功缓存 → Google → Azure → MyMemory；未启用的渠道不查询缓存、不发送请求。两个开关互相独立，启用 Azure 不会同时启用 MyMemory。

### Azure Translator F0

创建独立的 Azure Translator 服务资源并选择 **F0** 免费档（每月 200 万字符），在 Azure 控制台核对实际 SKU 为 F0 后配置：

```dotenv
VENDURE_TRANSLATION_FALLBACK_AZURE=true
VENDURE_AZURE_TRANSLATION_API_KEY=
VENDURE_AZURE_TRANSLATION_REGION=
```

Key 只保存在服务端环境变量中，不传入前端、不写日志。Global 资源的 region 留空；区域资源填写其 Azure location（例如 `eastasia`）。只调用官方标准 NMT v3 文本接口，支持 TEXT/HTML，保留术语、链接和插值。不创建 LLM、文档翻译或其他收费资源。API Key 本身不携带可验证的定价档信息，因此不能仅凭环境变量声称资源免费；实际免费档必须在开通及验收时核对，不得换成付费 Key。

每组请求最多 1,000 段、合计 50,000 个 Unicode 字符，TEXT/HTML 分批；单次超时 10 秒，整个调用预算 20 秒。组间额度耗尽时，已经完成的字段继续写入共享缓存。HTTP 403 / `403001` 映射为 QUOTA，至少冷却 1 小时并遵守更长的 Retry-After；HTTP 429 进入限流退避。凭据错误和额度耗尽分别处理，不自动提高额度或修改套餐。

已有 Azure 译文按 `azure-translator-v3` 身份持久化缓存，API/worker 重启后可复用。Google 恢复后，未命中的新文字重新优先走 Google，Azure 已缓存译文不重新调用 Google。所有渠道不可用时，中文照常保存，英文等待队列补齐。Azure 订阅需保持有效，F0 资源的免费档与 Azure 新用户试用订阅生命周期分别管理。

官方资料：[创建 F0 资源](https://learn.microsoft.com/en-us/azure/ai-services/translator/how-to/create-translator-resource)、[价格](https://azure.microsoft.com/en-us/pricing/details/translator/)、[接口](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)、[错误码](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/status-response-codes)。

### MyMemory 免费备用

Google 保持主渠道。dev-server 设置 `VENDURE_TRANSLATION_FALLBACK_MYMEMORY=true` 后启用官方 MyMemory 匿名 API；默认关闭。不需要账号、邮箱或 API Key，不会自动开通收费方案。官方匿名额度为每天 5,000 字符，每个请求最多 500 UTF-8 字节；这不是无限免费额度。启用前需接受其条款：提交文本会被保留，可能由合作方处理，因此只用于允许发送给该服务的客户可见公开文案，不用于私人或保密内容。

可选设置 `VENDURE_MYMEMORY_CONTACT_EMAIL` 为已获所有者同意、能够收到联系的真实邮箱，通过官方 `de` 参数申请每天 50,000 字符的免费使用额度，无需注册、密码或绑卡。留空保持匿名；格式不合法时禁用该提供方并返回配置错误，不向外发送请求。不会从 Azure 登录、其他账号或业务数据中自动提取邮箱，也不轮换邮箱规避限额。请求禁止跟随重定向，不在错误消息中回显邮箱或上游 URL。是否接受邮箱及实际剩余额度由 MyMemory 决定，本地格式检查不代表额度已获确认。设置邮箱不改变提供方缓存身份，已有匿名成功译文仍可直接复用。

- 每次先读所有启用渠道的已有成功缓存，再将未命中文字按配置顺序交给提供方；限流、额度耗尽、暂时故障、未配置或忙碌时自动尝试下一渠道。
- 两个渠道分别持有数据库租约和冷却时间。MyMemory 确认额度耗尽后至少冷却 1 小时；Google 冷却到期后，新文字重新优先尝试 Google。已命中 MyMemory 的译文不会因 Google 恢复而再次付费翻译。
- MyMemory 成功译文存入同一共享缓存表，但按自身供应商身份隔离。批次中途失败时，已成功的完整字段仍写缓存；失败或半个字段不进入缓存。两个渠道都不可用时，中文照常保存，缺译字段保留待补译状态。
- MyMemory 按段落及字节限制拆分，串行请求，每轮最多执行 20 秒，然后交回后台队列。术语、链接和插值保持不变；富文本只翻译文本节点并转义返回值，保持原标签和属性。含中文属性或 script/style/pre/code 的复杂 HTML 留待 Google 恢复。

配置入口为 `packages/dev-server/content-translation-config.ts`。更换或增加已获授权的渠道可扩展插件 `fallbackProviders` 数组，不修改 Google 配额，不轮换身份规避供应商额度。关闭 MyMemory 开关会同时停用该渠道及其缓存读取，保留已存数据。

官方资料：[接口](https://mymemory.translated.net/doc/spec.php)、[免费额度](https://mymemory.translated.net/doc/usagelimits.php)、[条款](https://mymemory.translated.net/terms-and-conditions)。

## 商品导入回归

保留商品导入专项回归，并按后台翻译流程验证：失败行重试和 362 行批量保存时请求数为 0；随后由 worker 注入 Google 403、退避及恢复。验证 SKU 不重复、价格库存、两级分类和英文补齐，不连接生产数据库。

```sh
bunx vitest run --config e2e-common/vitest.config.mts packages/content-translation-plugin/e2e/catalog-import-rate-limit.e2e-spec.ts --maxWorkers=1
```

该命令在仓库根运行，已加入 Build & Test 的 unit-tests 作业。
