# Vendure 生产发布手册

最后核对：2026-09-05

本文件只记录稳定的部署入口和无密钥操作流程，不保存密码、令牌、数据库连接值或私钥内容。

## 项目与入口

- 本地项目：`/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master`
- Git 仓库：`git@github.com:wangchaozhuanyong/kaiyuangouwu.git`
- 发布分支：`main`
- 包管理器：Bun（仓库根目录使用 `bun.lock`）
- MOYAO AI 主网店：`https://moyaoai.com`（`www.moyaoai.com` 301 回主域）
- 美宜佳网店：`https://damatong.net`（`www.damatong.net` 301 回主域）
- 统一管理后台：`https://console.moyaoai.com/dashboard/`
- 兼容入口：`https://console.damatong.net/*` 301 到统一管理后台
- 主健康检查：`https://moyaoai.com/health`

## 分支、标签与发布记录硬规则

1. 其他分支中的生产修改必须先基于最新 `origin/main` 整理，只把本次经过审核的差异合并进 `main`。合并前必须检查完整 diff 和变更文件清单；禁止把旧工作区、历史发布目录、WIP 快照或长期未同步的分支整体覆盖进 `main`。
2. 生产只允许部署 `origin/main` 当前完整的 40 位提交 SHA，或指向 `main` 中该提交的不可变正式版本标签。禁止从功能分支、脏工作树、历史副本、可移动标签或人工挑选的 `dist` 目录部署。
3. `main` 只允许普通快进更新，禁止强推；正式版本标签一经用于生产不得移动、覆盖或复用。验证后如果 `origin/main` 前移，必须停止并用新提交重新测试、构建和记录。
4. 已合并的远程功能分支或热修复分支，只能在生产部署、线上验收和发布记录全部完成后删除。仍在维护的长期分支必须明确用途和负责人；生产回滚依据是已验证的不可变制品，不是保留旧功能分支。
5. 每次部署记录必须固定保存：来源分支、生产引用（`main` 或正式标签）、完整 commit SHA、正式版本标签（如使用）、CI 制品名称、制品 SHA-256、制品工作流运行编号、部署工作流运行编号、环境、UTC 部署时间、操作人、上一个生产 SHA 和验收结果。当前非容器发布以制品名称和 SHA-256 为准；以后使用容器时还必须记录不可变镜像 digest，只有镜像版本名或 tag 不合格。
6. 缺少分支祖先关系、不可变制品标识、发布记录或上线验收证据时必须停止发布，禁止以手工复制、服务器现场构建或跳过门禁的方式继续。
7. 回滚只允许切换到上一个已验证的不可变制品，并记录原因、`ROLLBACK_SHA` 和回滚验收结果；禁止强制回退 `main`、从旧分支重新构建或把旧 `dist` 覆盖到当前运行目录。

GitHub 仓库设置中的“Automatically delete head branches”必须保持关闭。发布收尾使用
`Cleanup Merged Production Branches` 手动工作流，填写精确 `production_sha`、成功的
`Deploy Production Runtime` 运行编号和同一 SHA 的手动 `Monitor Production Health` 验收运行编号。
必须先保持 `apply=false` 执行 dry-run 并审核候选清单，再以相同证据设置 `apply=true`。
工作流会通过 SSM 复核服务器当前 SHA，只删除名称以 `feat/`、`fix/`、`hotfix/` 或 `release/`
开头、没有开放 PR 且分支头已包含在该生产 SHA 中的远程分支；`backup/`、`archive/`、`artifact/`
以及任何未合并或尚未上线的分支一律保留。

建议使用以下字段保存每次发布记录；没有使用容器时 `image_digest` 记为 `n/a`：

```text
source_branch:
production_ref:
target_sha:
release_tag:
artifact_name:
artifact_sha256:
image_digest:
artifact_workflow_run:
deployment_workflow_run:
environment:
deployed_at_utc:
operator:
previous_production_sha:
verification_result:
```

## 当前生产拓扑

- 云平台：AWS EC2
- 区域：`ap-northeast-1`（东京）
- 实例：`i-041a146558e432cbf`（`yunqiao-vendure-prod`）
- 安全组：`sg-013cf38df187011ca`（`yunqiao-vendure-web`）
- SSH 用户：`ubuntu`
- 本机生产 SSH 私钥（仅记录路径）：`/Users/wangchao/Desktop/yamaxunmiyao2/yunqiao-vendure-prod-key.pem`
- 本机访问：正常发布直接使用上述仓库外私钥与 EC2 公网 IPv4，命令必须带 `-i <上述路径> -o IdentitiesOnly=yes`；无需每次登录 AWS 控制台。私钥权限必须保持 `0600`，发布时 `22/tcp` 只允许当前管理员公网地址的 `/32`。私钥不可读取、打印、复制、上传或提交；SSH 不可用时才回退到 AWS Systems Manager Session Manager
- 服务器源码与加密环境文件目录：`/var/www/kaiyuangouwu`
- 不可变运行产物/回滚目录：`/var/www/kaiyuangouwu-releases`
- 当前运行产物指针：`/var/www/kaiyuangouwu-current`（只能指向上述发布目录中已验证的候选目录）
- 发布保留策略：`current-sha` 成功更新后，由 `vendure-production-release-retention.path`
  自动保留当前运行产物和最近两个更早的回滚产物；其余严格匹配发布命名规则的旧目录与 `.tar.gz`
  归档才允许删除，校验文件、部署记录、数据库备份和应用日志不参与清理。
- Dashboard 发布换版后不混合新旧两个不可变产物的静态资源。长时间打开的标签页如果请求到已失效的 Vite 懒加载分包，由 Dashboard 捕获 `vite:preloadError` 并在会话级冷却窗口内只自动刷新一次；顶层错误边界作为失败兜底，禁止用复制旧 `assets` 的方式恢复。
- Vendure 上游：`127.0.0.1:3002`
- PM2 进程：`vendure-api`、`vendure-worker`
- PM2 生产环境固定设置 `VENDURE_DISABLE_TELEMETRY=true`，防止 Vendure 的文件系统兜底在不可变运行目录内写入 `.vendure/.installation-id`
- Storefront 静态目录：`/var/www/kaiyuangouwu-current/packages/storefront/dist`
- Dashboard 静态目录：`/var/www/kaiyuangouwu-current/packages/next-admin/dist`（由 Vendure API 的 `DashboardPlugin` 提供）
- Nginx 配置基线：`deploy/nginx/damatong.conf`（保留兼容文件名，已覆盖双店域名）
- TLS 协议只在 `deploy/nginx/damatong.conf` 的 `http` 作用域声明一次，固定为 `ssl_protocols TLSv1.2 TLSv1.3;`；生产机 `/etc/nginx/nginx.conf` 不得保留发行版默认的重复 `ssl_protocols` 声明。
- 数据库：同一 EC2 上的 MySQL 8.0，使用 `single-host` 生产模式；每日逻辑备份与恢复演练脚本位于 `deploy/systemd/`。
- 异地备份：`yunqiao-vendure-prod-backup-079740175286-apne1/mysql`，实例角色只能访问该前缀；存储桶已启用版本控制、SSE-S3 默认加密、阻止全部公网访问与 Bucket owner enforced。本地备份保留 14 天；S3 当前不自动删除，设置生命周期前必须单独确认保留期限。

