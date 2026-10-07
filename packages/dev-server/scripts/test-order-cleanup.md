# 冻结测试订单清理工具

`test-order-cleanup.mjs` 是独立操作工具，不随服务启动运行。默认只预览；只有显式 `--mode=apply` 才写数据库。用户已授权将确认目标实例的冻结点现有测试订单清理，不要求订单存在 test 标记；读取到候选集合本身不证明这些行属于该授权的测试范围。

当前已验证本地 SQLjs 事务和关联图 fixture。生产实例身份、生产 MySQL 行为、实际停写、线上备份与全部真实关系均为 `NOT_VERIFIED`；当前生产连接 `NO_ACCESS`，生产执行保持 `HOLD`。本地工具交付不代表数据已经清理。

## 准备与凭据

- 只在唯一确认的目标实例操作。工具从实际数据库名、主机、端口、server ID 计算身份哈希，不使用应用默认连接或猜测环境。
- 通过现有秘密管理机制注入 `TEST_ORDER_CLEANUP_DB_HOST/PORT/USER/PASSWORD/NAME`。工具不自动加载 `.env`；禁止将密码放在命令参数、日志或交付说明里。
- `TEST_ORDER_CLEANUP_BACKUP_KEY` 是独立保管的 32 字节密钥的 base64 表示，用于 AES-256-GCM。只在内存使用，不写入备份、预览或 receipt；不要在终端显示它。
- 输出必须在当前项目内部的 `artifacts/` 子目录。已有同名文件拒绝覆盖，目录软链接不得逃逸出项目。冻结集合、公开预览和 receipt 仅含 ID、数量、状态、净额和公开哈希；原始订单、付款元数据、钱包字段和卡密只存在于加密备份中。
- 冻结前暂停结算下单、Admin 订单写入、支付回调、库存/数字交付/返利/营销/统计等会修改目标图的工作者及定时任务。记录暂停来源、实例、时间和复核人，把该证据的 SHA-256 作为 `freezeEvidenceHash`。工具无法代替对外部写入进程的现场核实。

## 可处理和停删范围

订单及关联付款/退款、履约、订单修改、历史、库存流水、批次流水、费用、数字交付、订单券使用、订单归因、USDT 意向、售后以及订单评价会进入关联图。真实外键优先；裸 `orderId/orderLineId/...` 使用明确实体映射；评价/反馈只存 `orderCode` 时按冻结订单编号匹配。手动交付事件不会套用自动卡密交付 ID。

保留登录会话，清空冻结 `activeOrderId`。保留购物车身份、未消费商品数量、选择状态及命令凭据；清空被冻结结账和订单行投影、使购物车回到 OPEN 并提升 revision，删除相应 checkout/checkoutLine 快照。订单通知按已实现的 typed sourceId、payload.orderId 或 `ORDER/AFTER_SALES:sourceId:version` 精确关联删除；保留非订单通知、平台通知配置及无法反推订单的技术信号，不尝试撤回已发送外部消息。

保留店铺、客户、商品、仓库、供应商、采购基础数据及现有库存基线。库存按仓库和 SKU 撤回目标订单的净流水：`allocatedNet = ALLOCATION + SALE - RELEASE`，`onHandNet = SALE + CANCELLATION`，恢复量为当前值减净量。已取消、已退款记录不再整单补库；重复执行不二次补库。必须提供每个影响 SKU 的历史库存跟踪布尔证据 `trackingByVariant`，不能用当前设置推断历史。批次净量与仓库净量不一致时停删。

已领取优惠券保留领取次数和 entitlement，只撤回目标订单占用/使用。钱包只撤回可明确归因的目标订单 ledger 净增减；基线缺失、最新余额与 ledger 快照不一致、目标之后存在其他流水或任意无法归因提现均停删。客户经营指标只作废订单派生部分；保留客户、拒绝联系标记及人工运营偏好。

下列情况会给出具体 blocker，`canApply=false`，不删除数据：

- 新订单不在冻结集合、冻结订单缺失、实例/截止点/图或结构发生变化；未知关联表、无稳定主键、未解释依赖循环/跨订单共享依赖。
- 同订单行在多仓存在无法解释的 SALE/CANCELLATION/RELEASE，库存跟踪历史不明、恢复后负库存，批次映射/净量冲突，拆包或物理退货映射未验证。
- 数字限额没有唯一订单 quota ledger；卡池到库存/供货映射未知。已分配、已发送、已揭示或揭示未知的卡密预览为 `DISABLED`，保留 encryptedPayload/fingerprint。只有明确未揭示且从未发送的 `RESERVED` 可提出恢复可售候选；库存映射仍须先解释，当前工具不会自动放行该类订单。
- 真实链上交易/匹配证明存在、提现或其他外部钱包关系无法解释。保留证据，不调用真实支付网关退款、区块链转账或通知接口。

读取有明确边界：最多 10,000 个现有订单、单次查询最多 20,000 行、关系扩展最多 30 轮。超限停下复核，不静默截断为已完整清理。

## 阶段命令

以下均从项目根目录运行。`<artifact-dir>` 必须替换为本项目内的具体 `artifacts/...` 绝对路径；`T` 为已核实 UTC 冻结截止点。连接和密钥先由秘密管理机制注入。

工具连接的 MySQL driver 与 session 均固定 UTC。数据库无时区 datetime 按 UTC 解释，带 `Z` 或时区偏移的值保持其实际时间；冻结、预览、备份、执行与恢复采用同一规则，无需依赖运行机器的 `TZ`。截止点建议使用带 `Z` 的完整 ISO 时间。

