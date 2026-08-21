# Vendure 生产发布手册

最后核对：2026-08-20

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
- 实例：`i-06e8d9728be77c331`（`yunqiao-vendure-tokyo`）
- 安全组：`sg-068b47d4049f71176`
- SSH 用户：`ubuntu`
- 本机私钥路径：`/Users/wangchao/Desktop/yamaxunmishi/aws-key.pem`
- 服务器仓库：`/var/www/kaiyuangouwu`
- 候选/回滚目录：`/var/www/kaiyuangouwu-releases`
- Vendure 上游：`127.0.0.1:3002`
- PM2 进程：`vendure-api`、`vendure-worker`
- Storefront 静态目录：`/var/www/kaiyuangouwu/packages/storefront/dist`
- Dashboard 静态目录：`/var/www/kaiyuangouwu/packages/dev-server/dist/dashboard`
- Nginx 配置基线：`deploy/nginx/damatong.conf`
- 数据库：同一 EC2 上的 MySQL 8.0，使用 `single-host` 生产模式；每日逻辑备份与恢复演练脚本位于 `deploy/systemd/`。

Cloudflare DNS 才是当前源站地址的准确信息来源。2026-08-20 的快照是 `damatong.net`、`console.damatong.net`、`cdn.damatong.net` 均指向 `3.113.54.188`；不要把该 IP 当成永久地址。发布前先从 Cloudflare DNS 和 EC2 实例详情重新核对。

当前 EC2 没有 SSM 托管状态。若本机公网 SSH 不通，使用 AWS CloudShell 生成临时密钥，通过 EC2 Instance Connect 写入 60 秒公钥，再从 CloudShell 连接；只临时开放 CloudShell 当前公网 IP 的 `22/tcp`，发布完成后立即撤销。不要把本地私钥上传到 CloudShell。

## 发布门禁

当前单机生产拓扑必须设置 `PRODUCTION_DEPLOYMENT_PROFILE=single-host` 和 `PRODUCTION_OBSERVABILITY_MODE=system`。只有数据库自动备份、恢复演练、外部健康检查、关键告警、持久资源与加密密钥存储均有真实证据时，才可将对应 `READINESS_OPERATIONS_JSON` 字段设为 `true`。

在发布提交上依次通过：

```bash
bun run lint
bun run test
READINESS_PROCESS_ROLE=server bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=worker bun run --cwd packages/dev-server audit:production-env
READINESS_PROCESS_ROLE=migration bun run --cwd packages/dev-server audit:production-env
bun run --cwd packages/storefront test
bun run --cwd packages/storefront build
bun run --cwd packages/dev-server build
```

若仓库根命令与当次改动范围不匹配，以 `package.json` 的现有脚本和本次实际测试清单为准，并在发布记录中写明。构建 Dashboard 前必须使用干净的 `packages/dev-server/dist`，避免旧 Vite 哈希文件混入。

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