单机生产环境必须在 `.env` 中设置 `VENDURE_REQUIRE_OFFSITE_BACKUP=true` 和可写的 `VENDURE_BACKUP_S3_URI=s3://<bucket>/<prefix>`。备份脚本会上传压缩备份与 SHA-256 文件；未配置或上传失败时 systemd 任务失败。恢复演练完成后会自动删除临时数据库。

Cloudflare DNS 和 EC2 实例详情才是当前源站地址的准确信息来源。2026-08-21 核对的 EC2 公网 IPv4 是 `52.196.65.143`；不要把该 IP 当成永久地址。发布前必须重新核对。

Nginx 会按 Cloudflare 官方 IPv4/IPv6 网段恢复 `CF-Connecting-IP`，按真实访客 IP 限流，并拒绝非 Cloudflare 来源直接访问 HTTPS 源站（仅放行本机回环健康检查）。每次发布 Nginx 配置前，必须对照 `https://www.cloudflare.com/ips-v4` 与 `https://www.cloudflare.com/ips-v6` 更新 `deploy/nginx/damatong.conf`，执行 `nginx -t` 后再 reload。AWS 安全组仍应把 `443/tcp` 限制到相同 Cloudflare 网段，形成网络层和 Nginx 双重限制。

### Cloudflare 店铺域名自动化

后台一键绑定使用 Cloudflare for SaaS。上线前需要在 Cloudflare 完成一次性平台配置：

1. 在平台 Zone 启用 Cloudflare for SaaS，将已代理的生产主机设为 fallback origin。
2. Cloudflare 默认使用客户自定义域名作为回源 `Host` 和 SNI；为当前套餐配置可用的回源 SNI 方案（例如 Origin Rule 的 SNI 覆盖），或确保源站证书覆盖客户域名。
3. 使用只允许读写该 Zone 自定义主机名的 Token；只在公司同一账户的客户 Zone 上额外授予 Zone 读取和 DNS 编辑。
4. 把 Token 存入生产 Secret，配置 `STORE_DOMAIN_AUTOMATION_MODE=cloudflare-saas`、`CLOUDFLARE_SAAS_ZONE_ID`、`CLOUDFLARE_SAAS_FALLBACK_ORIGIN` 和明确的 `CLOUDFLARE_SAAS_AUTO_MANAGE_DNS`。
5. 用一个真实测试域名验证边缘证书、Cloudflare 回源 TLS/SNI、前台和 Shop API；证据通过后才在 `READINESS_OPERATIONS_JSON` 中设置 `"cloudflareOriginTls":true`。
6. 先运行 server、worker 和 migration 三种角色的 `audit:production-env`；任何占位 Token、错误 Zone ID、非公网 fallback origin 或缺少回源 TLS/SNI 证据都是发布阻断。

后台新增域名后，API 会幂等创建 Cloudflare 自定义主机名。如 Token 可访问该域名的权威 Zone，同时创建代理 CNAME 和 Vendure TXT；遇到现有 A、AAAA 或不同 CNAME 时必须停止，禁止覆盖。外部账户域名仍在后台显示需要商家添加的两条 DNS 记录。Worker 每分钟只复核待生效项，仅在 Vendure TXT、Cloudflare hostname 和 SSL 三项均通过后将域名标记为 `ACTIVE`。

删除域名时会先删除对应 Cloudflare custom hostname，但不自动删除 DNS 记录，便于恢复与审计。Token 不得出现在仓库、命令参数、GraphQL 响应、日志或发布记录中。

当前 EC2 已由 SSM 托管，并绑定只访问所需 AWS 资源的实例角色。正常发布使用上文固定的仓库外私钥；若 SSH 端口或密钥不可用，再回退到 Session Manager。任何临时新增的 `22/tcp` 规则都必须只允许当前管理员公网地址的 `/32`，并在发布完成后立即撤销。不要读取、上传或提交私钥。

## 发布门禁

当前单机生产拓扑必须设置 `PRODUCTION_DEPLOYMENT_PROFILE=single-host` 和 `PRODUCTION_OBSERVABILITY_MODE=system`。只有数据库自动备份、恢复演练、外部健康检查、关键告警、持久资源与加密密钥存储均有真实证据时，才可将对应 `READINESS_OPERATIONS_JSON` 字段设为 `true`。

在发布提交的干净隔离工作树中，通过进程环境安全注入生产等价的构建配置（密钥不得写入仓库或发布记录），并依次通过。必须先完成 monorepo 依赖拓扑构建再运行全量测试，禁止依赖开发工作区残留的 `lib`、`dist` 或 `package` 目录：

```bash
bun install --frozen-lockfile --linker=hoisted
bun run lint:check
bun run build
bun run test
bun run --cwd packages/operations-dashboard-plugin test
READINESS_PROCESS_ROLE=server bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=worker bun run --cwd packages/dev-server audit:production-env
RUN_MIGRATIONS=true RUN_JOB_QUEUE=0 READINESS_PROCESS_ROLE=migration \
    bun run --cwd packages/dev-server audit:production-env
bun run --cwd packages/storefront test
bun run --cwd packages/storefront build
bun run --cwd packages/dev-server build
bun run --cwd packages/dev-server build:production-runtime -- --require-platform linux/x64 --audit-level high
```

最后一条命令只能在与 EC2 匹配的 `linux/x64` 干净构建机上执行。产物目录会包含平台、完整 Git SHA、`bun.lock` SHA-256、运行包清单、`RUNTIME-AUDIT.json` 和文件校验清单，并拒绝 `esbuild`、`less`、`tar`、`typescript`、`vite`、`webpack` 或达到指定审计阈值的包进入运行目录。使用 `--allow-dirty` 生成的产物只允许本地演练，不得部署。

