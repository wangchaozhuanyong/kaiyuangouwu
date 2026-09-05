# 管理后台验证器 2FA

此功能保护管理员账号登录，使用 RFC 6238 TOTP（SHA-1、6 位、30 秒），不绑定手机号、不发送短信。后台原有验证码管理器继续使用独立的 `dashboard_two_factor_account` 数据。

## 使用

进入个人资料的“账号安全 · 验证器 2FA”。验证当前密码后扫描二维码或手动添加密钥，输入动态码确认绑定，再离线保存 10 个一次性恢复码。绑定请求 10 分钟有效，确认前不改变当前登录保护。

已开启的账号必须完成密码和动态码两步验证。也可使用密码加一个未使用的恢复码登录。登录挑战 5 分钟有效，最多验证 5 次。动态码只成功使用一次；刚确认绑定后，需等待验证器下一枚动态码，或使用恢复码登录。

关闭、更换验证器、重新生成恢复码均要求当前密码及动态码或恢复码。更换验证器在确认新动态码前保留旧绑定。开启、关闭、换绑、重新生成恢复码都会撤销旧会话和未完成的登录挑战。恢复码只在生成时展示，不提供查询完整旧恢复码的接口。

验证器和全部恢复码都丢失时，需要账号所有者核实身份后的受控运维恢复；本版本不提供跳过第二因素的公开重置接口。请在开启前保存恢复码。

## 上线前配置

- 在服务器秘密配置中设置 `ADMIN_TWO_FACTOR_ENCRYPTION_KEY`，值为 32 个安全随机字节的 64 位十六进制编码。独立于 `TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY` 和 Cookie 密钥；不要放进前端构建变量、代码或日志。
- 标准生产发布在备份后、迁移前通过现有秘密初始化脚本自动生成缺失或占位的登录密钥并原子保存。已配置的有效值原样保留；格式错误或与其他秘密重复时停止发布，不自动轮换。
- 密钥必须跨实例、重启、发布保持一致，并与数据库分别备份。没有有效密钥时，页面显示暂不可用，不允许绑定；已绑定账号验证失败时不会降级成密码登录。
- 执行注册迁移 `AddAdminLoginTwoFactor1788609600000`，新增四张 `admin_two_factor_*` 表。需先备份，使用项目发布流程，在切入新 API 代码之前完成迁移。
- 必须同时交付 API 和 next-admin 前端。新前端使用 `adminBeginLogin` / `adminCompleteTwoFactorLogin`；旧的 `login` 和 `authenticate(native)` 对未开启账号继续工作，对开启账号拒绝密码单独登录。
- 服务器保持时钟同步；验证码只容忍前后一个时间步。多实例共享数据库里的尝试次数、一次性消费状态和会话验证记录。
- 已有账号默认不启用，首次使用需要本人绑定。此代码开发不等于已配置线上密钥、已迁移或已部署。

## 安全边界

- 使用 AES-256-GCM，并将用户 ID 作为认证附加数据。登录密钥不进入现有验证码导入、导出或查询接口。
- 恢复码拥有 128 位随机性，只保存 SHA-256 哈希；登录挑战保存令牌哈希，不保存密码。密码指纹使用独立密钥的 HMAC，密码改变后旧挑战和 2FA 会话不能继续使用。
- 每个后台 GraphQL 根字段都检查已启用账号的会话验证记录。旧登录、其他认证策略和 Shop API 产生的会话都不能绕过检查。会话证明绑定用户、会话和安全设置版本。
- 验证码和恢复码消费使用数据库条件更新；并发提交只有一个请求成功。失败计数不能因业务验证失败而被回滚。
- API Key 属于机器凭据，继续按原权限调用业务接口，不被视为完成个人 2FA；不能查询或修改个人 2FA。此功能不替代 API Key 权限最小化及轮换。
- QR 图片由浏览器本地生成。密钥和恢复码只保存在页面内存；敏感响应使用 `Cache-Control: no-store`，Apollo 使用 `no-cache`。
- 开启、关闭、换绑、恢复码使用和登录事件通过 `AdminLogin2FA` 日志上下文记录用户 ID、动作和时间。尚未接入邮件或推送通知，也没有在其他管理员列表中暴露安全密钥。

## 验证

从仓库根执行：

```sh
bun run --cwd packages/two-factor-dashboard-plugin check-types
bun run --cwd packages/two-factor-dashboard-plugin test
ADMIN_2FA_BROWSER_QA=1 bun run --cwd packages/two-factor-dashboard-plugin test
bun run --cwd packages/two-factor-dashboard-plugin build
bun run --cwd packages/next-admin lint
bun run --cwd packages/next-admin test
bun run --cwd packages/next-admin build
bun run --cwd packages/dev-server test:migrations
bun run check:migration-registry
```

浏览器测试需要已安装的 Playwright Chromium。测试自动创建随机账号、临时密钥和独立 SQL.js 数据库，结束后关闭服务并清理测试数据库，不读取项目运行数据库或生产账号。浏览器夹具挂载实际 LoginModule 和 TwoFactorSecurityCard 并连接真实测试 API；它不代表整个商家后台或生产环境验收。可通过 `ADMIN_2FA_QA_OUTPUT_DIR` 指定已开启状态和登录验证页截图目录，截图不包含绑定密钥和恢复码。

迁移在真实 SQL.js 上验证幂等性及会话删除级联，MySQL/PostgreSQL 的列定义有单元检查；上线仍需在生产同类型数据库的隔离副本中验证迁移。

已启用账户后不能直接回滚到没有 2FA 防护的旧服务版本。应用回退需要保留认证保护，或停止后台入口后进行受控恢复；不要通过删除 2FA 表或更换加密密钥来“修复”登录故障。
