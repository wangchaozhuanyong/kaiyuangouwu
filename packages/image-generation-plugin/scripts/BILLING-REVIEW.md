# 供应商历史费用审定工具

本工具处理已结束的旧提示词费用汇总和单次生图成本事件。历史费用独立存入两张审计表；不会补造旧调用 UUID、逐次记录、响应头编号或完成时间。新增提示词逐次账本的自动账单关联不在本工具范围。

## 发布和检查

先发布 `AddImageProviderBillingAudit1789300800000` 迁移及本批服务端，再发布查询新字段的管理后台。回退应用保留审计表；不自动删除审计历史。

使用已构建的 `scripts/apply-billing-review.mjs`，数据库连接仅从运行环境的 DB_HOST / DB_PORT / DB_NAME / DB_USERNAME / DB_PASSWORD 读取，不把密码放进参数或清单。本工具不自动执行迁移或同步数据库结构。结果路径必须是项目内的绝对路径，并且不能覆盖已有文件。

1. 用 `--manifest <目标清单绝对路径> --output <新快照绝对路径> --inspect` 读取限定频道和目标的最新摘要与前次审定编号。目标清单为 `{ "version": 1, "targets": [{ "channelId": "1", "recordType": "IMAGE_COST_EVENT", "recordId": "2" }] }`。
2. 审定清单为 `{ "version": 1, "reviews": [...] }`，每项遵循 `ImageBillingReview` 类型。将最新摘要写入 `expectedSnapshotHash`，填写审核身份、授权引用、审核时间、账单证据和完整范围；经过批准后才能将 `reviewStatus` 置为 `APPROVED`。
3. 不传 `--apply` 默认只校验。实际写入需同时提供 `--apply --confirm-manifest-sha <完整清单文件的 SHA256>`。远程连接还需 `--allow-remote`。一批最多 500 个唯一目标；初次审定使用相同批次和目标重跑只返回原结果。
4. 工具会先检查全批，再逐条短事务写入。每条目标加行锁并再次校验旧值、审定版本和账单唯一归属。遇到并发冲突立即失败；已经成功的条目保留其审计凭证，修正问题后用同一清单重跑不会重复计费。

## 证据和更正

- 费用以整数微单位存储，客户钱包、退款、额度、任务状态和原始响应证据不在写入范围。
- 供应商账单用“账户范围 + 原样账单编号”的摘要判定唯一性，保留大小写差异，不能分配给另一目标。
- `billedAt` 仅在账单时间和时区已确认时填写 ISO 时间；否则保留 NULL，原样填写 `displayedTime`，未知 `timeZone` 保持 NULL。不能推算时间充当供应商证据。
- 审定方式是 `CROSS_MATCH_REVIEWED`，不冒充编号直接匹配。前端显示账单归属、原金额、新金额、审核来源及完整更正链。
- 更正必须使用新批次、新快照及最新 `previousAdjustmentId`，并保留原有账单集合。更正为未知金额时金额和币种均设为 NULL；追加 `COST_REVERTED` 记录，不删除旧记录，不重新分配账单。
- 同一清单重跑后若原审定已被后续更正，返回 `superseded: true`。最新费用被外部更改时拒绝把重跑当作校验成功。

## 定向验证

- 本地 MySQL 事务和迁移：在 dev-server 中运行 `DB=mysql E2E_MYSQL_PORT=13370 vitest run --config vitest.config.mts migrations/add-image-provider-billing-audit.spec.ts`。
- 工具参数验证：在 image-generation-plugin 中运行 `vitest run scripts/apply-billing-review.spec.mjs`。
- 真实 GraphQL 流程沿用 `e2e/image-generation.e2e-spec.ts` 的优化生成流程和历史费用审定用例，测试明确使用本地 MySQL。