正式制品优先使用 GitHub Actions 的 `Production Runtime Artifact` 工作流生成。常规发布手动输入 `origin/main` 当前完整的 40 位小写 SHA；若包含已审核的店铺媒体，同时在唯一的可选 `media_keys` 和 `channel_codes` 输入中填写逗号分隔的 manifest key 与明确 Channel 范围，两者必须同时出现。媒体 key 与 Channel 范围会连同目标 SHA、制品名与制品 SHA-256 写入单独校验的 `release-plan.json`，下游只能使用同一制品运行生成的发布计划。当 `main` 只变更 `packages/image-generation-plugin/skill/image-prompt-pro/**` 或对应的已编译 bundle 时，工作流也会使用该 push 的完整 SHA 自动运行。若同一批 push 混入任何其他路径，自动任务会停止，必须按常规发布流程人工审核。正式制品只接受经过审核的双父 `main` 合并提交：第一父必须已被 PR 头提交包含，最终 `main` 源码树必须与 PR 头源码树完全相同，且该 PR 头必须存在成功的 `Build & Test` 运行。在这些证据都精确匹配后，制品阶段不再重复全仓单测、开发工作流测试和变更 lint，只使用 Node `24.19.0`、Bun `1.3.14` 和 `ubuntu-24.04` x64 执行冻结安装、全仓审计、Skill 回归、生产构建、发布专属结构检查、运行产物 High+ 门禁和自验证。任一 CI 证据、分支包含关系、源码树、SHA、源码清洁性、平台或发布门禁不匹配时都不会上传制品。依赖审计将同一份绑定 `bun.lock` 的 JSON 证据用于全仓与运行时门禁，按实际 severity 阻断 High+；仅对 Bun 明确返回的网络超时、连接关闭或底层传输错误最多尝试三次，退避为 15 秒和 60 秒；漏洞、其他命令错误、无效输出或重试耗尽仍立即失败关闭。

登录视觉或 MOYAO AI 品牌变更必须在同一制品调度分别勾选 `auth_visuals` 或 `moyao_brand`，并填写已审核 `channel_codes`。品牌发布只接受 `channel_codes=__default_channel__`。这些字段也写入并校验 `release-plan.json`；缺少审核、Channel 不正确，或在没有对应变更时携带发布范围，都必须在备份和运行时切换前失败关闭。

大马通整店受管内容使用独立的 `damatong_storefront` 与 `damatong_channel_token` 发布范围，不复用容易混淆 Channel code 与 token 的通用字段。生产只接受 `damatong_channel_token=my-malaysia`；发布脚本再通过 Admin API 将该公开 token 解析为真实 Channel，并以 `damatong.net` 的 Shop API 反查同一 Channel。首次启用必须先单独发布本工作流和服务器保护逻辑，且该门禁引导版本不得携带大马通内容或勾选发布范围；确认生产已安装新保护逻辑后，第二个正式版本才可携带发布器、图片与内容并勾选该范围。

制品工作流成功后，`Deploy Production Runtime` 会自动接管手动制品任务和仅由上述 Skill 路径触发的 `main` push 发布。它使用 GitHub OIDC 临时凭证承担
`arn:aws:iam::079740175286:role/yunqiao-vendure-github-deploy`，只把当前 SHA 的不可变归档写入
`s3://yunqiao-vendure-prod-backup-079740175286-apne1/deployments/<sha>/`，再只向
`i-041a146558e432cbf` 发送 `AWS-RunShellScript`。仓库和 GitHub 均不保存长期 AWS Access Key；常规发布在
GitHub 的 `main` 分支手动运行一次 `Production Runtime Artifact`，Skill 规则路径变更则自动触发，两者都无需登录 AWS 控制台。

自动发布入口为 `/usr/local/sbin/vendure-production-deploy-from-s3`，来源必须是已提交的
`deploy/deploy-production-from-s3.sh`。脚本在同一个生产锁内完成源码快进、S3 外层校验、运行产物自验证、
受管 publisher 权限与目标的只读预检、数据库备份和迁移、PM2 切换、已审核媒体/登录视觉/品牌写入、Nginx 检查、公网健康检查、版本标记与失败回滚。若目标提交改动了受管数据但发布计划没有对应的精确审核范围，或者改动了库存修复发布器等不受支持的数据路径，脚本会在备份、迁移和运行时切换前停止。已处于目标 SHA 的重复调度会返回 `PRODUCTION_DEPLOY_ALREADY_CURRENT`，不重复备份、迁移或重启。

新增或修改某类受管 publisher 的生产门禁时必须拆成两次发布：第一版只上线工作流、制品清单和服务器引导门禁，确认生产入口已运行新门禁；第二版才上线 publisher/受管数据改动，并携带新门禁要求的审核范围。当前服务器会在快进并重新执行目标脚本之前先按旧门禁检查差异，因此禁止用手工复制、跳过检查或伪造媒体 key 把两阶段合成一次发布。

首页三张轮播使用独立的 `homepage_carousel` 审核开关。第一阶段只发布该门禁，不勾选开关、不携带媒体或 Channel；必须在部署日志确认 `PRODUCTION_BOOTSTRAP_VERIFIED ... homepage_carousel_guard=enabled` 后才进入第二阶段。第二阶段新增 `sync-homepage-carousel.mjs` 与图片时，该脚本自动成为制品必需输入，勾选 `homepage_carousel=true`，并精确填写 `channel_codes=__default_channel__` 和 `media_keys=home-hero-token-topup-v1,home-hero-codex-tiers-v1,home-hero-account-services-v1`。缺少开关、Channel 或三张图片范围不一致均失败关闭。脚本先在备份前预演，候选 API 健康后执行 `--apply --allow-remote` 与独立 `--verify`；只有 `HOMEPAGE_CAROUSEL_VERIFY_OK` 后才切换客户端。图片、双语文案、链接和排序都绑定在 Vendure 首页内容区块，不能仅上传图片就宣布同步成功。

单机发布会确保 `/var/lib/vendure-memory/production.swap` 提供 2 GiB 持久 Swap，并把 `vm.swappiness` 固定为
10；创建前必须至少保留额外 1 GiB 磁盘空间，已有合规 Swap 时保持幂等。随后在下载前、迁移前和运行时切换
前读取 Linux `MemAvailable` 与可用 Swap；物理可用内存不得低于 192 MiB，总有效余量不得低于 384 MiB 或
物理内存的 12.5%（取较高值），否则会在破坏性切换前停止。PM2 显示的宿主机 RAM 使用率包含可回收页缓存，
发布判断以 `PRODUCTION_MEMORY` 记录为准。归档在同一发布文件系统内使用原子移动保留，API 通过健康检查后
才启动 Worker，两个 Node 进程均设 768 MiB 自动重启上限，避免重复复制归档、并发冷启动和失控增长造成峰值。

`Monitor Production Health` 工作流在每小时的第 17 和 47 分自动巡检，也可手动触发。它使用同一个
GitHub OIDC 临时角色通过 AWS SSM 执行只读检查：物理可用内存与 Swap 余量、API/Worker 的 PM2
状态与运行目录、本机及公网 `/health`，以及绕过 CDN 缓存后的 Dashboard 动态资源图。任一项不符合门禁时工作流失败并保留当次
`PRODUCTION_MEMORY` 趋势数据；不依赖 SSH 或长期 AWS Access Key。

