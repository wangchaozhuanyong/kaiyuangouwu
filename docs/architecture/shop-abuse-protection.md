# 商城防撞库与兑换码防刷

记录日期：2026-10-17。本文描述防刷增强的实现与验证边界，生产状态以对应正式提交、发布运行和线上验收记录为准。既有 GPT 充值业务是否已上线与本轮安全增强是否上线是两项独立状态；本文不代表通知已开启、管理员已绑定 MFA，或真实充值已执行。

## 入口与执行边界

`ShopAbuseProtectionPlugin` 在 Shop API 根字段执行前通过全局拦截器检查安全预算。识别依据是 GraphQL 实际 `info.fieldName`，不是客户端操作名或别名；同一请求中的每个受保护根字段分别计数。直接调用 API 与网页调用经过同一入口，不依赖前端按钮或 CORS。Admin API 保留现有独立的管理员认证与 2FA 逻辑。

| 动作              | 实际 GraphQL 字段                                                                        | 风险目标                                                      |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LOGIN`           | `login`、`authenticate`                                                                  | 原生登录用户名；Google 登录不把所有用户合并到一个账号失败目标 |
| `REGISTER`        | `registerCustomerAccount`、`registerCustomerWithReferral`、`refreshCustomerVerification` | 邮箱                                                          |
| `PASSWORD_RESET`  | `requestPasswordReset`                                                                   | 邮箱                                                          |
| `PASSWORD_UPDATE` | `resetPassword`、`verifyCustomerAccount`、`updateCustomerEmailAddress`                   | 对应验证或重置 token 的摘要                                   |
| `PASSWORD_UPDATE` | `updateCustomerPassword`、`requestUpdateCustomerEmailAddress`                            | 服务端当前用户 `user:<id>`；不接受客户端指定另一个用户        |
| `RECHARGE_CODE`   | `verifyGptRechargeCode`、`queryGptRechargeCode`                                          | 兑换码                                                        |
| `RECHARGE_SUBMIT` | `submitGptRecharge`                                                                      | 兑换码                                                        |
| `RECHARGE_CONFIG` | `gptRechargeConfig`                                                                      | 无账号目标                                                    |
| `RECHARGE_TASK`   | `gptRechargeTask`                                                                        | 任务标识                                                      |

注册仍遵守原有审核入口：`registerCustomerAccount` 被现有商城访问拦截器禁止，注册页面使用带同意记录的 `registerCustomerWithReferral`。安全映射不扩大注册权限。修改密码或邮箱仍需原有 Owner/会话鉴权；任务查询仍验证任务凭证与店铺归属。此列表是本模块的准确保护范围，不代表全站所有接口都增加了相同策略。

验证码签发另有公开 Mutation `createShopAbuseChallenge(action: String!, target: String!)`，只签发支持的动作并使用独立预算。`RECHARGE_CONFIG`、`RECHARGE_TASK` 仅做请求预算，不触发图形验证码。

## 共享数据库与多维策略

安全状态保存在同一应用数据库的 `shop_abuse_bucket`、`shop_abuse_challenge` 两张独立表。`ShopAbuseStore` 使用 `TransactionalConnection.rawConnection`，避免业务 GraphQL 事务拒绝时连同失败次数或已消费验证码一起回滚。每个预算采用唯一 bucket、忽略重复插入、条件过期重置、带上限的原子自增；并发实例共用相同记录，重启服务不会重置有效计数。数据库故障会抛错，不回退内存或缓存。

计数采用首次请求开启的固定窗口，不是滑动窗口。有效期边界为 `expiresAt <= now` 时失效；过期窗口由下一次写入原子重置。`signal` 的计数上限为 1,000,000，防止整数无限增长。冷却时间只允许延长，不得被并发较短冷却覆盖；计数窗口过期也不会提前解除尚未结束的冷却。

原生账号通过全局 User 与认证密码验证，账户并不按店铺各存一份。因此 `ACCOUNT` 家族的来源失败、目标失败、按来源的动作预算及家族预算跨店共享，发送邮件的目标尝试也跨店累计。切换店铺不能重新获得同一账号或来源的预算。登录、注册、找回密码的邮箱/用户名先去除首尾空白、NFKC 规范化并转小写；同一文本目标在同一 ACCOUNT 家族内共用目标风险。已登录用户目标与验证 token 目标各自计数，不宣称它们都映射成同一个用户计数器。

充值家族的来源和兑换码目标仍按店铺隔离；验码与查询共用 `RECHARGE_CODE` 动作预算，输入码规范化为大写。每店整体风险与总请求预算保持店铺隔离。业务执行器原有的专用服务鉴权、兑换码套餐约束、任务幂等和限流继续存在，不能被本模块替代。

### 请求预算

下列动作限额为同一来源、同一动作每 60 秒的最大放行数，所有请求先计数，再检查风险或进入业务。

| 动作              | 每 60 秒限额 |
| ----------------- | -----------: |
| `LOGIN`           |           20 |
| `REGISTER`        |            5 |
| `PASSWORD_RESET`  |            5 |
| `PASSWORD_UPDATE` |           10 |
| `RECHARGE_CODE`   |           20 |
| `RECHARGE_SUBMIT` |            5 |
| `RECHARGE_CONFIG` |           30 |
| `RECHARGE_TASK`   |           60 |

此外，同一来源 ACCOUNT 家族合计 30 次/分钟、RECHARGE 家族合计 100 次/分钟；每店所有上述受保护字段合计 2,000 次/分钟。任一层预算耗尽即拒绝，已消耗的前置预算不返还。验证码通过不会清零失败计数或重置请求限额，成功业务也不会主动清空已有风险窗口。

### 失败风险与冷却

| 维度                         | 窗口与阈值                   | 实际行为                                 |
| ---------------------------- | ---------------------------- | ---------------------------------------- |
| 同来源、同家族失败           | 10 分钟内累计达到 3          | 后续挑战动作要求验证码                   |
| 同目标、同家族失败           | 10 分钟内累计达到 3          | 换 IP 后仍要求验证码                     |
| 每店、同家族总体失败         | 60 秒内累计达到 50           | 新来源、新目标的后续挑战动作也要求验证码 |
| 同邮箱注册/重发验证/找回尝试 | 10 分钟内第 3 次起           | 要求验证码；地址存在与否一致处理         |
| 注册/重发验证/找回总体请求   | 跨店、跨 IP 每分钟第 30 次起 | 要求验证码，包含业务返回成功外观的请求   |
| 同来源失败累计达到 8         | 10 分钟风险窗口内            | 延长至本次失败后 30 秒冷却               |
| 同来源失败累计达到 16        | 同上                         | 延长至本次失败后 2 分钟冷却              |
| 同来源失败累计达到 30        | 同上                         | 延长至本次失败后 15 分钟冷却             |

冷却作用于来源，不因攻击者反复输错而永久锁死受害账号；账号目标与整体风险主要触发挑战。处于来源冷却时，即使提供正确验证码也不会放行。GraphQL 业务返回带 `errorCode` 的结果或抛出异常时记失败；验证码答错或无效也记失败。请求被限额拒绝或仅缺少应提供的验证码，不再次递增业务失败次数。

发送账号邮件另有现存内核持久预算：同一个全局账号、同一种验证/重置动作至少间隔 60 秒，每小时最多 5 次，保持现有不可区分的成功响应。外层人机验证不替代这项邮件发送约束。

## 验证码安全合同

验证码不是登录凭据或充值授权，正确答案只能让一个已绑定的请求继续接受其余预算、权限和业务校验。

- 签发预算：同店、同来源 10 次/分钟；同店总计 200 次/分钟，计数先于图像渲染和保存。
- `id` 使用 `randomBytes(24)` 产生 48 位十六进制公开标识，随机量 192 位；不能由客户端指定或覆盖已有记录。
- 答案使用密码学随机源 `randomInt`，从 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 的 32 个字符中均匀选择 6 个字符。
- 有效期为 2 分钟；返回 `id`、PNG `imageDataUrl`、`expiresAt`。SVG 仅用于服务器内存中的绘图，先栅格化再返回，不向浏览器发送含答案文本的 SVG 或答案字段。
- 绑定包括当前店铺、可信来源 IP、动作、规范化目标。ACCOUNT 风险跨店共享，验证码本身仍不能跨店、跨 IP、跨动作或跨目标借用。
- 前端用 `x-shop-abuse-id`、`x-shop-abuse-answer` 提交，答案移除空白并转大写；目标若为已登录密码/邮箱操作，使用当前用户的 `user:<id>`，不发送密码作绑定目标。
- 数据库先通过 `publicId + bindingHash + 未过期 + consumedAt IS NULL` 的原子条件抢占消费，再进行恒时摘要比较。答错也消耗此次验证码；绑定不符不会消耗别人的验证码；并发只能有一个提交抢占成功，重放不再有效。
- 图形验证用于提高自动化尝试成本，不承诺阻止全部 OCR、代理网络或人工打码；它与共享请求预算、账号风险、冷却和告警一起使用。

错误通过 GraphQL `extensions.code` 区分 `SHOP_ABUSE_CHALLENGE_REQUIRED`、`SHOP_ABUSE_CHALLENGE_INVALID`、`SHOP_ABUSE_RATE_LIMITED`、`SHOP_ABUSE_UNAVAILABLE`，并附动作及最多 900 秒的 `retryAfterSeconds`。不要只根据 HTTP 状态或客户端操作名判定是否需要验证。

## 数据最小化、TTL 与清理

新安全表只保存 64 位十六进制摘要、随机公开验证码标识、计数及时间。bucket、目标/来源绑定、答案使用现有服务器 cookie 签名密钥计算带域分隔的 HMAC-SHA256；没有存储邮箱、IP、兑换码、密码、Session JSON 或验证码答案原文。已有 MFA 密钥的加密存储、业务任务凭证和业务记录属于各自原有模块，不能把“本安全表只存摘要”解释成全站所有敏感数据都只存摘要。

| 临时记录                               | 有效期或保留边界                                 |
| -------------------------------------- | ------------------------------------------------ |
| 请求预算、验证码签发预算、每店总体失败 | 固定 60 秒窗口                                   |
| 来源/目标失败、邮箱尝试                | 固定 10 分钟窗口                                 |
| 告警节流 bucket                        | 固定 5 分钟窗口                                  |
| 来源冷却                               | 最后一次延长后的截止时间，最长档每次延长 15 分钟 |
| 图形验证码                             | 签发后 2 分钟；消费后仍保留至该有效期结束后清理  |

逻辑过期即不能继续作为有效验证码或旧计数使用，物理删除不保证在到期瞬间完成。只有计数窗口已过期且冷却也已结束的 bucket 才能删除；删除时重新检查条件，避免清理选择与并发续期之间的竞态。

请求路径每个服务实例最多每分钟发起一轮机会清理，每表最多 200 条。另通过现有 scheduler 注册 `prune-expired-shop-abuse-state` 每分钟任务，每轮最多 100 批、每表每批 200 条，即每表最多 20,000 条；没有请求流量时也由调度任务清理。达到批次上限只记录不含身份数据的吞吐警告。调度器未运行、故障或积压时临时记录会延迟删除，需要按现有任务监控处理，不宣称两分钟后数据已经物理清除。

该清理只涉及上述临时安全表，不清业务交易、充值任务、锁、用户或告警事故。持久事故沿用已有通知/事故保留机制，本轮未新增其自动到期删除规则。

## 告警与现有通知开关

同来源失败累计达到 8，或每店/家族总体失败达到 50 时，尝试创建/更新 `security.storefront.abuse` 的 P1、SECURITY 持久事故。按店铺/家族的摘要指纹合并事件；共享数据库 gate 最多每 5 分钟一次更新尝试。日志和 payload 只含事件类型、店铺、动作及失败数，不含原始来源、账号、兑换码、Session 或答案。

接入现有 `AdminNotificationService.upsertIncident`，由 `OperationsDashboardPlugin` 导出，安全插件显式导入该插件。部门路由为 GOVERNANCE 负责、TECH 协作、需要处理；SLA 与升级沿用现有 P1 配置。事故创建与外部消息送达是不同状态：通知关闭时仍可持久化 INCIDENT，投递状态为 `SKIPPED`；没有本模块自动观测恢复并关闭事故的实现。

实际外部投递仍取决于现有通知总开关 `enabled`、安全分类开关 `notifySecurityEvents`、严重级别过滤、Telegram 配置及工作进程。仓库默认总开关和安全分类均为 `false`。本文未读取私密配置，未核实或改变生产开关，也未向外部发送通知。事故写入失败会记录不含异常原文的固定错误，后续是否投递需独立回读验证；不能把日志出现或事故入库视为消息已送达。

## 管理员 MFA 现状

现有 `TwoFactorDashboardPlugin` 已提供管理员密码登录预算、TOTP、一次性恢复码、会话证明与安全操作校验。本轮商城防刷不替代它，也没有替管理员创建或绑定认证器。

截至本文代码，未创建 2FA credential 或尚未启用的管理员仍可通过密码获得会话；这不是强制全员 MFA。已绑定账号的后台会话需要匹配的 2FA 会话证明，API Key 仍按原有机器凭据边界处理，不能用于个人安全设置。

需由真人管理员在现有后台完成认证器绑定、输入动态码确认，并离线妥善保存首次显示的一次性恢复码；不要把二维码、种子或恢复码发给客服、日志或本次文档。TOTP 为六位、30 秒周期，校验包含前后一个周期并拒绝已消费周期；恢复码通过原子版本条件一次性消费。缺少有效的现有 2FA 加密配置会阻止安全绑定/校验，不允许开发密钥兜底。生产是否已配置或每位管理员是否已完成绑定未在本轮核验。

## 代理来源与运维边界

应用只使用 Express `req.ip`，不直接读取客户端自报的 IP 头。仓库拓扑为 Cloudflare → Nginx → `127.0.0.1:3002`；Nginx realip 仅信任已列出的 Cloudflare 网段与本机回环，通过 `CF-Connecting-IP` 恢复 `$remote_addr`，并拒绝非可信来源直接访问 HTTPS 源站。

`location = /shop-api` 明确只发送一个 `X-Forwarded-For: $remote_addr`、设置 `X-Real-IP`、Host 与转发协议并清除 `Forwarded`，不再依赖外部 `proxy_params`。不能先加载含 `$proxy_add_x_forwarded_for` 的文件再追加同名指令并假定后者覆盖；重复头可能保留攻击者链。其他 location 与开发 `trustProxy` 设置未因本修复改变。

上线时应确认实际源站配置和安全组仍限制 Cloudflare 官方网段，应用端口只监听回环且不暴露公网，生产 `VENDURE_TRUST_PROXY` 与实际拓扑匹配。回环允许源站验收注入测试访客 IP，因此服务器上的其他本地进程属于可信边界。新增负载均衡或代理必须重新核对来源恢复链，而不能沿用未经验证的全信任配置。不得通过真实用户兑换码、密码或充值操作验证这些边界。

## 部署、故障与回退

本轮状态为代码与本地定向验证，未推送、合并、运行生产迁移、重载 Nginx、切换应用或开启生产通知。发布沿用仓库现有发布流程，不新增审批流程，也不把本地测试通过写成生产验收。

1. 使用同一最终候选构建后端、包含挑战处理的前端与依赖，完成受影响检查，并确认原有数据库备份/恢复要求已经满足。应用的签名配置需在所有实例间稳定一致；不要为此次上线轮换既有密钥，否则有效摘要和会话可能失配。
2. 在启用新版安全插件前，执行已登记的正式迁移 `1792180800000-add-shop-abuse-protection.ts`，只新增两张安全表及索引。不要通过 ORM 自动同步替代迁移；不要改写或删除既有业务数据。迁移 `up` 可重复检查，已存在的表仍需按发布回读验证结构与索引。
3. 按现有运行包发布顺序启用后端、对应前端和 scheduler。数据表、签名密钥、来源 IP 或验证码服务不可用时，受保护请求返回 `SHOP_ABUSE_UNAVAILABLE`，在业务调用前失败关闭；不能回退成无限尝试或临时关闭校验。
4. 按 `deploy/DEPLOYMENT_RUNBOOK.md` 的隔离候选验证器先检查 Nginx，再使用既有发布脚本安装/语法检查与 reload。验证实际只有一个可信 XFF 值、直接源站旁路被拒绝、各实例共享额度、scheduler 清理及挑战不重放；使用演示数据，不提交真实充值。
5. 独立回读运行 SHA、迁移登记、接口错误合同、匿名/登录交互、其他店铺隔离、事故入库与外部通知状态。管理员绑定 MFA、消息实际送达和真实充值到账各有独立事实，不由此次部署自动证明。

前置数据库/签名/IP 校验失败阻止执行业务。业务已经执行后，失败观察或告警异常只记录固定错误，不将原业务结果改成“尚未执行”的安全拒绝。充值的超时与断网仍遵守原任务幂等和“结果待核对”流程，使用原兑换码恢复查询，不自动重复执行充值。

回退按既有运行包和配置回退流程恢复兼容代码；保留两张安全表、有效计数、挑战消费记录、业务锁及事故证据，不清表、不删除用户或交易。此 migration 的 `down` 主动拒绝破坏性回滚。旧版本代码不会执行新防刷策略，回退后不能声称本轮增强仍在生效，应记录实际运行版本并前向修复；不得用删迁移记录或重建数据库的方式绕过失败。

## 已完成的本地验证与依据

存储及正式迁移的两份真实 SQL.js 定向测试合计 20 项通过，覆盖多实例对象共享计数、并发限额、过期边界、服务重建、冷却单调、挑战一次消费/错绑定/过期/重放、无原文、有界清理及业务哨兵保留；迁移包含六种驱动定义检查。存储包类型检查、ESLint 与 migration registry 检查通过。

代理头的新增三个定向回归与两个相邻 Nginx/CORS 回归合计 5 项通过，使用真实 Express 地址解析器与配置断言。此结果不等于已经运行候选 Nginx：本地没有 Nginx 二进制，本轮未执行生产语法检查或线上请求。policy/interceptor/前端等后续集成检查以本次交付回执为准，本文不预先声明其未完成的结果。

另已运行最小真实 Vendure 启动与 HTTP 验证：使用已构建的插件及 OperationsDashboard 依赖、纯内存 SQL.js、随机回环端口、合成账号，3 项测试通过。覆盖真实 Nest DI/实体元数据/扩展 schema、成功的别名 `authenticate` 返回 token 且禁止缓存、三次真实密码失败后别名第四次请求返回 typed challenge、匿名 PNG/no-store，以及 Admin API 不受 Shop 风控拦截。测试还断言没有非回环外联，并关闭应用。真实事务的 `Observable<Promise<Result>>` 结果必须先解包再观察失败，此行为已包含在生产拦截器修复与本次 HTTP 验收中。结果保存在 `docs/local-validation/shop-abuse-protection-20261017/runtime.log`；不代表生产部署或真实充值验收。

主要实现位置：

- `packages/store-management-plugin/src/abuse-protection/{policy,entities,store,service,interceptor,plugin,tasks}.ts`
- `packages/dev-server/migrations/1792180800000-add-shop-abuse-protection.ts` 与 `migrations/index.ts`
- `packages/store-management-plugin/src/gpt-recharge/{plugin,service}.ts`
- `packages/operations-dashboard-plugin/src/{admin-notification.service,admin-notification-config.service,department-notification-router}.ts`
- `packages/two-factor-dashboard-plugin/src/login/admin-two-factor.{service,interceptor,crypto}.ts`
- `deploy/nginx/damatong.conf` 与 `deploy/DEPLOYMENT_RUNBOOK.md`
