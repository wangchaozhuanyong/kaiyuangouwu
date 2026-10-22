# iPhone Chrome COOP 兼容补丁

范围与验收：**候选代码、本地检查与实际 iPhone 合成 HTTPS A/B 对照通过；正式商城尚未部署。用户已授权代理操作镜像，并明确授权新增不停止 API 的 Nginx 发布分支及后续发布。** 实际发布版本与原生 Actions 结果另记入本地 `release-ledger.json`。

原始兼容补丁包含两份配置/测试代码及本说明；后续授权的发布控制变更见下文。下文引用的截图、日志、动态检查收据和原配置备份是本工作区的本地附件，不纳入代码提交。2026-10-22 再次执行时，已核对当前两份代码的差异 SHA-256 与通过检查的 `changes.patch` 完全一致，按项目要求复用已通过的相关检查，没有重跑全仓 CI。

## 电脑端结论（2026-10-22 补充）

以下电脑结果取得于用户当时要求只做电脑验收的阶段。用户随后明确授权镜像操作，手机实测结果见下文；候选的 UA 例外未扩大。

- 在电脑 Chrome 普通模式保留既有网站数据，四站各连续刷新 3 次，共 12 次有效取证：文档均为 HTTPS 200、`securityState: secure`、页面加载完成；有效记录没有 HTTP 明文请求、HTTP 资源属性、证书错误或 mixed-content 阻止。
- 四站分别打开地址栏原生“网站信息”，均显示“连接是安全的”。原生截图：`desktop-moyao-secure.png`、`desktop-damatong-secure.png`、`desktop-shop-secure.png`、`desktop-renovation-secure.png`。
- 独立电脑窗口的模钥导航在约 562 ms 截到 ⓘ，此时新导航尚未提交、旧新标签页内容仍可见；加载完成后变成正常网站设置图标。截图分别为 `desktop-moyao-navigation-first.png`、`desktop-moyao-loaded.png`。562 ms 不是完整加载耗时，也不是每次刷新都保证的持续时长。
- Chrome 官方实现中，连接信息未初始化时为 `NONE`，该状态显示 `kInfoIcon`；`SECURE` 显示网站信息图标：[连接状态实现](https://raw.githubusercontent.com/chromium/chromium/main/components/security_state/core/security_state.cc)、[图标映射实现](https://raw.githubusercontent.com/chromium/chromium/main/components/omnibox/browser/location_bar_model_util.cc)。结合本轮实际截图，电脑现象符合导航初始中性状态；未发现需要通过网页补丁修复的持续不安全状态。网站不能保证浏览器导航瞬间完全不显示该图标。
- 装修官网普通刷新经过离线服务，返回旧缓存的证书元数据（到期时间 `2026-10-21T18:17:13Z`），但原生连接说明和响应安全状态均为安全。使用工具实际支持的 `Network.setBypassServiceWorker` 做一次临时对照，直接联网读到的证书到期时间是 `2026-12-19T18:47:21Z`（马来西亚时间 12 月 20 日）；仍为安全。已在 `finally` 恢复绕过开关，没有清数据或注销服务。旧缓存证书记录不是当前服务器证书过期的证明，也未证实为本次图标原因。
- 合成 HTTPS 原配置 / 候选配置在桌面 Chrome 下均为安全、均保留原 COOP 头；确认现有 iPhone 候选不改变桌面行为。

完整记录：`desktop-validation.json`。跨来源切换时出现 `truncated: true` 的 round 0 记录不计入 12 次有效刷新。连续刷新取消了少量前一轮 Fetch（`net::ERR_ABORTED`）；不把该取消视作证书故障。部分缓存资源的 `securityState` 为 `unknown`，最终结论采用文档安全状态和原生连接说明，不将 unknown 直接判成不安全。

**处理决定：本轮不新增电脑安全配置修改，不为消除中性图标而放宽桌面 COOP；iPhone 候选另以实际手机 A/B 结果判断。**

## 归属与基线

- 项目：Vendure 共享商城；真实 Git 根目录 `/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master`。
- 独立工作区：`.codex-worktrees/ios-coop-compat-20261022`，分支 `codex/ios-coop-compat-20261022`。
- 候选最初基于 `6b661344274ca8b5417dc47db23c14abbd04d5af` 开发，发布准备时已接到最新主线 `addc5958aaf4452adab2c13d88657d054dd304c5`。两份配置与测试源码和此前通过检查的差异完全一致，保留主工作区所有未提交修改。没有从装修官网或其他工作区复制应用代码。
- 技术范围：Nginx 共享商城 HTML 响应配置。React 19 / TanStack Router / Vite / Bun 的应用代码未修改。本地 Node 24.19.0、Bun 1.3.14；Node 版本符合本仓库 engines。
- 适用于该共享配置承载的 Moyao、Damatong、FLASH CAST 商城及同一共享服务中的店铺，不按店铺选择组件或业务规则。装修官网不在本补丁内。

## 具体变更

`deploy/nginx/damatong.conf` 新增一个惰性求值的响应头映射，仅当以下条件全部成立时不发送 COOP：

1. 处于三个既有商城 HTML 响应位置之一。
2. 请求是 GET 或 HEAD，最终响应类型为 `text/html`（允许 charset 参数）。
3. 完整 UA 与已复现的 iPhone / iOS 27.0.1 / Chrome `155.0.8059.37` 或 `156.0.8078.46` 匹配。

其他浏览器、未复现的新版本、其他 iOS 版本、非 HTML 响应和其他方法继续发送 `same-origin-allow-popups`。API 默认层与 Admin 配置保持原样。HTML 响应增加 `Vary: User-Agent`，原有 no-store 缓存策略保留。

**安全取舍：匹配例外的浏览器暂时不具备 COOP 的窗口隔离保护。** 这是一项窄范围兼容缓解，不是保持全部保护不变。TLS、HSTS、CSP、frame-ancestors、认证校验、API、数据库、Cookie、存储和离线服务均未修改。没有强制刷新或清理用户数据的客户端代码。

官方机制参考：[WebKit 318495](https://github.com/WebKit/WebKit/commit/702c6b7899c5)、[Nginx map](https://nginx.org/en/docs/http/ngx_http_map_module.html)、[COOP 标准](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies)。不通过猜测未验证的内核修复版本扩大例外；后续新版本默认恢复原保护。

## 实际检查

| 检查                      | 结果 / 边界                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 真实 Nginx 路由及响应测试 | 6/6 通过；新增 98 组 COOP 响应断言，覆盖 12 种 UA、四类 HTML 路径、GET/HEAD、CSS 和 POST；含 charset、404、缓存差异与其他安全头保持 |
| 相关部署安全契约          | 5/5 通过，覆盖 Nginx 安全头、Shop API CORS 与真实 IP 边界                                                                           |
| 最新基线 GoogleAuthButton | 7/7 通过，含 nonce、作用域、移除表单、重复回调和重试                                                                                |
| 本地 Chrome 跨来源弹窗    | 普通 UA 与实际 iPhone UA 模拟均回调成功；未提交测试输入保留。仅 127.0.0.1 ↔ localhost 模拟，不是真实 Google 登录                    |
| 手机实际 UA               | 通过手机 Chrome 的公开 user-agent 回显读取，完整 UA 符合候选规则；截图与 JSON 已保存。该回显没有被用作 HTTPS 安全对照               |
| 语法、格式、差异          | Node 语法、Prettier、git diff --check 均通过                                                                                        |
| 配置最小差异保护          | 移除新增映射、恢复三处 COOP 常量并去掉新增 Vary 后，与原备份逐字节相同                                                              |

应用源码未变，没有运行全仓 CI、数据库测试或应用构建。Google 组件测试触发的无关路由生成格式差异已恢复到本工作区 HEAD，未纳入候选。此前旧基线的 4 项 Google 测试日志仅作历史过程记录，当前结论采用 `google-auth-final.log` 的 7 项结果。

## 实际手机对照与边界（2026-10-22 补充）

用户明确授权后，通过 iPhone 镜像操作同一台手机 Chrome 普通模式，保留原有 7 个普通标签、Cookie、缓存、登录与网站存储。浏览器完整 UA 匹配候选中的 iOS 27.0.1 / CriOS 156.0.8078.46 规则。

- A 原配置保留 COOP；从 B 返回 A 后，加载超过 30 秒仍显示 ⓘ，原生网站信息为“连接：不安全”，详情为“连接不安全”。重新建立的 A 标签也再次出现图标。A 自身再次明确刷新可能恢复安全，因此触发条件包含导航上下文，不能声称每次刷新都异常。
- B 候选从已异常的 A 切入时可能暂存旧连接状态；明确刷新后恢复正常。连续执行 10 次刷新，计数从 3 到 12，每轮加载后无持续 ⓘ；最终等待 30 秒，原生网站信息显示安全。
- 直接新建普通标签访问 B 共完成 3 次关闭重开，实测计数为 13、15、17；额外 A/B 导航与一次未提交的错误地址输入不算入验收。最终等待 30 秒，原生详情为“连接是安全的”，证书签发者 WE1。
- 合成测试草稿在上述刷新和复开后保留。只关闭本次创建的测试标签，原有普通标签仍为 7 个，没有清理网站数据或注销服务。

原生截图与实际动作收据在本地 `https-phone-acceptance/mobile-acceptance.json` 及其列出的 PNG。A/B 使用相同正文和脚本，响应头来自当前候选 Nginx 规则。它验证该响应头缓解方案在真实手机上的有效性，**不是完整商城构建、真实 Google 授权或正式站上线验收**。不能承诺旧异常标签在没有明确刷新的首次导航就立即恢复。

测试服务不连接 Google 或业务 API。临时 Cloudflare quick tunnel 不使用账户令牌，不修改 DNS 或正式域名；按本地 runtime 收据清理。装修官网原有 5193 预览保持运行。

## 交付与回滚

- 原始兼容补丁的两个代码文件：`deploy/nginx/damatong.conf`、`deploy/nginx/storefront-fallback.spec.mjs`。
- 精确差异：`changes.patch`；检查收据及哈希：`verification.json`；浏览器结果：`browser-validation.json`。
- 原配置：`backups/ios-coop-compat-20261022/damatong.conf`。仅在本工作区恢复该文件即可撤销配置候选；没有执行任何生产回滚。
- 本说明不充当发布收据。实际手机候选对照已通过；正式站仍需在合规发布后验收。匹配浏览器暂失 COOP 窗口隔离的取舍见前文，电脑瞬时图标不是该补丁的修复目标。发布过程使用项目既有 Production Release 流程，并在单一发布账本中记录 PR、检查、合并版本、生产版本和验收结果。

## 不停止 API 的独立发布控制

用户于手机验收通过后明确批准。Production Release 新增 `nginx` 分支，继续使用最新 main 的完整 SHA、原生检查证据、同一生产部署锁和不可变 S3 配置归档。只在其他后端输入没有待发布变化、前端实际版本已覆盖对应输入时选中；未知部署脚本、依赖、迁移、后台代码或未覆盖前端差异继续被拒绝。

- `deploy/nginx-revision.cjs` 从原配置实际哈希、对应 Git 源码和独立 Nginx 收据识别配置版本；允许识别后来完整运行时发布替换的配置，拒绝不明漂移。原生 preflight 回传该版本。后续普通前端发布不再把已发布 Nginx 差异误计为运行时更新。
- `.github/workflows/deploy_nginx.yml` 只打包这一份配置并绑定归档及配置 SHA-256，不安装依赖、构建应用或运行迁移。`deploy/nginx-ssm.mjs` 仅运输锁定版本的控制脚本。
- `deploy/deploy-nginx-from-s3.sh` 在生产锁内重新核对版本、前端身份、实际旧配置哈希及归档内容，仅接受一个有界普通配置文件。
- `deploy/nginx-release.mjs` 保存原配置、隔离语法验证、原子安装、正式语法验证、reload，然后验证三个商城的桌面/iPhone HTML 与 Shop API 响应。相关失败恢复本次旧配置并校验、reload、重新验证。恢复失败单独报告，不伪造成功。
- API 与 Worker 的 PID、启动时间、工作目录和入口，运行时指针，以及 Storefront/Admin/2FA 指针和版本文件哈希前后必须相同。只写独立 Nginx 版本和收据，不推进后端或前端版本标记。
- 完成门禁要求 Nginx 部署及验收成功；已有运行时和前端门禁保留。恢复规则同步锁定新完成门禁指纹，禁止已执行 Nginx 发布被误归为可自动重试的派生检查失败。

新增控制验证涵盖范围拒绝、配置身份与漂移、后续前端路由、实际文件恢复、各事务阶段失败、原生 SSM 身份、公开安全头与 API 保护，以及工作流门禁。相关前端部署及生产运维检查合计 136 项，134 通过、2 项按环境跳过。此前兼容映射及 98 组响应检查输入未变，复用原通过证据；正式部署结果以发布账本为准。
