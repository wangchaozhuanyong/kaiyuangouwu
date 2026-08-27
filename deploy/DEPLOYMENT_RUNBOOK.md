# Vendure 生产发布手册

最后核对：2026-08-27

本文件只记录稳定的部署入口和无密钥操作流程，不保存密码、令牌、数据库连接值或私钥内容。

## 项目与入口

- 本地项目：`/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master`
- Git 仓库：`git@github.com:wangchaozhuanyong/kaiyuangouwu.git`
- 发布分支：`main`
- 包管理器：Bun（仓库根目录使用 `bun.lock`）
- 前台：`https://damatong.net`、`https://www.damatong.net`
- 管理后台：`https://console.damatong.net/dashboard/`
- 健康检查：`https://damatong.net/health`

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
- Vendure 上游：`127.0.0.1:3002`
- PM2 进程：`vendure-api`、`vendure-worker`
- PM2 生产环境固定设置 `VENDURE_DISABLE_TELEMETRY=true`，防止 Vendure 的文件系统兜底在不可变运行目录内写入 `.vendure/.installation-id`
- Storefront 静态目录：`/var/www/kaiyuangouwu-current/packages/storefront/dist`
- Dashboard 静态目录：`/var/www/kaiyuangouwu-current/packages/dev-server/dist/dashboard`（由 Vendure API 插件提供）
- Nginx 配置基线：`deploy/nginx/damatong.conf`
- TLS 协议只在 `deploy/nginx/damatong.conf` 的 `http` 作用域声明一次，固定为 `ssl_protocols TLSv1.2 TLSv1.3;`；生产机 `/etc/nginx/nginx.conf` 不得保留发行版默认的重复 `ssl_protocols` 声明。
- 数据库：同一 EC2 上的 MySQL 8.0，使用 `single-host` 生产模式；每日逻辑备份与恢复演练脚本位于 `deploy/systemd/`。
- 异地备份：`yunqiao-vendure-prod-backup-079740175286-apne1/mysql`，实例角色只能访问该前缀；存储桶已启用版本控制、SSE-S3 默认加密、阻止全部公网访问与 Bucket owner enforced。本地备份保留 14 天；S3 当前不自动删除，设置生命周期前必须单独确认保留期限。

单机生产环境必须在 `.env` 中设置 `VENDURE_REQUIRE_OFFSITE_BACKUP=true` 和可写的 `VENDURE_BACKUP_S3_URI=s3://<bucket>/<prefix>`。备份脚本会上传压缩备份与 SHA-256 文件；未配置或上传失败时 systemd 任务失败。恢复演练完成后会自动删除临时数据库。

Cloudflare DNS 和 EC2 实例详情才是当前源站地址的准确信息来源。2026-08-21 核对的 EC2 公网 IPv4 是 `52.196.65.143`；不要把该 IP 当成永久地址。发布前必须重新核对。

Nginx 会按 Cloudflare 官方 IPv4/IPv6 网段恢复 `CF-Connecting-IP`，按真实访客 IP 限流，并拒绝非 Cloudflare 来源直接访问 HTTPS 源站（仅放行本机回环健康检查）。每次发布 Nginx 配置前，必须对照 `https://www.cloudflare.com/ips-v4` 与 `https://www.cloudflare.com/ips-v6` 更新 `deploy/nginx/damatong.conf`，执行 `nginx -t` 后再 reload。AWS 安全组仍应把 `443/tcp` 限制到相同 Cloudflare 网段，形成网络层和 Nginx 双重限制。

当前 EC2 已由 SSM 托管，并绑定只访问所需 AWS 资源的实例角色。正常发布使用上文固定的仓库外私钥；若 SSH 端口或密钥不可用，再回退到 Session Manager。任何临时新增的 `22/tcp` 规则都必须只允许当前管理员公网地址的 `/32`，并在发布完成后立即撤销。不要读取、上传或提交私钥。

## 发布门禁

当前单机生产拓扑必须设置 `PRODUCTION_DEPLOYMENT_PROFILE=single-host` 和 `PRODUCTION_OBSERVABILITY_MODE=system`。只有数据库自动备份、恢复演练、外部健康检查、关键告警、持久资源与加密密钥存储均有真实证据时，才可将对应 `READINESS_OPERATIONS_JSON` 字段设为 `true`。

在发布提交的干净隔离工作树中，通过进程环境安全注入生产等价的构建配置（密钥不得写入仓库或发布记录），并依次通过。必须先完成 monorepo 依赖拓扑构建再运行全量测试，禁止依赖开发工作区残留的 `lib`、`dist` 或 `package` 目录：

```bash
bun install --frozen-lockfile --linker=hoisted
bun run lint:check
bun run build
bun run test
READINESS_PROCESS_ROLE=server bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=worker bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=migration bun run --cwd packages/dev-server audit:production-env
bun run --cwd packages/storefront test
bun run --cwd packages/storefront build
bun run --cwd packages/dev-server build
bun run --cwd packages/dev-server build:production-runtime -- --require-platform linux/x64 --audit-level high
```

