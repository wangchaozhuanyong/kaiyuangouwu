# 订单管理闭环联合发布候选（2026-10-05）

状态：代码完成，订单与商品领域已集成到最新本地主线基线，受影响功能的本地验证完成。候选位于独立工作树，未提交、推送、合并 main 或部署。真实资金、外部邮箱收件、生产迁移和生产运行 SHA 尚未验收；本地模拟结果不能代替这些结果。

## 当前候选与归属

- 当前工作树：`vendure-master/.codex-worktrees/order-closure-current-main-20261005`，detached HEAD `a9109e4cf3850f3ca41616c26f1a045968583be5`。该 HEAD 是集成基线，不是最终发布 SHA。
- 原订单候选：`vendure-master/.codex-worktrees/order-processing-closure-20261004`，原基线 `8044f0685c9e6194da4622efe274cb3b8ec2c060`，原源码指纹 `4a84c0830c5b8a930a61c4d1b9ff76a268ddc2bcbeab7165fed6c041bbe43976`。原源码保持冻结。
- 对最新 main 的 29 个重叠文件作三方集成，解决 17 个冲突。保留最新导航、手机布局、AdminField 表单、说明交互、单店铺商品归属、钱包并发与退款重放保护、iCloud 两个既有迁移。没有用旧候选整体覆盖 main，也没有修改主工作区的其他未提交内容。
- 商品窗口“修复后台创建时间未显示”的最终 131 个文件输入已集成，原来源基线 `96d8b5d0ce4824d282524f27024b66aa9fb1faa6`，冻结快照和哈希位于原订单工作树 `reports/digital-final-integration-20261004/`。本窗口没有修改对方工作目录。
- 商品领域维护类型表单、类型专用保存、数字额度、实物库存、私有文件版本及领取权益；订单领域维护操作台、修改结束、资金退款、费用利润、补款和提醒。复用同一套数字资源与领取服务。
- 当前 266 个发布源文件及证据哈希见本工作树 `reports/order-processing-closure-final-evidence.json`。中央集成须按该清单的 `root` 读取当前文件；原工作树同名清单仅作为更新入口，不能再从原工作树提取旧文件冒充当前候选。

原商品报告为 `docs/architecture/digital-physical-product-domains-20261004.md`；当前联合行为、验证和剩余事项以本报告为准。

## 商家与客户的完整流程

| 情况 | 操作 | 完成结果 |
| --- | --- | --- |
| 人工账号／文本 | 核对交付邮箱与应交数量，按件输入或批量粘贴，预览后发布 | 内容已可领取；邮件通知与客户领取单独记录，通知失败保留待办 |
| 卡密 | 平时导入卡密，付款后系统分配，缺卡时补卡 | 正确数量可领取；补交仅补新增数量，重发只发原领取链接 |
| 私有文件 | 商品绑定私有版本，足额付款后开放领取 | 明确点击才记录领取；下载复核当前权益，成交版本固定 |
| 实物 | 核对地址、填承运商和运单、发货、跟进送达 | 发货是阶段完成；有效送达后完成交付。退货验收与退款分别处理，合格验收后才回库 |
| 混合订单 | 分别处理数字区块与实物区块 | 所有有效明细交付完成，资金待办处理完成；运费只归实物部分 |
| 修改订单 | 保存并结束，或放弃未提交修改 | 无差额恢复实际处理；加价待补款；减价通过原支付来源退款 |
| 取消／退款 | 查看历史实收、退款预占、已退和待退，按有效来源处理 | 取消停止交付，已收款仍需明确退款；按件退款暂停对应份数，金额补偿不扣交付份数 |
| 余额补款 | 本人登录订单所属账户，确认当前差额后提交 | 实际预占、扣账；支持部分补款、多次修改，重复请求不重复扣款 |
| USDT 补款 | 确认后创建当前订单报价，按指定网络和完整金额付款 | 固化链上回执确认后结算；只读刷新不建新请求，超时与异常到账保留待核验 |

列表默认待处理，数字待交付、实物待发货、异常、售后退款与全部订单共用 `OrderProcessingSummary`。详情展示当前情况、下一步和结果，财务、优惠券和历史作为次要资料。说明采用已有说明按钮，保留当前操作必需的错误与数量提示。

