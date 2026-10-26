# 商城生产访问与验收记录

本记录仅包含非敏感连接信息和操作方式。密码、访问密钥、会话令牌及私钥由系统／平台的凭据存储管理，不放入仓库或项目备份。

## 目标以发布配置为准

当前权威来源为 `.github/workflows/production_operations.yml`：

- AWS 账号：`098208446664`。
- Region：`ap-northeast-1`。
- 实例：`i-01d6737449bc52460`。
- 自动发布身份：`arn:aws:iam::098208446664:role/yunqiao-vendure-github-deploy`。
- 受管仓库：`wangchaozhuanyong/kaiyuangouwu`。

迁移前本机 `vendure-prod` 仍引用旧账户，会误导登录判断；不能把 profile 名称、AWS 网页账户名称或旧缓存当作当前生产归属。每次实际生产操作以当前 workflow 及目标实例核对为准。

## 优先使用现有自动身份

正式发布继续使用既有 Production Release。定向诊断使用 Production Operations 的固定操作，均通过 GitHub Actions OIDC 获取临时 AWS 身份，无需依赖浏览器 Cookie，也不需要下载长期访问密钥。

```sh
gh workflow run production_operations.yml \
  --repo wangchaozhuanyong/kaiyuangouwu --ref main \
  -f operation=diagnose -f source_sha='<已核对的最新 main 完整 SHA>'
```

上述命令是按需诊断入口，不应在每次续做时重复执行。先检查是否已有相同任务的运行和有效结果。发布仍遵守一次正式 SHA 一次 Production Release，以及既有 main、检查、制品、锁、备份和验收门禁。

## 本机辅助访问

2026-10-26 已建立 `vendure-production` 专用 profile，引用当前账户已有的 AWS CLI 登录会话。只新增非敏感绑定，不覆盖迁移前 profile，不生成 IAM 长期密钥，也不复制其他项目的环境变量或业务配置。

```sh
aws sts get-caller-identity --profile vendure-production
```

本机辅助会话仍会正常过期。过期时先使用已有的 GitHub 自动运维通道，避免反复要求用户登录网页。确实需要新权限或不同系统的人工身份验证时，应说明实际缺项，不能绕过安全验证。

本机 profile 仅标识认证会话，不是跨项目操作授权。商城操作必须固定上述仓库、Region、实例和运行版本；不可借此修改其他项目。

## 文件与验证

本次项目内非敏感记录位于 `backups/email-delivery-policy-20261026/`：连接绑定、实例核对、修复前后日志、测试回执及发布账本。正式运行 SHA、外部邮件结果与清理情况以该任务账本为准；连接成功或 SMTP 接受不等于客户已收件或交付完成。
