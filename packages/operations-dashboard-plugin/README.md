# Operations Dashboard Plugin

This private Vendure plugin owns operational dashboard extensions and the internal Telegram notification
channel. Telegram is an internal incident and commerce signal only; it does not publish marketing content.

## Telegram runtime configuration

Configure secrets on both the Vendure API and worker processes:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_OPS_CHAT_ID=
TELEGRAM_EMERGENCY_ENABLED=false
```

`TELEGRAM_BOT_TOKEN` is never stored in the database or returned by the Admin API. The Chat ID is always
handled as a string. `TELEGRAM_OPS_CHAT_ID` overrides the optional database value. Set
`TELEGRAM_EMERGENCY_ENABLED=true` only when database-down alerts must remain active even if the saved
configuration cannot be loaded.

After running migrations and restarting both processes, open **系统运维 → Telegram 通知** in the current
React dashboard. Save the Chat ID and policy, enable notifications, test the Bot identity, and then enqueue a
test message. The identity check calls `getMe`; message test buttons write to the durable outbox.

## Delivery model

- One Bot and one private Telegram group.
- Business event subscribers only write `admin_notification_outbox`; network delivery runs in the
  `telegram-internal-notification` Vendure JobQueue.
- One-off events use a unique deduplication key. Inventory incidents use an active fingerprint, aggregate
  repeats, and send a new reminder/recovery message. A pending or claimed send is never reclaimed by an incident refresh.
- P0 and P1 have higher queue priority. Retry delays are 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours;
  they use a separate high-priority Vendure queue so a P3 backlog cannot occupy their worker lane. Telegram
  `retry_after` overrides the normal delay. Non-retryable authorization and request errors become dead letters
  and can be retried from the dashboard after configuration is corrected.
- The worker heartbeat and delivery counts are persisted for the API process to display.
- SuperAdmin configuration changes are written atomically with an actor-attributed audit record. Chat IDs are
  masked in the audit payload, and the Bot Token is never stored there.
- The API-process watchdog sends bounded direct alerts after two consecutive database failures, or when dead
  rows / a stale worker leave P0/P1 notifications backed up. This emergency path uses the environment or last
  in-memory Chat ID and does not carry normal commerce messages.

## Vendure event coverage

| Event family                                     | Vendure source                                               | Default routing                                |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| Order placed                                     | `OrderPlacedEvent`                                           | `SALES` with `FULFILLMENT`, `DATA_FINANCE`     |
| Payment authorized/settled/failed/proof mismatch | `PaymentStateTransitionEvent`                                | `DATA_FINANCE`, `FULFILLMENT` or `TECH`        |
| Fulfillment created/shipped/delivered/cancelled  | `FulfillmentEvent`, `FulfillmentStateTransitionEvent`        | `FULFILLMENT`                                  |
| Refund pending/settled/failed                    | `RefundStateTransitionEvent`                                 | `FULFILLMENT` with `DATA_FINANCE`              |
| Low/recovered stock                              | `StockMovementEvent` plus Vendure saleable-stock calculation | `SUPPLY`                                       |
| Database dependency                              | API-process watchdog                                         | `TECH`, immediately escalated to `EXEC` for P0 |

Platform-specific domain signals also use the same durable outbox:

- Solidified USDT transfers with an unmatched amount and USDT intents requiring manual review are P0 finance
  incidents.
- Empty automatic-card pools are P0 supply incidents; final automatic-card email failures are P1 fulfillment
  incidents. Successful allocation or delivery resolves the matching incident.
- Final manual-delivery email failures and overdue manual-delivery tasks are P1 fulfillment incidents, with
  recovery emitted when the task is published, delivered or cancelled.

CloudBridge-specific account-capacity groups, Go/Wire services, Redis checks and Ops latency-rule metrics are
not part of this Vendure plugin. Product inventory uses Vendure's existing inventory calculation instead.

## Health endpoints

- `GET /health` remains Vendure's compatibility liveness route.
- `GET /health/live` checks only that the HTTP process is alive.
- `GET /health/ready` runs a bounded database probe and returns a simplified `503` response when unavailable.

The application cannot report its own complete process or host outage. Production monitoring must probe
`/health/ready` from outside the Vendure host.

## 全店铺统一中文通知（本地实现）

所有可见通知使用中文，业务消息由实际销售渠道或所属记录确定店铺名称。新店铺按活动店铺档案和有效主域名自动纳入；纯平台管理渠道不参与在线汇报。全局策略仍仅限超级管理员修改。

新增配置开关：在线汇报、客服服务评价、优惠活动到期、人工智能凭证告警和安全事件。既有配置、接收群与队列保留；启用全部事件时将最低通知等级设为“信息”，低库存阈值为 2，危急重复间隔为 30 分钟，重要重复间隔为 120 分钟。新订单、支付成功、库存和低分评价有声音，普通评价、在线汇报和活动提醒静默。

服务端新增心跳和评价接口。心跳每 60 秒上报，最近五分钟活跃；同店多标签与登录账号去重，登录后合并浏览器身份，拒绝统计立即撤出。心跳不写页面访问量，未收到有效采集记录时显示“统计暂不可用”；有效采集后没有活跃访客为 0。平台合计为各店人数之和，跨店可能重复。整点任务以马来西亚时间展示，快照十分钟后过期，不在故障恢复后补发旧报表；店铺多时分段发送。

客服评价保存到 `customer_service_review`，评价与通知入队处于同一事务，实际群发送不参与客户事务。游客可评价，订单关联必须属于已登录客户与当前销售店铺。常规评价按客户或浏览器、店铺与当日去重，关联订单按真实订单去重；修改原记录时增加版本，重复提交同内容不再通知。每来源五分钟最多十次提交，修改间隔至少一分钟，意见最多 2000 字。全店评价可在通知设置页分页查询，普通店铺管理员只可查询所属店铺。

活动按照结束时间进入 72 小时窗口发送一次；优惠券以领取截止时间为准。首次启动可补当前窗口提醒，结束时间变化产生新去重键，停用、归档与无结束时间的活动排除。

生图与提示词调用仅依据明确的失效、过期、停用、余额不足和账户额度耗尽原因告警。普通限流、模型权限、客户内容、图片尺寸和偶发超时不认定为凭证耗尽。通知不含凭证尾号、密钥、提示词、请求正文或上游错误原文。真实调用与已有连接检测成功后发送恢复消息；只读通道巡检不生成付费图片。

后台密码失败按同账号五次或同来源二十次、二次验证按同账号五次，在五分钟滚动窗口内触发。计数使用数据库原子增量，进程重启和多实例共用；身份由现有二次验证加密配置派生的独立摘要保护。安全配置缺失时标记账号尝试监测不可用。管理员、角色、权限、店铺授权、后台接口凭证和二次验证/恢复码变化发送合法操作记录，不称为攻击。

应用内监测实际活动店铺的有效主域名和证书，网络目标经过公网检查并固定解析地址；证书按十四、七、三天提醒，失效立即告警。巡检失败与已确认的接口异常分别告警。现有生产健康检查继续覆盖备份、校验、恢复验证与磁盘；主机停机由外部半小时巡检接入，同一故障持久化去重并注明可能的调度延迟。防火墙与主机入侵信号未接入，显示“未监测”。

运行依赖：在 Vendure 配置中显式登记 `OperationsDashboardPlugin`，同时保留现有 `StoreManagementPlugin`、域名、图片生成和二次验证插件。仅在 Nest imports 中导入插件不会注册其数据库实体。当前生产配置已包含通知插件；集成测试配置已同步登记。

### 生产启用与验收边界

此改动只在项目内隔离分支完成，没有推送、生产迁移、部署或真实群消息验收。新增迁移为 `AddUnifiedStoreNotifications1790899200000`，只增加所需表和列，重复执行保留现有配置。回退迁移会删除本次新增数据结构，须另行确认；没有在生产执行。

获得上线授权后，先在现有安全配置渠道备份通知配置（不导出机器人凭证），执行迁移并重启后台与工作进程。核验五个新开关、店铺中文名称、工作进程心跳和三类新定时任务；确认接收群与处理入口，发送一条中文自检并回读发送记录和群内消息。

主机健康服务新增持久化目录由 systemd 管理。外部工作流使用现有 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_OPS_CHAT_ID` 安全配置及启用开关，接收群应与后台一致；配置需在受保护的 GitHub Secrets/Variables 中补齐，未配置时明确输出“未发送”。外部状态缓存独立保存，远程检查失败时也会保留已发送状态。部署这些文件和安全配置仍需单独授权。