数字与实物是独立表单及后端保存契约。纯数字接口拒绝物流、仓库、批次和包装费用写入；数字物流成本为“不适用”，无需填写零。实物适用但尚未核算的费用继续保持未知。两类商品均按当前店铺保存，不通过更多设置跨店分配。

人工内容按件对应，支持既有格式批量粘贴和预览；保存草稿不发邮件，发布后发送安全领取链接。订单中心和邮件入口领取同一内容。“已可领取”“邮件发出／失败”“客户领取／未领取”分别显示。通知失败不会假装客户已经收到，也不会重新取卡或重复交付。

余额部分补款成功后，若刷新失败或仍返回旧金额，客户端保留成功结果并锁定按钮，确认剩余金额后才允许继续。订单确认凭证仅能处理该订单，不能读取其他订单或使用客户钱包；余额补款必须本人登录。

## 服务端资金、交付与权限规则

- 保留 Vendure 底层状态，页面、直接接口、重试、后台队列都重新校验资格；通用履约不能绕过数字内容准备。
- 测试支付不支持真实退款；授权只在渠道支持时撤销；已结算支付不能伪装成已撤销资金。历史实收与退款独立于取消后的零数量或金额。
- 订单取消只释放尚未扣账的余额预占。已扣账或部分退款的钱包交易不随取消自动返还，由明确的已结算退款入账；保留最新主线的锁与幂等重放保护。
- 退款核验正整数金额、店铺、原支付及剩余额度，处理中占额度，失败保留原记录，幂等重试不新增退款。线下凭证与 USDT 采用对应核验流程。
- 同一份商品通过多笔支付分摊退款时，金额归各原来源，商品份数只预占一次。任一分片处理中或成功均保留份数限制，全部失败才恢复；失败分片在原记录上重试。售后仅在全部关联分片成功且金额满足时完成。
- 按件退款暂停或撤销对应领取与下载；金额补偿不扣份数。已有有效按件退款的明细不直接加量重开资格，另购新订单可正常交付。
- 已领取的外部账号、卡密和已下载文件无法自动追回，不自动重新入库。历史邮件已发不回填为客户已领取。
- 普通订单查询只返回交付元信息；人工账号与卡密明文须专用权限、显式读取和审计。
- 内容、资源占用与领取资格保持事务一致，通知独立重试。旧明文队列、附件、错误收件人或失效链接在发送前拒绝；邮件扫描器 GET 不记录领取。

主要修改文件范围：`packages/commerce-fulfillment-plugin/src/`（摘要、数字资源、领取、订单、补款与交付）、`packages/core/src/service/services/{order,payment}.service.ts` 及修改／退款辅助、`packages/store-management-plugin/src/{referral,usdt}/`、`packages/catalog-management-plugin/src/`（库存、导入和利润）、`packages/next-admin/src/pages/{Catalog,Sales}/`、`packages/storefront/src/{digital-receipt-panel,order-additional-payment-panel}.tsx`、`packages/dev-server/`（邮件和迁移）、`packages/next-admin-plugin/src/service/order-events.service.ts`。完整路径与哈希以清单为准。

## 最新主线候选的实际检查

本节日志位于当前工作树。测试组覆盖有重叠，不相加为一个整体用例总数；首次失败保留，并仅重跑修正项及直接依赖。没有关闭门禁、提高架构或警告预算。