手动设置 `audit_payment_config=true` 时，工作流只通过 SSM 执行仓库内的脱敏运行时审计，并以该审计
是否成功作为强制门禁。部署 OIDC 角色按最小权限设计，不授予账户级 `ssm:DescribeParameters` 或
`secretsmanager:ListSecrets` 清单权限，工作流也不尝试枚举参数或密钥名称；日志固定记录
`access=not_granted_by_design`，不得把有意未授权误报为 AWS 服务不可用。如需账户级清单治理，必须使用
独立只读审计角色和单独批准的工作流，且不得输出参数值或密钥值。

若候选 API 未通过健康检查且自动回滚本身失败，可手动运行 `Recover Current Production Runtime` 工作流。
它只会读取 `kaiyuangouwu-current` 与 `current-sha` 指向的最后一个已验证运行包，要求两者 SHA 一致，
并通过 `deploy/recover-current-production-runtime.sh` 在同一生产锁内重建 PM2 进程；不会回退 Git、数据库或版本标记。

若仓库根命令与当次改动范围不匹配，以 `package.json` 的现有脚本和本次实际测试清单为准，并在发布记录中写明。构建 Dashboard 前必须使用干净的 `packages/next-admin/dist` 与 `packages/dev-server/dist`，避免旧 Vite 哈希文件混入。生产 Dashboard 只能来自 `packages/next-admin/dist`，不得回退到 Vendure 默认 Dashboard 构建。

### 提示词 Skill 自动升级

- 受管生产发布会在 PM2 的 API 和 Worker 进程中把 `IMAGE_PROMPT_SKILL_AUTO_ACTIVATE` 默认设为 `true`；加密 `.env` 可显式设置为 `false` 暂停自动激活。两个进程必须保持一致。
- 只有首次在数据库中发现的新 SHA-256 bundle 可自动激活；历史进程重启不得重新提升旧 bundle。
- 自动激活只在完整构建、Skill bundle 校验、固定场景回归测试和生产运行产物验证全部通过后才会进入生产。
- 每次任务保留原 bundle hash，新版本不改写已经开始的任务。如需回滚，在后台选择历史版本；不删除 bundle 或历史任务。

## 防止旧代码覆盖新代码的强制协议

正常发布必须满足以下不变量；任一不满足都立即停止，不允许通过手工复制文件继续：

1. **单一版本标识**：发布开始时锁定一个完整的 40 位 `TARGET_SHA`。远端分支、隔离工作树、构建产物、服务器代码和发布记录必须全部等于该 SHA。
2. **远端只能快进**：推送前记录 `origin/main` 的 `BASE_MAIN_SHA`，确认它是 `TARGET_SHA` 的祖先；使用普通 `git push`，禁止 `--force`。如果推送因远端已更新而失败，重新拉取、验证和构建，不能用旧本地分支覆盖远端。
3. **只从干净提交构建**：从 `TARGET_SHA` 创建 detached 隔离工作树；要求 `git status --porcelain` 为空。构建前明确清空该隔离工作树内的 `packages/next-admin/dist`、`packages/dev-server/dist` 和 `packages/storefront/dist`，不复用开发目录或上次发布目录。
4. **产物不可变且可验证**：候选目录名必须包含 `TARGET_SHA`、UTC 时间、`linux-x64` 且不得复用。产物必须由 `build:production-runtime` 生成，包含 Git SHA、构建时间、Bun/Node 版本、运行依赖清单和所有普通文件的 SHA-256 清单；上传后必须先运行自带验证器。
5. **服务器串行发布**：服务器使用 `flock` 获取唯一发布锁。锁内再次确认 `origin/main == TARGET_SHA`、当前运行提交是 `TARGET_SHA` 的祖先、受版本控制文件无本地修改；不满足时拒绝部署。
6. **代码只做快进更新**：服务器仓库只允许 `git merge --ff-only origin/main`，正常发布禁止 `reset --hard`、强制切分支或覆盖式同步。数据库、`.env`、上传资产和数字交付文件不参与代码同步。
7. **先记录、后原子切换**：先记录 `kaiyuangouwu-current` 指向的上一个已验证产物，再在同一文件系统中原子替换该符号链接。禁止直接向正在服务的 `dist` 或 `node_modules` 增量复制。
8. **验证成功才登记版本**：PM2 重启及前台、后台、API、静态资源检查全部通过后，才原子更新 `/var/www/kaiyuangouwu-releases/current-sha`。最终必须同时满足服务器 `git rev-parse HEAD == TARGET_SHA`、版本标记等于 `TARGET_SHA`、线上健康检查成功。
9. **禁止生产数据填充命令**：生产机不得执行 `packages/dev-server` 的 `populate`、`seed:storefront-demo` 或任何调用 `clearAllTables()` 的开发命令。`populate` 会先清空全部业务表；代码门禁只允许它在 `NODE_ENV=development|test` 且数据库名不含生产标识时运行。

显式回滚不走正常发布通道。只有在记录回滚原因、指定完整 `ROLLBACK_SHA` 并人工确认后才允许回到旧版本；不得把 `origin/main` 强制回退。回滚完成后同样要验证 Git SHA、构建产物清单和线上健康状态。

### 发布前的版本关系检查

以下检查在本地隔离构建前执行，其中两个 SHA 都必须先解析为完整提交：

```bash
git fetch origin main
BASE_MAIN_SHA="$(git rev-parse origin/main^{commit})"
TARGET_SHA="$(git rev-parse HEAD^{commit})"
test "$(printf '%s' "${TARGET_SHA}" | wc -c | tr -d ' ')" -eq 40
git merge-base --is-ancestor "${BASE_MAIN_SHA}" "${TARGET_SHA}"
```

推送 `main` 时不使用强制参数：

```bash
git push origin "${TARGET_SHA}:refs/heads/main"
test "$(git ls-remote origin refs/heads/main | awk '{print $1}')" = "${TARGET_SHA}"
```

服务器发布锁内必须执行同等关系检查：

```bash
exec 9>/run/lock/vendure-production-deploy.lock
flock --exclusive 9
git -C /var/www/kaiyuangouwu fetch origin main
CURRENT_SHA="$(git -C /var/www/kaiyuangouwu rev-parse HEAD^{commit})"
REMOTE_SHA="$(git -C /var/www/kaiyuangouwu rev-parse origin/main^{commit})"
test "${REMOTE_SHA}" = "${TARGET_SHA}"
git -C /var/www/kaiyuangouwu merge-base --is-ancestor "${CURRENT_SHA}" "${TARGET_SHA}"
test -z "$(git -C /var/www/kaiyuangouwu status --porcelain --untracked-files=no)"
git -C /var/www/kaiyuangouwu merge --ff-only origin/main
test "$(git -C /var/www/kaiyuangouwu rev-parse HEAD^{commit})" = "${TARGET_SHA}"
```

