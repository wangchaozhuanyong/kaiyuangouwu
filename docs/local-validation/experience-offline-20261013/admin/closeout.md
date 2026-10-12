# 后台性能与人工订单读取重构证据

项目：vendure-master；本地基线 main e754de52。生产发布由主任务统一协调，此文件不宣称已发布。

已完成：

- 订单分类、搜索、金额/数量排序、分页和数量聚合下推 SQL；完整 Order 关系仅加载当前页。业务分类与 canonical summary / 数字交付数量规则对齐，保留退款 quantityGroup、已领取与通知独立状态、真实文件存在、人工逾期与物流 due。
- 新 `PendingManual` / `AwaitingManualPayment` 为真实待核款；`LEGACY_TEST` 显式保留历史模拟单。核款与资金复核权限来源于共享财务能力；已登记实收不能取消，退款专用 Settled 记录仍阻断履约。
- 数字内容元数据批量读取，无解密、签发链接或领取副作用；文件批读仍使用原存储路径和 isFile 检查。
- 保留标签页 memo、稳定 Context、活动页订阅、隐藏/离线暂停与草稿缓存上限。资源域由 GraphQL 根字段决定，人工支付动作同时更新订单、库存和营销；实际读取45秒超时，失败保留内容，恢复只重试读取。
- AppShell 引导沿用原 Apollo 缓存，添加共享超时和活动条件，恢复/延后失效时更新能力快照。

已运行的证据：

| 检查                                   | 结果                                                                                                 | 文件                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Commerce 汇总、服务、数字批读、SQL投影 | 5文件62项通过（追加人工场景前）                                                                      | backend-final-tests.log                                                                                                  |
| 最后汇总/服务/SQL分类定向项            | 3文件48项通过，1项规模测试按有效证据复用                                                             | backend-closeout-tests.log                                                                                               |
| 实际 Apollo /标签/缓存/SSE公共检查     | 8文件71项通过                                                                                        | public-layer-final-tests.log                                                                                             |
| 实际 Apollo 超时/重试/资源域           | 2文件37项通过                                                                                        | apollo-final-tests.log                                                                                                   |
| 最后新增退款准备资源域                 | 1文件30项通过                                                                                        | resources-closeout-tests.log                                                                                             |
| AppShell 能力/店铺切换+实际Apollo      | 3文件15项通过                                                                                        | shell-final-tests.log                                                                                                    |
| 后台公共架构门禁                       | 通过（332 source /310 mutations，后续支付新增字段将由总构建再核验）                                  | feedback-check.log                                                                                                       |
| Commerce TypeScript                    | 通过（后续核款退款与大小写收敛由统一构建覆盖）                                                       | commerce-types.log                                                                                                       |
| SQLjs真实投影规模                      | 1千/1万订单固定3SQL，p95 45/253ms；纯投影，不含页面图 hydration                                      | order-projection-scale-sqljs.json                                                                                        |
| Owned MySQL真实投影与分类              | corrected job 3项通过exit0；1千/1万固定3SQL，p95 49/410ms；纯投影                                    | order-projection-scale-mysql.json；reports/order-closure-mysql/1791831421760/admin-order-projection-mysql-corrected.json |
| Chromium 390/1440公共runtime           | 缓存标签p95 39.8/40.5ms；8clean+2dirty、隐藏portal、双层Escape、scope清理、离线保留通过，无pageerror | admin-browser-check.json / admin-performance-390.png / admin-performance-1440.png                                        |
| diff空白校验                           | 通过                                                                                                 | 已实际运行git diff --check                                                                                               |

首次 MySQL fixture 因 transactionId 错被声明成整数失败，已修正为真实字符串列；失败与 corrected 完整日志均保留。首次浏览器脚本将 alertdialog 查成 dialog，已按真实无障碍角色修正，原失败日志 browser-check-attempt1.log 保留。

最终 MySQL 大小写比较和“Settled但仍资金复核”两项分类已由同一 owned runner 执行 `admin-order-projection-classification-final`：2项通过/1规模测试复用，exitCode 0，已核验 json 与完整日志。后台完整构建、真实 API 回归、生产发布与线上验收由主任务统一执行。上述合成样本不替代真实业务/生产性能验收。

## 完整订单接口的最终本地证据