本地验证覆盖真实临时 SQLJS 数据库的多店铺心跳、评价、事务、权限、滚动计数，新增迁移的重复执行与保留配置；另有上游错误分类、中文模板、快照过期、证书阈值和外部巡检故障分类测试。实际店铺流量、真实 Bot/接收群、上游凭证恢复、生产定时任务和群内实际消息须上线后逐项验收，不能依据本地通过声称全部生效。

### 本次本地验证记录（2026-10-02）

实现位于隔离分支 `feat/all-store-chinese-notifications-20261002`，没有覆盖原工作区修改。发送完成和失败均按领取时的事件状态、发送任务编号及等级执行条件更新，防止旧请求覆盖已排队的恢复消息；发送期间发生的等级升级，在旧请求结束后立即重新派送。

| 验证范围                                                       | 结果                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 通知配置、事件归属、队列、重试、恢复、中文模板、紧急通道       | 定向测试通过；安全开关和恢复设置已覆盖                            |
| 多店铺在线、评价归属、防刷、事务、活动期限、滚动窗口与发送并发 | 临时 SQLJS 数据库集成测试通过                                     |
| 新增迁移与迁移登记                                             | 重复执行保留原配置；迁移登记检查通过                              |
| 新增游客心跳、评价提交和回读、后台查询                         | 实际 Vendure Shop/Admin API 测试通过；心跳不增加页面访问量        |
| 人工智能凭证异常                                               | 失效、账户额度、余额不足及恢复测试通过；普通限流、模型权限等排除  |
| 后台登录与二次验证                                             | 实际 GraphQL 登录集成测试通过；可选的完整二次验证浏览器用例未执行 |
| 客服评价前台                                                   | 真实浏览器验证保存中、保存成功、修改、失败中文提示及本地预览排除  |
| 类型与构建                                                     | 四个后端插件类型检查与构建通过；前台和管理后台类型检查、构建通过  |
| 外部巡检                                                       | 故障分类、重复提醒、恢复和证书测试通过；脚本及工作流语法通过      |

本轮只执行相关测试，没有运行全仓 CI。测试使用本地临时数据库与模拟发送，不向真实接收群发送通知；生产配置回读和群内消息仍待上线后验收。


启用统一店铺通知的应用必须在 Vendure 的 `plugins` 列表中显式注册 `OperationsDashboardPlugin`，与 `StoreManagementPlugin`、`ImageGenerationPlugin`、`TwoFactorDashboardPlugin` 一起使用。生产配置已包含该插件；测试应用也需要显式注册。Vendure 在运行插件配置回调之前收集实体，不能在配置回调里临时追加数据库插件。

新增在线、评价、活动、AI 凭证和安全开关初始关闭。生产启用操作先备份配置和验证 Bot，再统一开启并回读十类开关，最后发送按发布 SHA 去重的中文自检；单独部署代码不会启用这五类通知。