1. 记录集合（只读数据库，生成冻结文件）：

    ```sh
    node packages/dev-server/scripts/test-order-cleanup.mjs --mode=freeze --cutoff=T --out=<artifact-dir>/freeze.json
    ```

    冻结文件默认 `allOrdersAtCutoffAreTest=false`、`writersPaused=false`、`queuesPaused=false`，不得因为生成成功就改为已核实。先逐订单核对，或引用覆盖该实例/截止点/ID集合的测试范围证据，确认候选集合对应已授权测试范围后才填 `allOrdersAtCutoffAreTest=true`；未确认时仍可看净影响预览，但 `TEST_ORDER_SCOPE_NOT_CONFIRMED` 会阻止写入。测试范围确认与停写、备份、净影响是独立门槛，不能互相替代，无需重新征求已给出的测试单清理授权。实际完成暂停后填入两个 true、公开的证据哈希，以及每个影响 SKU 的 `trackingByVariant` 布尔证据。必要时提供明确未揭示卡密 ID 的 `unrevealedPoolItemIds`，它不能覆盖已发送或揭示审计。冻结文件不包含密码或卡密。

2. 预览（未传 mode 也只会执行这一阶段）：

    ```sh
    node packages/dev-server/scripts/test-order-cleanup.mjs --freeze=<artifact-dir>/freeze.json
    ```

    逐项核对 `deletionCounts`、`preservedBaselineChanges`、`inventoryNet`、`blockers`、`gates`。预览会提供 `targetFingerprint`、`cutoff`、`orderSetHash`、`freezeHash`、`snapshotHash`、`planHash`。未知净影响未解释前不得执行；不能删除 blocker 或用改预览哈希绕过。

3. 同一冻结窗口制作加密关联图备份：

    ```sh
    node packages/dev-server/scripts/test-order-cleanup.mjs --mode=backup --freeze=<artifact-dir>/freeze.json --out=<artifact-dir>/order-graph.encrypted.json
    ```

    记录公开 `backupHash` 与 `planHash`，与预览逐项比对。该备份绑定实例、冻结集合、完整相关行、实际表/列/主键/外键和恢复补丁；读取期间使用一致事务。将现有受管数据库备份的引用和恢复核验记录一并归入执行证据，原始恢复数据继续按现有加密备份机制保管。

4. 唯一发布负责人确认全部门槛后显式执行：

    ```sh
    node packages/dev-server/scripts/test-order-cleanup.mjs --mode=apply --freeze=<artifact-dir>/freeze.json --backup=<artifact-dir>/order-graph.encrypted.json --backup-hash=BACKUP_HASH --plan-hash=PLAN_HASH --target-fingerprint=TARGET_HASH --order-set-hash=ORDER_SET_HASH --cutoff=T --pause-evidence-hash=EVIDENCE_HASH --out=<artifact-dir>/execution-receipt.json
    ```

    CLI 还会确认外部冻结文件与加密备份中的冻结内容一致。写入前先独占创建并同步 `EXECUTION_PENDING` receipt；数据库事务使用 SERIALIZABLE，在 MySQL 锁定冻结订单，再核对全部备份行和结构哈希。按已计算净量恢复基线，依外键顺序删除派生记录；任何 SQL/复核失败整笔回滚，不禁用外键。提交后返回 `APPLIED` 和安全 receipt。若最终 receipt 文件写入失败，输出仍明确 `APPLIED` 与 `WRITE_FAILED_RETAIN_STDOUT_RECEIPT`：保存输出内的 `receipt` 对象供恢复，不得把它当作未提交。重复执行用新的 receipt 文件名，匹配空订单和基线后返回 `ALREADY_APPLIED`。

5. 在同一停写窗口执行恢复（保持停写；若业务已恢复或图发生漂移，不覆盖新业务）：

    ```sh
    node packages/dev-server/scripts/test-order-cleanup.mjs --mode=restore --freeze=<artifact-dir>/freeze.json --backup=<artifact-dir>/order-graph.encrypted.json --backup-hash=BACKUP_HASH --plan-hash=PLAN_HASH --target-fingerprint=TARGET_HASH --order-set-hash=ORDER_SET_HASH --cutoff=T --pause-evidence-hash=EVIDENCE_HASH --receipt=<artifact-dir>/execution-receipt.json --receipt-hash=RECEIPT_HASH
    ```

    核对执行 receipt 的身份、备份、计划和提交后图哈希；父行先恢复、子行后恢复，基线恢复为备份原值，并验证恢复后图哈希完全一致。已恢复时返回 `ALREADY_RESTORED`，提交后数据有任何漂移时拒绝恢复。密钥或 receipt 遗失需要按既有受管数据库备份恢复流程处理，不猜测恢复量。

## 本地验证

```sh
node --check packages/dev-server/scripts/test-order-cleanup.mjs
node --test packages/dev-server/scripts/test-order-cleanup.spec.mjs
```

用例覆盖实际 SQLjs 外键关系、净库存恢复、领取券基线、钱包净额、关联图删除、重复执行、事务回滚、备份/计划/实例/数据漂移、未知关系停删、裸订单编号、手动/自动交付同 ID、揭示卡密保护、二进制恢复、钱包异常、执行记录持久化和加密恢复。它们不替代生产 MySQL、全量真实数据预览、生产备份恢复核实或线上业务验收。