上述命令只是门禁骨架；发布锁必须保持到产物替换、PM2 重启、健康检查和版本标记更新全部结束。

## 生产运行产物

生产不再从完整 monorepo 的 `node_modules` 启动，也不在 EC2 上执行 `bun install`、Vendure CLI 或前端构建。构建机只安装 `dev-server` 的生产依赖，再收集 Server、Worker、Dashboard、Storefront、邮件模板和本地插件的已编译输出。

在干净的 `linux/x64` 隔离工作树完成前述门禁后执行：

```bash
bun run --cwd packages/dev-server build:production-runtime -- --require-platform linux/x64 --audit-level high
```

命令成功后，将输出的绝对路径明确赋给 `ARTIFACT_DIR`，不要用“最新目录”之类模糊规则选择产物：

```bash
ARTIFACT_DIR=/absolute/path/from-the-build-output
TARGET_SHA="$(git rev-parse HEAD^{commit})"
node "${ARTIFACT_DIR}/verify-runtime.mjs" --expected-sha "${TARGET_SHA}"
ARTIFACT_PARENT="$(dirname "${ARTIFACT_DIR}")"
ARTIFACT_NAME="$(basename "${ARTIFACT_DIR}")"
(
    cd "${ARTIFACT_PARENT}"
    sha256sum "${ARTIFACT_NAME}/SHA256SUMS" > "${ARTIFACT_NAME}.manifest.sha256"
)
```

`RUNTIME-METADATA.json` 中的 `sourceDirty` 必须为 `false`、`platform` 必须为 `linux/x64`、`gitSha` 必须等于 `TARGET_SHA`。`RUNTIME-PACKAGES.json` 是实际安装包清单，`RUNTIME-AUDIT.json` 记录与该清单精确匹配的公告、路径、版本和门禁阈值；验证器会重新扫描目录，拒绝六类被禁构建工具、超过阈值的公告、平台不匹配、多余/缺失文件、校验和或符号链接变化。本地 macOS 构建的原生依赖不能在 EC2 上运行。

手工构建机传输应保留目录和符号链接，可对“全新、唯一的候选目录”使用 `rsync -a`。同时传输产物目录和目录外的 `<artifact>.manifest.sha256`，服务器先校验外层清单哈希，再运行产物自验证。

GitHub Actions 制品是 `<artifact>.tar.gz` 与同名 `.sha256`。该归档仅由固定的 Ubuntu 系统 GNU tar 在验证完成后生成，用于保留权限与符号链接；不调用仓库依赖中的 `tar` 包。下载后先在传输端和服务器分别校验归档 SHA-256，再只解压到一个不存在的唯一候选目录，最后运行产物自验证：

```bash
cd /var/www/kaiyuangouwu-releases
sha256sum --check "${ARCHIVE_NAME}.sha256"
ARTIFACT_NAME="${ARCHIVE_NAME%.tar.gz}"
test "${ARTIFACT_NAME}" != "${ARCHIVE_NAME}"
test ! -e "${ARTIFACT_NAME}"
# 发布 shell 可能使用 umask 077；必须恢复归档中已验证的 755/644 权限，
# 否则 Nginx 的 www-data 用户无法遍历 Storefront 目录。
tar --extract --gzip --same-permissions --file "${ARCHIVE_NAME}"
CANDIDATE="/var/www/kaiyuangouwu-releases/${ARTIFACT_NAME}"
test "$(stat --format='%a' "${CANDIDATE}")" = "755"
node "${CANDIDATE}/verify-runtime.mjs" --expected-sha "${TARGET_SHA}"
```

`ARCHIVE_NAME` 必须是下载得到的文件名，并以 `${TARGET_SHA}-` 开头、以 `-linux-x64.tar.gz` 结尾。服务器不得通过通配符或“最新文件”自动选择归档。

手工 `rsync -a` 的候选目录上传后，在发布锁内执行下列外层清单检查；GitHub Actions 归档则使用上一段的归档 SHA-256 检查，不要求 `.manifest.sha256`：

```bash
CANDIDATE="/var/www/kaiyuangouwu-releases/${ARTIFACT_NAME}"
test -d "${CANDIDATE}"
test -f "/var/www/kaiyuangouwu-releases/${ARTIFACT_NAME}.manifest.sha256"
(
    cd /var/www/kaiyuangouwu-releases
    sha256sum --check "${ARTIFACT_NAME}.manifest.sha256"
)
node "${CANDIDATE}/verify-runtime.mjs" --expected-sha "${TARGET_SHA}"
```

数据库迁移只在备份和 `READINESS_PROCESS_ROLE=migration` 预检通过后，使用产物内专用的一次性入口：

管理后台 2FA 数据库功能上线前，生产加密环境文件必须先配置独立且固定的
`TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY`（至少 32 个随机字符），API、Worker 和迁移进程必须读取同一值。
该值不得写入仓库、命令参数、聊天记录或发布记录；丢失或错误轮换会导致已保存的 2FA 密钥无法解密。
受管发布会在备份成功后、迁移预检前，通过原子环境文件更新自动初始化缺失或占位的密钥；已配置的有效密钥
会原样保留，初始化日志只记录状态，不输出密钥值。

```bash
set -a
source /var/www/kaiyuangouwu/packages/dev-server/.env
set +a
cd "${CANDIDATE}"
NODE_ENV=production RUN_MIGRATIONS=true RUN_JOB_QUEUE=0 node packages/dev-server/dist/run-migrations.js
```

迁移成功后，API Server 和 Worker 必须都保持 `RUN_MIGRATIONS=false`。PM2 的 reload 会保留旧进程定义中的 `pm_cwd` 和 `pm_exec_path`，不能用于切换不可变运行目录；使用已加载生产环境变量的同一个 shell 会话重建进程定义：

```bash
DEPLOYMENT_ID="${TARGET_SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
VENDURE_DEPLOYMENT_ID="${DEPLOYMENT_ID}" \
    /var/www/kaiyuangouwu/deploy/switch-production-runtime.sh "${CANDIDATE}"
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3002/image-generation/health
pm2 save
```

API 健康后、切换 Storefront 稳定指针前，从同一个候选产物执行经过审核的数据修复与发布命令；每项都必须先只读预演、核对目标，再允许写入。

本次库存继承修复发布还必须在图片发布前处理经过审核的旧 SKU。只把确认是历史后台错误写成
`trackInventory=FALSE` 的稳定 SKU 放入环境变量；不要用“全部数字商品”之类的动态筛选。先预演并逐项核对
SKU、variant ID、Channel 和当前值，再显式写入。脚本会拒绝缺失/重复 SKU 和当前为 `TRUE` 的变体，且不会
修改未列入清单的商品：