| 检查 | 当前实际结果与证据 |
| --- | --- |
| MySQL 8.4：真实 Nest DI、HTTP Admin／Shop、事务、状态机、迁移与多连接 | 3 文件 52 场景通过；`reports/order-closure-mysql/1791171844226/api-tests.log` 和 `run.json` |
| 最新主线影响的后端单元 | 4 文件首轮 2 失败、55 通过；两个未改文件 10 项通过，修正后的钱包两个文件 48 项通过。见 `reports/current-main-integration-20261005/{changed-backend-units,referral-repair-final}.log` |
| 后台受影响单元 | 首轮 15 文件 97 通过、1 失败；修正店铺展示名夹具后对应文件 2 项通过，其余 14 文件 96 项通过。表单调整另复验 3 文件 18 项通过。见 `admin-affected-tests.log`、`admin-variants-final.log`、`domain-field-tests-final.log` |
| CSV 导出公式防护 | 既有 9 项通过；去除控制字符正则警告仍保留公式防护，`csv-security-tests.log` |
| 当前客户端订单、领取、补款及 API | 4 文件 148 项通过，`storefront-units-final.log` |
| 当前本地邮件 | 3 文件 45 项通过，包含 5 个回环 SMTP 场景；`mail-units-final.log` |
| 手机与电脑订单、人工追加、商品类型表单 | 20 个订单、2 个人工追加、6 个商品表单场景通过；`browser-{orders,manual-append,product-domains}.log`，两类商品手机截图实际查看 |
| 手机与电脑领取、USDT 与部分余额补款 | 16 个领取、6 个补款场景通过；`browser-{receipt,additional}.log` |
| 数字／实物／混合费用及资源恢复 | 7 个费用、4 个资源恢复场景通过；`browser-{expenses,resource-retry}.log`，包括未知费用、读取失败与只读权限 |
| 生产运行包 | 20 个运行包全部构建成功，另 `@vendure/testing` 构建成功；`runtime-builds.json` 与 `testing-build.log` |
| 生产 server／worker 与三个 API 测试的类型 | 均通过；`server-compile.log`、`worker-compile.log`、`api-test-types.log`。成功日志可为空 |
| Admin 生产构建 | 最后 CSV 修改后构建通过，包括反馈、676 文件显示本地化及生产挂载；`admin-production-build-verified.log` |
| Storefront 生产构建 | 包括 TypeScript 与双因素入口构建均通过；`storefront-production-build.log` |
| Lint | 主线变化的 4 个后端文件 ESLint 零消息；Admin `lint --max-warnings=23` 通过，实际 23 警告且预算不变；`changed-backend-lint.json`、`admin-lint-budget-final.log` |
| 架构与迁移注册 | 既有架构预算通过，150 个活动迁移注册通过（保留主线两个 iCloud 迁移和数字领域迁移）；`architecture.log`、`migration-registry.log` |
| 变更及冲突检查 | `git diff --check HEAD` 通过，无未解决的索引冲突；当前源码和证据哈希核对见最终清单 |

表中未带目录的日志均在 `reports/current-main-integration-20261005/`。浏览器夹具只访问合成内存数据，不访问真实客户接口。MySQL 支付使用合成渠道回执；USDT 使用合成固化回执驱动实际报价、扫描、签名、回调和状态代码，钱包使用隔离数据库中的实际预占、扣账与退款账本。

回环 SMTP 通过实际 EmailProcessor、MJML／Handlebars、Nodemailer 和 MIME 验证人工／卡密通知、450 失败重试、撤销及旧明文阻断；它不证明外部邮箱送达、提供商回执、垃圾邮件过滤或生产 TLS。

原工作树另有 44 文件两批互不重复的 863 项后端单元、148 项客户端单元、171 文件 Lint 等通过证据。当前清单记录复用范围及输入差异；这些历史记录不标为在当前工作树重新运行。钱包、主线表单、邮件、客户端和迁移的变化以本轮定向结果为准。

`reports/order-closure-release-scope-plan.json` 按当前 266 个源文件计算 302 条 CI 检查要求。它是范围计算，不能表示 302 项已执行或远端 CI 全绿。没有触发远端 CI，没有生成最终提交／发布 SHA；统一候选还须按其他候选的最终输入执行相应门禁。

## 迁移、发布与外部验收

数字领域迁移 `packages/dev-server/migrations/1791086400000-add-digital-product-domains.ts` 已在隔离 MySQL 执行及重复执行验证。新增七张表：`digital_variant_config`、`digital_order_reservation`、`digital_quota_movement`、`digital_file_version`、`digital_receipt_access`、`checkout_resource_hold`、`physical_return_receipt`，以及拆包来源 `lotTransfersJson`。保留旧订单、库存、文件和交易记录，down 不删除业务历史。

