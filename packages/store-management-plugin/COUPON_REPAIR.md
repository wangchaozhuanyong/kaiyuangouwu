# 优惠券生命周期修复与旧券校正

## 已确认的规则

- 相对有效期自领取成功开始计时，7 天为连续 168 小时。领取结束不影响已领取券的剩余使用时间。
- 取消或全额退款返券沿用原到期时间。只有当前核销订单匹配事件订单时才返券；部分退款、关闭返券或已经到期不会恢复使用资格。
- 实体券活动使用发放数量、每客领取次数、实体券状态控制资格。普通促销保留原生累计使用次数限制；未配置相对天数的历史券保留固定使用时间。
- 分类券支持一级分类及全部下级分类；商品页按当前规格和同店铺祖先分类判断。缺少分类数据时不推测优惠。

## 接口与兼容

Shop API 增加 `ProductVariant.storeCouponCollectionIds: [ID!]!`，已领券增加 `collectionIds`、`productVariantIds`。
服务端结算和该字段共用分类解析逻辑。前端以有效已领券补足已经结束发放的活动。
不新增数据库表、列或迁移。发布时先确保后端新字段可查询，再切换依赖这些字段的前端版本。

## 先预览，再执行

工具：`packages/dev-server/scripts/repair-coupon-lifecycle.mjs`，在仓库根目录运行。
复用现有 `SUPERADMIN_USERNAME`、`SUPERADMIN_PASSWORD`、`VENDURE_API_ORIGIN`；通过现有安全环境注入，不把凭据写入命令、报告或仓库。
`--channel-id` 与 `--campaign-id` 必须填写目标 Admin API 返回的 GraphQL ID，不能用店铺 token 替代 Channel ID。
每个活动独立预览、审核和提交；同一店铺多个活动逐个执行。

```bash
node packages/dev-server/scripts/repair-coupon-lifecycle.mjs \
  --channel-id '<目标店铺 ID>' --campaign-id '<目标活动 ID>' \
  --out /绝对路径/coupon-preview-001.json
```

预览只读，包含目标店铺、活动、修改前快照、每张券的原值和目标值、版本号、SHA-256 指纹。
输出文件不可覆盖；每次使用新文件名。审核 `changes.promotion`、`changes.config`、`changes.coupons`，保留完整预览文件。

```bash
node packages/dev-server/scripts/repair-coupon-lifecycle.mjs \
  --channel-id '<同一店铺 ID>' --campaign-id '<同一活动 ID>' \
  --apply --plan /绝对路径/coupon-preview-001.json \
  --out /绝对路径/coupon-receipt-001.json
```

远程写入还需明确加 `--allow-remote`。该开关只确认目标环境，不能替代审核。
实际应用提交保存的指纹，服务端在事务内重新读取并比较；不会自动用新计划替换已经审核的计划。
后台写入要求当前操作者有 UpdatePromotion 权限，并验证当前密码。预览要求 ReadPromotion 权限。

## 校正内容与保护

- 只处理当前店铺、已有实体券配置及资格条件的活动。
- 相对期限活动清除底层促销开始/结束限制，并把旧促销日期、发放总量补入缺失的领取配置。实体券活动清除原生累计总使用次数/每客使用次数限制。
- 使用原领取时间计算完整期限。人工作废、无限期或曾明确延长超过完整期限的券不改动。
- 误过期且完整期限仍未结束、活动有效、没有尚未退回的核销分配记录时，恢复 AVAILABLE/RETURNED。已核销券只校正时间；停用/删除活动的券不恢复资格。
- 只更改计划列出的日期、状态；核销、订单分配、退款历史不删除。每张变更券追加 CORRECTED 流水，包含指纹和修改前后值。
- 领取与校正使用同一活动配置行锁；每张券按版本条件更新。期间有新领取、核销或返券等变化导致版本/指纹不符时，整次事务回滚，必须重新预览审核。
- 成功后重新预览应无差异。用新无差异计划再次执行不增加修复流水；重放过期的旧指纹会安全拒绝。

回执包含应用指纹、变更券数量和应用后的预览。它与原始预览组成恢复审计依据。
不要直接把旧快照批量覆盖回数据库：后续可能已有订单使用。若需撤回修复，先按最新版本和流水生成独立补偿方案。

## 验收与发布

现有回归命令：

```bash
bun run --cwd packages/store-management-plugin test src/promotion/store-coupon-lifecycle.service.spec.ts src/promotion/store-promotion-campaign.service.spec.ts src/promotion/store-commerce-promotion-actions.spec.ts src/promotion/store-coupon-repair.service.spec.ts
bun run --cwd packages/store-management-plugin test:coupon-e2e
# 仅连接一次性本地 MySQL 测试库，端口由本次测试环境提供：
CI=true DB=mysql E2E_MYSQL_PORT='<本地测试端口>' bun run --cwd packages/store-management-plugin test:coupon-e2e
node --test packages/dev-server/scripts/repair-coupon-lifecycle.spec.mjs
bun run --cwd packages/storefront test src/storefront-coupons.spec.ts src/product-navigation.spec.tsx src/storefront-ui/cart-ui-interaction.spec.tsx
bun run --cwd packages/next-admin test src/pages/Marketing/promotion-editors.spec.tsx
```

必须分别记录 SQL.js 全流程、MySQL 并发、受影响包检查/构建、桌面/手机浏览器验证；组件模拟接口验收不代表生产验收。
E2E 自动生成 `e2e/__data__/coupon-repair-audit.json`，该文件仅包含一次性测试库样例，不能用于生产执行。
生产发布遵循 `deploy/DEPLOYMENT_RUNBOOK.md`，逐店生成真实预览后再校正，另行保存生产 SHA、发布证据、预览、回执和生产验收结果。