真实 Vendure schema、服务注入与 Admin HTTP GraphQL 已完成集成规模验证。使用当前后台完整 `GET_SALES_ORDERS` 文档，包含订单关系、商品、付款、处理汇总和分类计数。每单一条真实商品行，固定每页20条；1千和1万订单分别读取一次冷页及20个完整分页样本。

| 存量订单 | 完整HTTP p95 | 冷页 | 完整订单/行上限 | 实测数据库查询数 |
| --- | --- | --- | --- | --- |
| 1,000 | 343.65ms | 311.68ms | 20 / 20 | 103–308；20样本中19个为103或106 |
| 10,000 | 597.98ms | 394.49ms | 20 / 20 | 103–106 |

完整原始样本为 `order-api-integrated-mysql.json`，权威进程结果为 `reports/order-closure-mysql/1791831421760/admin-order-api-integrated-scale-owner-scope.{json,log}`：1项通过，exitCode 0。保留800ms断言，真实待核款、目标店铺、完整20条关系以及数字/实物数量断言均通过。计数器记录同一应用进程的全部数据库查询，未分请求归属；1千样本的单次308查询不能据此断言具体后台来源。每页记录的完整实体始终仅20个唯一订单和20条唯一商品行。

集成验证实际发现并修复卡密库存记录没有 `channelId` 的问题。库存通过 `deliveryId` 关联交付记录，再按订单和交付目标店铺过滤；保留来自供应店铺的合法库存。数字批读采用同一目标交付归属。最小SQL夹具移除虚构的库存店铺列，SQLjs分类/搜索与数字批读6项通过，owned MySQL分类2项通过，规模项复用；最终相关文件ESLint和集成QA类型检查通过。

失败证据按新job ID完整保留：依赖对象身份冲突、平台付款方式创建权限、重复规格组合、未注册店铺名称字段、真实库存列错误。前四项修复测试环境或真实夹具，库存列问题修复业务源；未关闭生产约束、缩减真实查询字段或放宽性能断言。

此测试仅使用原控制句柄所拥有的隔离MySQL、新建临时数据库和合成订单，没有外部支付、邮件、生产读写。环境Apple M4、10逻辑核、16GiB；该结果不替代生产实例的长期采样或真实用户指标。

最后低负载、独立SQLjs分类/搜索/规模3项全部通过，1千/1万订单纯投影p95为36.35/219.53ms，仍固定3次SQL（`projection-isolated-final.log`、`order-projection-scale-sqljs.json`）。受影响后端按依赖顺序完成 `storefront-content-plugin`、`store-management-plugin`、`commerce-fulfillment-plugin` 构建，三个进程均exit0，分别见 `content-build-final.log`、`management-build-final.log`、`commerce-build-final.log`。

`backend-final-inputs.json` 记录构建命令与1,411个源码/配置输入SHA256；构建后逐项核对无输入变化。已有core、cart和其它成功检查在相关输入未变范围内复用；本子任务截至代码与本地验证完成，统一发布和线上验收由主任务负责。

## 发布前的后端构建闭包

按真实 `scripts/ci-impact.mjs` 和 `scripts/ci-run.mjs` 生成本次28个affected包计划，`--include-dependencies`实际闭包为30包。补齐25包，复用最终源码未变的core、cart、storefront-content、store-management、commerce五包成功构建；覆盖缺口为零。

补充构建使用workflow公开build-check环境，dotenv明确指向项目内空环境文件，可控暂存路径位于本项目。DevServer分别完成server和worker类型检查及真实CLI构建，没有启动服务、连接数据库或调用外部系统。已有next-admin和storefront成功构建由主任务复用，本阶段不重复。

旧Angular库第一次构建因重复的ProseMirror类型身份失败；按主任务授权，仅移除11个已经核验版本与入口SHA256相同的workspace生成缓存指针，保留原target以供恢复。源文件、锁文件、版本和构建规则均未变化，不删除底层不同版本缓存。定向修复后admin-ui、ui-devkit、dashboard、graphiql以及admin-ui-plugin实际构建全部通过。

总证据为 `ci-closure/backend-ci-closure-final.json`，详细命令、进程exit0、输入SHA及失败记录在同目录。最终复核1,411个已冻结后端输入无变化；compiled目录未包含tracked源码。这里验证的是本地affected构建闭包与打包输入约束，不宣称远端CI、生产运行包或部署已完成。