仍需依次完成：

1. 将本清单纳入统一候选，核对其他候选的共享文件，冻结最终 SHA。当前本地主线三方集成已完成，不能再使用旧的“17 个未解决冲突”结论；其他窗口新增输入仍需中央流程核对。
2. 在目标数据库及私有文件可恢复备份后，使用脱敏历史数据副本演练迁移，核对新表、旧订单、原文件版本与旧库存。隔离测试不等于生产资料已经验证。
3. 使用 `digitalInventoryMigrationPreview` 逐店逐 SKU 核对归属、可售、预占、文件版本和未完订单。共享仓库或历史卡密／文件冲突先处理，不自动把旧库存复制为新额度。
4. 审核预览后分批 `migrateDigitalInventory`，服务端锁内复核数量；全部销售店铺完成切换后才停用旧全局跟踪。私有文件沿用既有 dry-run 和明确清单流程。
5. 使用人类指定的自有测试邮箱验收实际收件、领取与重发，使用指定支付沙箱验收扣款、部分退款、超时回执、余额和 USDT。生产真实收付须另给具体订单与金额授权。
6. 在获得相应授权后完成推送、CI、main 合并、部署及生产迁移，核验运行 SHA、页面、下载、提醒和资金结果。复用已有通过的同输入检查，避免重复触发全量 CI 或同 SHA Production Release。

外部验收缺少自有测试邮箱及支付沙箱／测试店铺目标，已有询问尚未得到目标；不要发送密码或密钥。本任务没有执行真实资金或外部邮件操作，也没有操作生产数据库。生产私有文件、真实送达物流和外部卡密使用结果仍未测量。

发生异常时先停止相关销售、补款与新交付，保留新表及交易历史，核对额度、占用、退款和已领取记录。启用新数字领域或发生钱包扣账后，不能仅回退到使用旧库存／钱包的代码，应先制定数据一致性恢复方案；不自动删除新表或恢复旧可售余额。

## 复现与交付入口

在当前工作树根运行命令，日志写入本项目 `reports/`；先完成受影响包构建再执行 API 测试，避免并行构建清空使用中的 dist。代码未变且已通过的检查不用重复。

```sh
ORDER_CLOSURE_MYSQLD=/absolute/path/to/mysqld node packages/commerce-fulfillment-plugin/e2e/run-order-closure-mysql.mjs
bunx tsc -p packages/commerce-fulfillment-plugin/e2e/tsconfig.order-closure.json
node scripts/check-migration-registry.mjs
bunx tsc -p packages/dev-server/tsconfig.server.json
bunx tsc -p packages/dev-server/tsconfig.worker.json
bunx vitest run --config packages/commerce-fulfillment-plugin/order-closure.unit.vitest.config.mjs <受影响的 spec 文件>
bun run --cwd packages/next-admin build
bun run --cwd packages/storefront build
```

MySQL runner 仅创建随机新库、启动及停止自有实例，不连接、DROP 或 TRUNCATE 现有业务数据库。合成数据库和每轮日志保留在当前工作树，随机测试密码只在进程内使用。快速 SQLjs 测试可用 `PACKAGE=commerce-fulfillment-plugin DB=sqljs bunx vitest run --config packages/commerce-fulfillment-plugin/e2e/order-closure.vitest.config.mjs`；本轮多连接锁证据来自 MySQL。

本地 Admin 5192 与 Storefront 5193 的浏览器脚本分别在 `packages/next-admin/e2e/{admin-layout,order-processing,order-expenses}/` 和 `packages/storefront/e2e/digital-receipt/`。测试数据库、私有样本、截图、日志和临时合并输入不属于发布源文件；清单只列当前源文件与可复现测试。

最终入口为当前工作树 `reports/order-processing-closure-final-evidence.json`。原工作树同名入口指向当前候选，原冻结清单另保留在其 `reports/current-main-integration-20261005/validated-8044-candidate.json`。读取清单时先核对 `root`、`baseHead`、`candidateSourceFingerprint`，再按路径逐文件验哈希；不能用原基线 HEAD 代替未提交候选的发布 SHA。