```bash
cd "${CANDIDATE}"
export INVENTORY_REPAIR_CHANNEL_CODES=cn-mainland,my-malaysia
export INVENTORY_INHERIT_SKUS=reviewed-sku-a,reviewed-sku-b
VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
    node packages/dev-server/scripts/repair-inventory-inheritance.mjs --dry-run
VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
    node packages/dev-server/scripts/repair-inventory-inheritance.mjs --apply --allow-remote
unset INVENTORY_REPAIR_CHANNEL_CODES INVENTORY_INHERIT_SKUS
```

凭据继续从已安全加载的 `SUPERADMIN_USERNAME`、`SUPERADMIN_PASSWORD` 读取，不得写入命令或发布记录。
预演目标不正确或写入后没有返回 `INHERIT` 时立即停止发布。

然后执行店铺图片发布：

```bash
cd "${CANDIDATE}"
VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
    node packages/dev-server/scripts/sync-storefront-media.mjs --dry-run
VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
    node packages/dev-server/scripts/sync-storefront-media.mjs --apply --allow-remote
VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
    node packages/dev-server/scripts/sync-storefront-media.mjs --verify
```

命令使用已由发布 shell 安全加载的 `SUPERADMIN_USERNAME`、`SUPERADMIN_PASSWORD` 和 `STOREFRONT_MEDIA_CHANNEL_CODES`；Admin API 使用候选机的 `VENDURE_API_ORIGIN`，Shop API 必须单独使用已审核公网店铺 `VENDURE_STOREFRONT_URL`，以真实触发域名到 Channel 的路由。不得把密码写入参数或发布记录。同步失败立即停止发布，不切换 Storefront 指针。同一文件按 SHA-256 标签复用；新版文件只切换商品和内容块绑定，不删除旧素材，便于数据层单独回退。清单中标记为 `asset-library` 的设计参考图只上传并分配到目标 Channel 素材库，不会自动改动商品、内容块或前台默认海报。如只需发布某一项素材，使用 `--keys <manifest-key>` 限定范围，避免重新绑定其他素材。
发布器保留原商品/variant gallery，写入后用 Admin API 和 Shop API 反查同一 Asset ID；任一反查失败会尝试恢复原绑定。独立 `--verify` 证据缺失时不得宣布媒体发布成功。

首页三张业务轮播由 `sync-homepage-carousel.mjs` 统一管理。该发布器复用媒体清单上传并分配三张图片，再以一个带全量 `expectedUpdatedAt` 的内容批次，将轮播固定为 Token 充值、Codex 档位和当前在售账号服务；分类目标通过稳定 slug 解析成各 Channel 的真实 Collection ID。默认只读，写入和独立验证命令如下：

三张图片必须绑定到 Vendure 的 `HERO.imageAssetId`，图片、双语文案、主题、跳转和排序统一存储在同一组内容区块。发布后在对应 Channel 的“商城首页装修”编辑这些区块；客户端通过 Shop API 读取并通过既有内容更新事件重新加载。仅上传到素材库或仅构建客户端均不算轮播发布完成。发布器是显式审核后的初始化/更新入口，不加入服务启动或定时重置；以后在后台修改内容时不需重建客户端，重新执行本清单的 `--apply` 会覆盖这三张轮播的受管字段，必须先审核 dry-run。

```bash
cd "${CANDIDATE}"
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-homepage-carousel.mjs --dry-run
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-homepage-carousel.mjs --apply --allow-remote
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-homepage-carousel.mjs --verify
```

Channel 默认复用 `STOREFRONT_MEDIA_CHANNEL_CODES`，需要独立范围时才设置 `HOMEPAGE_CAROUSEL_CHANNEL_CODES`。脚本会保留轮播以外的装修区块及排序；上传图片前先校验全部目标 Channel、轮播和分类，存在多个未登记旧 Hero 或分类缺失时直接失败。写后必须同时通过 Admin API 与中英文 Shop API 的图片 ID/地址、文案、统计标签、主题颜色、启用状态、跳转目标、轮播数量和顺序反查；Shop API 反查同时传递 `languageCode=<locale>` 查询参数和 `language-code: <locale>` 请求头。验证失败时删除本批新建 Hero 并恢复原 Hero 与顺序。正式发布必须先完成独立门禁引导版本，再使用 `homepage_carousel=true`、主 Channel 和精确三张 media keys 调度；不得通过手工 SSH 绕过。分类 slug 以 `languageCode=zh_Hans` 和同名语言头查询，避免英文翻译 slug 导致目标缺失。恢复批次返回后还必须回读 Admin API，确认原区块、字段和排序确实恢复，才可报告回滚成功。

登录/注册页文案、色板和标签属于 Vendure 内容，不得只改客户端。在 `Production Runtime Artifact` 中勾选 `auth_visuals`，并填写已审核 Channel；发布链会先 dry-run，再以带 `expectedUpdatedAt` 的单个 Admin API 批次原子写入，随后运行独立只读 `--verify` 反查 Admin 与中英文 Shop API，并记录 `AUTH_VISUAL_VERIFY_OK`。验证失败时恢复原内容并停止切换。
发布器的回归样本必须包含当前生产中文/英文配对。若修改中文源文时再次提交与线上完全相同的英文，内容翻译服务可能把该英文判定为过期自动翻译并重新生成。这种发布必须改为新的已审核英文，或使用接口明确支持的人工锁定；不得假设 GraphQL 输入会原样持久化，必须以写入后 Admin/Shop 反查值为准。
中英文 Shop API 反查必须复制真实客户端的语言路由：同时传递 `languageCode=<locale>` 查询参数与 `language-code: <locale>` 请求头，并分别校验 `zh_Hans` 和 `en`。仅使用请求头的探针不得作为客户端语言一致性证据。

当版本包含已审核的店铺媒体、登录/注册内容或 MOYAO AI 品牌变更时，直接在目标 `main` 完整 SHA 的
`Production Runtime Artifact` 唯一入口填写完整 manifest key/勾选 `auth_visuals`/勾选 `moyao_brand`，并填写已审核 Channel code；大马通整店内容则勾选 `damatong_storefront` 并填写 `damatong_channel_token=my-malaysia`。不再另行触发第二个内容发布工作流，也不回退到服务器默认 Channel。
下游部署会校验发布计划、制品 SHA-256 与源工作流 run ID，然后只将已审核的 publisher 范围、key 和 Channel 交给持有生产锁的脚本。脚本在备份、迁移和 PM2 切换前，先通过当前健康 API 执行只读 dry-run，校验登录、Channel 权限、SKU/内容目标和现有素材；仅预检通过后才备份、迁移和启动候选 API，再执行受保护 apply。预检失败不会停止或重启 PM2。