最后一条命令只能在与 EC2 匹配的 `linux/x64` 干净构建机上执行。产物目录会包含平台、完整 Git SHA、`bun.lock` SHA-256、运行包清单、`RUNTIME-AUDIT.json` 和文件校验清单，并拒绝 `esbuild`、`less`、`tar`、`typescript`、`vite`、`webpack` 或达到指定审计阈值的包进入运行目录。使用 `--allow-dirty` 生成的产物只允许本地演练，不得部署。

正式制品优先使用 GitHub Actions 的 `Production Runtime Artifact` 手动工作流生成。输入必须是 `origin/main` 当前完整的 40 位小写 SHA；工作流固定使用 Node `24.19.0`、Bun `1.3.14` 和 `ubuntu-24.04` x64，并重复执行冻结安装、全仓审计、发布变更只读 lint、构建、测试、运行产物 High+ 门禁和自验证。分支未推送到 `main`、SHA 不一致、源码被修改、平台不符或任一门禁失败时都不会上传制品。

若仓库根命令与当次改动范围不匹配，以 `package.json` 的现有脚本和本次实际测试清单为准，并在发布记录中写明。构建 Dashboard 前必须使用干净的 `packages/dev-server/dist`，避免旧 Vite 哈希文件混入。

## 防止旧代码覆盖新代码的强制协议

正常发布必须满足以下不变量；任一不满足都立即停止，不允许通过手工复制文件继续：

1. **单一版本标识**：发布开始时锁定一个完整的 40 位 `TARGET_SHA`。远端分支、隔离工作树、构建产物、服务器代码和发布记录必须全部等于该 SHA。
2. **远端只能快进**：推送前记录 `origin/main` 的 `BASE_MAIN_SHA`，确认它是 `TARGET_SHA` 的祖先；使用普通 `git push`，禁止 `--force`。如果推送因远端已更新而失败，重新拉取、验证和构建，不能用旧本地分支覆盖远端。
3. **只从干净提交构建**：从 `TARGET_SHA` 创建 detached 隔离工作树；要求 `git status --porcelain` 为空。构建前明确清空该隔离工作树内的 `packages/dev-server/dist` 和 `packages/storefront/dist`，不复用开发目录或上次发布目录。
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
```

命令使用已由发布 shell 安全加载的 `SUPERADMIN_USERNAME`、`SUPERADMIN_PASSWORD` 和 `STOREFRONT_MEDIA_CHANNEL_CODES`；不得把密码写入参数或发布记录。同步失败立即停止发布，不切换 Storefront 指针。同一文件按 SHA-256 标签复用；新版文件只切换商品和内容块绑定，不删除旧素材，便于数据层单独回退。

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

1. 确认本地只包含本次发布代码；设计验收截图、测试报告和其他未跟踪资料不进入发布提交。
2. 从目标提交创建隔离的干净工作树，运行测试和生产构建。
3. 将目标提交推送到 `origin/main`，记录完整 Git SHA。
4. 对该 SHA 手动运行 `Production Runtime Artifact` 工作流；或在受控 `linux/x64` 构建机生成唯一的 production runtime 目录。两种方式都必须完成自验证并记录外层校验和。
5. 将工作流归档或整个产物目录原样传入 `/var/www/kaiyuangouwu-releases/<sha>-<唯一标识>-linux-x64`；禁止在 EC2 安装依赖或构建。
6. 服务器校验外层清单哈希、产物内全部文件、符号链接、平台、Git SHA 和运行依赖清单。
7. 记录当前稳定指针；数据库迁移只在生产环境审计明确通过且备份完成后，通过专用迁移入口执行一次。
8. PM2 从候选目录直接启动已编译的 Worker 和 API，不使用 Vendure CLI；等待 `127.0.0.1:3002/health` 成功。
9. 从候选产物预演并执行本次审核过的库存继承修复，再预演并执行店铺图片同步；两者写入都必须使用 `--apply --allow-remote`，成功后才原子切换 `kaiyuangouwu-current`。
10. 验收前台、后台、Shop API、Admin API、静态资源和 PM2 状态，确认线上 Git SHA。
11. 撤销临时 SSH 规则，仅保留原有固定规则；候选和回滚包按需保留，不删除用户数据。

## 上线验收

```bash
curl -fsS https://damatong.net/health
curl -I https://damatong.net/
curl -I https://console.damatong.net/dashboard/
curl -I https://damatong.net/assets/
```

另外检查：

- `pm2 jlist` 中 `vendure-api`、`vendure-worker` 均为 `online`；
- `127.0.0.1:3002` 正常监听，公网不直接暴露 3002；
- 公网 `https://damatong.net/admin-api` 仍被 Nginx 拒绝；
- 管理后台能读取各店铺设置，前台按对应 Channel/店铺域名展示；
- 实际支付、邮件、短信和物流在未配置真实供应商前不得宣称已具备正式交易能力。

## 回滚原则

- 回滚目标是上一个已通过健康检查、仍保留在 `kaiyuangouwu-releases` 中的不可变运行产物。
- 先对回滚产物重新执行 `verify-runtime.mjs --expected-sha <ROLLBACK_SHA>`，再将 PM2 和 `kaiyuangouwu-current` 指回该目录，最后重复上线验收。不单独拷贝旧 `dist` 或 `node_modules`。
- 不回滚或删除数据库、上传资产、订单、客户、店铺配置和测试数据，除非另有经过确认的数据恢复方案。
