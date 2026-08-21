# Vendure 生产发布手册

最后核对：2026-08-21

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
- 本机访问：优先使用 AWS Systems Manager Session Manager；SSH 私钥仅保存在仓库外，发布时只允许当前管理员公网地址的 `/32`
- 服务器仓库：`/var/www/kaiyuangouwu`
- 候选/回滚目录：`/var/www/kaiyuangouwu-releases`
- Vendure 上游：`127.0.0.1:3002`
- PM2 进程：`vendure-api`、`vendure-worker`
- Storefront 静态目录：`/var/www/kaiyuangouwu/packages/storefront/dist`
- Dashboard 静态目录：`/var/www/kaiyuangouwu/packages/dev-server/dist/dashboard`
- Nginx 配置基线：`deploy/nginx/damatong.conf`
- 数据库：同一 EC2 上的 MySQL 8.0，使用 `single-host` 生产模式；每日逻辑备份与恢复演练脚本位于 `deploy/systemd/`。
- 异地备份：`yunqiao-vendure-backups-079740175286-ap-northeast-1`，实例角色上传，S3 保留 30 天，本地保留 14 天。

单机生产环境必须在 `.env` 中设置 `VENDURE_REQUIRE_OFFSITE_BACKUP=true` 和可写的 `VENDURE_BACKUP_S3_URI=s3://<bucket>/<prefix>`。备份脚本会上传压缩备份与 SHA-256 文件；未配置或上传失败时 systemd 任务失败。恢复演练完成后会自动删除临时数据库。

Cloudflare DNS 和 EC2 实例详情才是当前源站地址的准确信息来源。2026-08-21 核对的 EC2 公网 IPv4 是 `52.196.65.143`；不要把该 IP 当成永久地址。发布前必须重新核对。

当前 EC2 已由 SSM 托管，并绑定只访问所需 AWS 资源的实例角色。优先使用 Session Manager 维护；只有需要传输发布产物时才使用仓库外私钥，并将 `22/tcp` 临时限制为当前管理员公网地址的 `/32`。发布完成后立即撤销临时规则，不要上传或提交私钥。

## 发布门禁

当前单机生产拓扑必须设置 `PRODUCTION_DEPLOYMENT_PROFILE=single-host` 和 `PRODUCTION_OBSERVABILITY_MODE=system`。只有数据库自动备份、恢复演练、外部健康检查、关键告警、持久资源与加密密钥存储均有真实证据时，才可将对应 `READINESS_OPERATIONS_JSON` 字段设为 `true`。

在发布提交的干净隔离工作树中，通过进程环境安全注入生产等价的构建配置（密钥不得写入仓库或发布记录），并依次通过。必须先完成 monorepo 依赖拓扑构建再运行全量测试，禁止依赖开发工作区残留的 `lib`、`dist` 或 `package` 目录：

```bash
bun run lint
bun run build
bun run test
READINESS_PROCESS_ROLE=server bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=worker bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=migration bun run --cwd packages/dev-server audit:production-env
bun run --cwd packages/storefront test
bun run --cwd packages/storefront build
bun run --cwd packages/dev-server build
```

若仓库根命令与当次改动范围不匹配，以 `package.json` 的现有脚本和本次实际测试清单为准，并在发布记录中写明。构建 Dashboard 前必须使用干净的 `packages/dev-server/dist`，避免旧 Vite 哈希文件混入。

## 防止旧代码覆盖新代码的强制协议

正常发布必须满足以下不变量；任一不满足都立即停止，不允许通过手工复制文件继续：

1. **单一版本标识**：发布开始时锁定一个完整的 40 位 `TARGET_SHA`。远端分支、隔离工作树、构建产物、服务器代码和发布记录必须全部等于该 SHA。
2. **远端只能快进**：推送前记录 `origin/main` 的 `BASE_MAIN_SHA`，确认它是 `TARGET_SHA` 的祖先；使用普通 `git push`，禁止 `--force`。如果推送因远端已更新而失败，重新拉取、验证和构建，不能用旧本地分支覆盖远端。
3. **只从干净提交构建**：从 `TARGET_SHA` 创建 detached 隔离工作树；要求 `git status --porcelain` 为空。构建前明确清空该隔离工作树内的 `packages/dev-server/dist` 和 `packages/storefront/dist`，不复用开发目录或上次发布目录。
4. **产物不可变且可验证**：候选目录名必须包含 `TARGET_SHA` 与 UTC 时间且不得复用。发布包内必须包含 Git SHA、构建时间、Bun/Node 版本和所有产物的 SHA-256 清单；上传后先校验清单，再允许替换线上文件。
5. **服务器串行发布**：服务器使用 `flock` 获取唯一发布锁。锁内再次确认 `origin/main == TARGET_SHA`、当前运行提交是 `TARGET_SHA` 的祖先、受版本控制文件无本地修改；不满足时拒绝部署。
6. **代码只做快进更新**：服务器仓库只允许 `git merge --ff-only origin/main`，正常发布禁止 `reset --hard`、强制切分支或覆盖式同步。数据库、`.env`、上传资产和数字交付文件不参与代码同步。
7. **先备份、后原子替换**：当前构建产物先移动到带旧 SHA 的回滚目录，再在同一文件系统中用 `mv` 原子替换候选产物。禁止直接向正在服务的 `dist` 增量复制，避免新旧哈希文件混用。
8. **验证成功才登记版本**：PM2 重启及前台、后台、API、静态资源检查全部通过后，才原子更新 `/var/www/kaiyuangouwu-releases/current-sha`。最终必须同时满足服务器 `git rev-parse HEAD == TARGET_SHA`、版本标记等于 `TARGET_SHA`、线上健康检查成功。

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

## 标准发布流程

1. 确认本地只包含本次发布代码；设计验收截图、测试报告和其他未跟踪资料不进入发布提交。
2. 从目标提交创建隔离的干净工作树，运行测试和生产构建。
3. 将目标提交推送到 `origin/main`，记录完整 Git SHA。
4. 在服务器的 `/var/www/kaiyuangouwu-releases/<sha>-<UTC 时间>` 创建候选目录，不直接在运行目录构建。
5. 将本地已验证的 `packages/dev-server/dist`、`packages/storefront/dist` 和本地业务插件 `dist` 打包，校验 SHA-256 后传入候选目录。
6. 备份运行目录中即将替换的构建产物；保留 `.env`、上传资产、数字交付文件、数据库数据和测试数据。
7. 更新运行目录的受版本控制代码到目标 SHA，原子替换构建产物；数据库迁移只在生产环境审计明确通过且备份完成后执行。
8. 依次重启 `vendure-worker`、`vendure-api`，等待 `127.0.0.1:3002/health` 成功；失败立即恢复上一构建产物并重启原版本。
9. 验收前台、后台、Shop API、Admin API、静态资源和 PM2 状态，确认线上 Git SHA。
10. 撤销临时 SSH 规则，仅保留原有固定规则；候选和回滚包按需保留，不删除用户数据。

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

- 回滚目标是上一个已通过健康检查的 Git SHA 和构建产物。
- 先恢复 `dist` 目录，再恢复受版本控制代码，最后重启 PM2 并重复上线验收。
- 不回滚或删除数据库、上传资产、订单、客户、店铺配置和测试数据，除非另有经过确认的数据恢复方案。