若目标提交包含 MOYAO AI 品牌更新，必须在该 SHA 的 `Production Runtime Artifact` 中设置 `moyao_brand=true` 与 `channel_codes=__default_channel__`。下游将它与制品 SHA-256 作为同一份发布计划校验，并在唯一生产锁内先预演，再把三套官方品牌素材、双语品牌名/口号和色板一次性绑定到主 Channel：

```bash
cd "${CANDIDATE}"
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-moyao-brand.mjs --dry-run --channel-code __default_channel__
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-moyao-brand.mjs --apply --allow-remote \
    --channel-code __default_channel__
VENDURE_API_ORIGIN=http://127.0.0.1:3002 VENDURE_STOREFRONT_URL=https://moyaoai.com \
    node packages/dev-server/scripts/sync-moyao-brand.mjs --verify \
    --channel-code __default_channel__
```

该工具按 SHA-256 标签复用品牌资源，通过 Admin API 写入当前 StoreProfile；素材查询和上传结果只读取稳定的 Asset ID，避免历史素材翻译元数据为空时阻断幂等发布。写入后先核对 Admin 返回的完整品牌字段，再以与真实客户端一致的 `languageCode` 查询参数和语言请求头，分别从 Shop API 反查中文、英文名称、口号、色板和三个 Asset ID。若写入后的任一反查失败，发布器必须使用写入后 `updatedAt` 恢复原 StoreProfile（包括原三组 Asset ID），并再次验证恢复结果；恢复失败按生产事故处理。独立 `--verify` 未通过时不得切换 Storefront 指针或宣布品牌发布成功；密码只从已加载的生产 Secret 环境读取。

切换脚本会在 systemd journal 中以 `vendure-production-switch` 标记依次记录 `requested`、`succeeded` 或 `failed`。每条事件包含部署 ID、目标 SHA、候选目录、调用用户、SSH 来源 IP、进程和父进程信息，不记录命令参数、环境变量或密钥。`requested` 写入失败会中止切换，避免无审计地改动 PM2。发布后用同一部署 ID 核对完整事件链：

```bash
sudo -n journalctl -t vendure-production-switch --since '30 minutes ago' --no-pager -o cat | \
    grep -F "deployment_id=${DEPLOYMENT_ID}"
```

健康检查成功后再原子切换 Storefront 稳定指针：

```bash
PREVIOUS_RUNTIME="$(readlink -f /var/www/kaiyuangouwu-current 2>/dev/null || true)"
sudo -n ln -s "${CANDIDATE}" /var/www/.kaiyuangouwu-current.new
sudo -n mv -Tf /var/www/.kaiyuangouwu-current.new /var/www/kaiyuangouwu-current
sudo -n nginx -t
sudo -n systemctl reload nginx
```

`PREVIOUS_RUNTIME` 只能是上一个已通过验收的发布目录，并必须写入当次发布记录。切换失败时，设置唯一的 `VENDURE_DEPLOYMENT_ID="${DEPLOYMENT_ID}-rollback"`，调用 `switch-production-runtime.sh "${PREVIOUS_RUNTIME}"` 重建上一版本的进程定义，执行 `pm2 save`，再原子恢复稳定指针；不重新安装依赖，不删除数据库、上传资产或 `.env`。

## 标准发布流程

1. 将来源分支更新到最新 `origin/main`，检查完整 diff 和变更文件清单，只保留本次经过审核的修改；设计验收截图、测试报告、历史快照和其他未跟踪资料不进入发布提交。
2. 将审核后的修改合并进 `main`，使用普通快进推送，确认远端 `main` 的完整 SHA；禁止强推。若同一需求同时改变 publisher 生产门禁与被该门禁保护的 publisher/数据，必须先拆出并完成门禁引导发布，再合并第二阶段。若使用正式版本标签，标签必须指向这个已在 `main` 中的 SHA，且发布后不得移动或复用。
3. 从该 SHA 创建隔离的干净工作树，运行测试和生产构建；必须显式执行 `@vendure/operations-dashboard-plugin` 菜单回归测试，禁止仅依赖根命令的工作区自动发现。
4. 创建发布记录并先填写来源分支、生产引用、`TARGET_SHA`、正式标签（如使用）、上一个生产 SHA、环境和操作人；信息不完整时停止。
5. 对该 SHA 手动运行一次 `Production Runtime Artifact` 工作流；如果本版本包含已审核店铺媒体、登录视觉或 MOYAO AI 品牌，在同一次调度填写 `media_keys`/勾选 `auth_visuals`/勾选 `moyao_brand`，并填写对应已审核 `channel_codes`。大马通整店内容必须勾选 `damatong_storefront` 并填写 `damatong_channel_token=my-malaysia`。成功后 `Deploy Production Runtime` 会通过 OIDC、私有 S3 和 SSM 自动完成后续部署。或在受控 `linux/x64` 构建机生成唯一的 production runtime 目录并走人工发布。两种方式都必须完成自验证并记录外层校验和。
6. 自动路径由工作流上传归档并调用 `/usr/local/sbin/vendure-production-deploy-from-s3`；人工路径将工作流归档或整个产物目录原样传入 `/var/www/kaiyuangouwu-releases/<sha>-<唯一标识>-linux-x64`。禁止在 EC2 安装依赖或构建。
7. 服务器校验外层清单哈希、产物内全部文件、符号链接、平台、Git SHA 和运行依赖清单。
8. 记录当前稳定指针；如果发布计划包含任一受管 publisher，先使用当前健康 API 完成只读 dry-run。数据库迁移只在该预检和生产环境审计明确通过且备份完成后，通过专用迁移入口执行一次。部署日志必须包含 `DEPLOY_BACKUP_OK file=<本地备份> offsite=yes invocation_id=<systemd invocation>`，缺失精确备份文件、校验文件或异地上传证据时停止迁移。
9. PM2 从候选目录直接启动已编译的 Worker 和 API，不使用 Vendure CLI；等待 `127.0.0.1:3002/health` 与 `127.0.0.1:3002/image-generation/health` 成功，并递归验证候选 Dashboard 的入口、样式、主包与懒加载 JS/CSS 全部可访问。
10. 从候选产物预演并执行本次审核过的库存继承修复、店铺图片同步、登录/注册内容批次和 MOYAO AI 品牌同步；所有远程写入都必须使用 `--apply --allow-remote`，媒体随后还必须通过 `--verify`，并且必须已通过第 8 步的只读预检。全部成功后才原子切换 `kaiyuangouwu-current`。
11. 验收前台、后台、Shop API、Admin API、静态资源和 PM2 状态，确认线上 Git SHA。
12. 完成发布记录中的制品名称、制品 SHA-256、制品与部署工作流编号、UTC 时间和验收结果；记录必须能够唯一定位生产运行的代码和制品。
13. 发布与验收成功后，先用 `Cleanup Merged Production Branches` 的 dry-run 核对候选，再以 `apply=true` 删除已包含在当前生产 SHA 且不再使用的远程功能/热修复/release 分支；撤销临时 SSH 规则，仅保留原有固定规则。候选和回滚包按策略保留，不删除用户数据。

## 上线验收

```bash
cd /var/www/kaiyuangouwu
node deploy/verify-production-release.mjs \
  --storefront-url https://moyaoai.com \
  --dashboard-url https://console.moyaoai.com/dashboard/ \
  --release-id "$(cat /var/www/kaiyuangouwu-releases/current-sha)"
```

验收脚本会确认主域名首页和 Shop API 无推广 Cookie 也能直接访问，同时单独验证 `/promo` 推广页与签名进入按钮仍然有效。然后继续检查带哈希的实际前台 JS/CSS 资源、Dashboard 和公网 Admin API 拒绝策略。Dashboard 验证会以发布 SHA 追加缓存穿透参数，并递归检查入口 HTML 引用及 JS 中声明的所有懒加载 JS/CSS；任一资源 404、状态码或 MIME 类型异常均视为发布失败并回滚。`/assets/` 目录本身不是有效静态资源验收地址。

实时更新端点必须返回 `text/event-stream`，在两秒内输出有效 `ready` 事件，并在 18 秒内输出 heartbeat。公网探针会模拟旧版客户端携带无效 `vendure-token` 的请求；生产入口必须丢弃这个不可信渠道头，继续按已验证域名解析店铺。使用会在读到目标帧后主动关闭并等待 socket 释放的验证器，不使用依赖 `curl --max-time` 强制中断的连续探测：

```bash
node deploy/verify-storefront-realtime.mjs \
  --mode public-smoke \
  --url 'https://moyaoai.com/storefront-realtime/events?client=storefront' \
  --ready-timeout-ms 2000 \
  --heartbeat-timeout-ms 18000 \
  --release-id "$(cat /var/www/kaiyuangouwu-releases/current-sha)"
```

定时 `Monitor Production Health` 只执行上述单连接 smoke，避免监控自身定期打满连接。发布后如需执行完整容量与释放审计，必须人工触发该工作流并显式设置 `audit_realtime_capacity=true`。完整审计通过生产机回环访问 Nginx，使用三个隔离的合成访客 IP，不会占用真实访客的单 IP 配额：

```bash
node deploy/verify-storefront-realtime.mjs \
  --mode origin-full \
  --url 'https://moyaoai.com/storefront-realtime/events?client=storefront' \
  --connect-address 127.0.0.1 \
  --connection-limit 12 \
  --safe-concurrency 8 \
  --open-interval-ms 200 \
  --hold-open-ms 5000 \
  --ready-timeout-ms 3000 \
  --heartbeat-timeout-ms 18000 \
  --release-timeout-ms 5000 \
  --recovery-poll-ms 250 \
  --serial-cycles 3 \
  --release-id "$(cat /var/www/kaiyuangouwu-releases/current-sha)"
```

完整审计的四个独立门禁是：

- 公网正常用户：单连接返回 HTTP 200、`text/event-stream`，两秒内收到版本与 heartbeat 间隔都合法的 `ready`，并在 18 秒内收到 heartbeat；
- 安全并发：同一合成 IP 的 8 条连接全部在三秒内就绪，并共同保持五秒；
- 边界与超限：新合成 IP 的前 12 条全部就绪，第 13 条只允许返回 HTTP 429，已接受连接必须继续收到 heartbeat；
- 释放恢复：第三个合成 IP 关闭 12 条连接后，同 IP 在五秒内重新同时占满 12 个槽位并保持五秒，之后三轮“连接—`ready`—明确关闭”全部通过。

释放窗口内短暂的 429 是有界重试的测量值，不是失败；超过五秒仍未重新同时占满 12 个槽位才失败。任何 503 或其他 5xx 都立即失败。Nginx 会将该路由的 `limit_conn_status`、`limit_req_status`、HTTP 状态、请求/上游时间、连接编号与 Cloudflare Ray ID 写入 `/var/log/nginx/moyao-storefront-realtime.log`，用于区分连接上限 429 和请求速率 429，不记录 Cookie、Authorization 或响应正文。`origin-full` 只证明本机 Nginx 到应用的槽位释放，不能代替 Cloudflare 到源站取消延迟的公网链路评估；公网 smoke 的 CF Ray ID 必须与上述专用日志关联后再定位该类延迟。

只有未执行任何主动容量测试时，公网单连接持续无法就绪或返回 5xx，才属于实时更新可用性回滚条件。完整容量审计中的边界、超限或释放时间不符合预期时，必须先清理全部探测连接并停止发布收尾，不自动回滚到已知会恢复更低连接上限或 503 语义的旧版本。验证器未能确认自身连接已清理时，结果记为“验收无效”而不是“产品失败”，需换用新的合成 IP 重试。

另外检查：

- `pm2 jlist` 中 `vendure-api`、`vendure-worker` 均为 `online`；
- `Monitor Production Health` 输出一行不含凭据的 `AI_IMAGE_METRICS` JSON；使用其中的 24 小时成功/失败/UNKNOWN、缺失成本、失败桶和健康 Key 数定位 AI 告警；监控还会按模型、供应商、请求档位和实际像素输出脱敏的 `AI_IMAGE_RESOLUTION_MISMATCH`，并按模型、供应商和结果输出 `AI_IMAGE_MISSING_COST`，不会打印提示词、客户信息、Key、原始错误或上游响应；
- `127.0.0.1:3002` 正常监听，公网不直接暴露 3002；
- `/storefront-realtime/events` 不缓冲 SSE，连接断开后前端能自动重连；
- 公网 `https://moyaoai.com/admin-api` 和 `https://damatong.net/admin-api` 均被 Nginx 拒绝；
- 分别验收 `moyaoai.com` 返回 MOYAO AI 主 Channel、`damatong.net` 返回美宜佳 Channel，商品、价格、订单和店铺品牌不得串店；
- 管理后台能读取各店铺设置，前台按对应 Channel/店铺域名展示；
- 实际支付、邮件、短信和物流在未配置真实供应商前不得宣称已具备正式交易能力。

## 回滚原则

- 回滚目标是上一个已通过健康检查、仍保留在 `kaiyuangouwu-releases` 中的不可变运行产物。
- 先对回滚产物重新执行 `verify-runtime.mjs --expected-sha <ROLLBACK_SHA>`，再将 PM2 和 `kaiyuangouwu-current` 指回该目录，最后重复上线验收。不单独拷贝旧 `dist` 或 `node_modules`。
- 不回滚或删除数据库、上传资产、订单、客户、店铺配置和测试数据，除非另有经过确认的数据恢复方案。
