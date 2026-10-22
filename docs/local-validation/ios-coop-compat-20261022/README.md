# iPhone Chrome COOP 兼容补丁

范围与验收：**候选代码与本地验证完成；电脑端持续警告未复现，手机验收由用户自行完成。用户后续已明确授权完成剩余工作后发布，手机对照通过前仍不部署。不得把电脑结果当作手机修复证明。** 实际发布版本与原生 Actions 结果另记入本地 `release-ledger.json`。

本地提交只包含两份代码文件及本说明。下文引用的截图、日志、动态检查收据和原配置备份是本工作区的本地附件，不纳入代码提交。2026-10-22 再次执行时，已核对当前两份代码的差异 SHA-256 与通过检查的 `changes.patch` 完全一致，按项目要求复用已通过的相关检查，没有重跑全仓 CI。

## 电脑端结论（2026-10-22 补充）

用户最新要求停止手机验收、只做电脑端。本轮此后没有操作手机，也没有扩大候选的 UA 例外。

- 在电脑 Chrome 普通模式保留既有网站数据，四站各连续刷新 3 次，共 12 次有效取证：文档均为 HTTPS 200、`securityState: secure`、页面加载完成；有效记录没有 HTTP 明文请求、HTTP 资源属性、证书错误或 mixed-content 阻止。
- 四站分别打开地址栏原生“网站信息”，均显示“连接是安全的”。原生截图：`desktop-moyao-secure.png`、`desktop-damatong-secure.png`、`desktop-shop-secure.png`、`desktop-renovation-secure.png`。
- 独立电脑窗口的模钥导航在约 562 ms 截到 ⓘ，此时新导航尚未提交、旧新标签页内容仍可见；加载完成后变成正常网站设置图标。截图分别为 `desktop-moyao-navigation-first.png`、`desktop-moyao-loaded.png`。562 ms 不是完整加载耗时，也不是每次刷新都保证的持续时长。
- Chrome 官方实现中，连接信息未初始化时为 `NONE`，该状态显示 `kInfoIcon`；`SECURE` 显示网站信息图标：[连接状态实现](https://raw.githubusercontent.com/chromium/chromium/main/components/security_state/core/security_state.cc)、[图标映射实现](https://raw.githubusercontent.com/chromium/chromium/main/components/omnibox/browser/location_bar_model_util.cc)。结合本轮实际截图，电脑现象符合导航初始中性状态；未发现需要通过网页补丁修复的持续不安全状态。网站不能保证浏览器导航瞬间完全不显示该图标。
- 装修官网普通刷新经过离线服务，返回旧缓存的证书元数据（到期时间 `2026-10-21T18:17:13Z`），但原生连接说明和响应安全状态均为安全。使用工具实际支持的 `Network.setBypassServiceWorker` 做一次临时对照，直接联网读到的证书到期时间是 `2026-12-19T18:47:21Z`（马来西亚时间 12 月 20 日）；仍为安全。已在 `finally` 恢复绕过开关，没有清数据或注销服务。旧缓存证书记录不是当前服务器证书过期的证明，也未证实为本次图标原因。
- 合成 HTTPS 原配置 / 候选配置在桌面 Chrome 下均为安全、均保留原 COOP 头；确认现有 iPhone 候选不改变桌面行为。

完整记录：`desktop-validation.json`。跨来源切换时出现 `truncated: true` 的 round 0 记录不计入 12 次有效刷新。连续刷新取消了少量前一轮 Fetch（`net::ERR_ABORTED`）；不把该取消视作证书故障。部分缓存资源的 `securityState` 为 `unknown`，最终结论采用文档安全状态和原生连接说明，不将 unknown 直接判成不安全。

**处理决定：本轮不新增电脑安全配置修改，不为消除中性图标而放宽桌面 COOP；原 iPhone 候选保留待用户手机验收。**

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

| 检查 | 结果 / 边界 |
| --- | --- |
| 真实 Nginx 路由及响应测试 | 6/6 通过；新增 98 组 COOP 响应断言，覆盖 12 种 UA、四类 HTML 路径、GET/HEAD、CSS 和 POST；含 charset、404、缓存差异与其他安全头保持 |
| 相关部署安全契约 | 5/5 通过，覆盖 Nginx 安全头、Shop API CORS 与真实 IP 边界 |
| 最新基线 GoogleAuthButton | 7/7 通过，含 nonce、作用域、移除表单、重复回调和重试 |
| 本地 Chrome 跨来源弹窗 | 普通 UA 与实际 iPhone UA 模拟均回调成功；未提交测试输入保留。仅 127.0.0.1 ↔ localhost 模拟，不是真实 Google 登录 |
| 手机实际 UA | 通过手机 Chrome 的公开 user-agent 回显读取，完整 UA 符合候选规则；截图与 JSON 已保存。该回显没有被用作 HTTPS 安全对照 |
| 语法、格式、差异 | Node 语法、Prettier、git diff --check 均通过 |
| 配置最小差异保护 | 移除新增映射、恢复三处 COOP 常量并去掉新增 Vary 后，与原备份逐字节相同 |

应用源码未变，没有运行全仓 CI、数据库测试或应用构建。Google 组件测试触发的无关路由生成格式差异已恢复到本工作区 HEAD，未纳入候选。此前旧基线的 4 项 Google 测试日志仅作历史过程记录，当前结论采用 `google-auth-final.log` 的 7 项结果。

## 验收限制

此前手机 WPT 最小复现已两次确认 COOP 可以触发持续 ⓘ，撤销后明确刷新可恢复安全；它证明触发机制，不等于本商城候选已在手机完成原站副本验收。

已按此前临时测试授权建立独立合成 HTTPS 原头 / 候选头对照，只完成桌面 Chrome 验证；用户随后明确手机由其自行验收，本轮不再继续手机操作。没有进行真实 Google 账号授权。不得把桌面 UA 模拟、组件测试、HTTP 回显或桌面 HTTPS 通过称为“手机线上已修复”。用户的手机候选验收仍未完成；原建议为同一条件下 10 次刷新和 3 次重开，不清理普通标签、Cookie、缓存或存储。

测试服务仅包含合成页面和模拟回调，不连接 Google 或业务 API。临时 Cloudflare quick tunnel 不使用账户令牌、不修改 DNS 或正式域名；此前电脑验证所用入口已关闭，清理收据为 `temporary-https-runtime.json`。后续为用户自行手机验收准备的新对照入口及其原生响应记录位于本地 `https-phone-acceptance/`，沿用原 COOP 头和当前候选映射；A/B 正文完全相同，不把它称为完整商城构建或真实 Google 登录验收。装修网站原有 5193 本地预览未关闭。

## 交付与回滚

- 两个代码文件：`deploy/nginx/damatong.conf`、`deploy/nginx/storefront-fallback.spec.mjs`。
- 精确差异：`changes.patch`；检查收据及哈希：`verification.json`；浏览器结果：`browser-validation.json`。
- 原配置：`backups/ios-coop-compat-20261022/damatong.conf`。仅在本工作区恢复该文件即可撤销配置候选；没有执行任何生产回滚。
- 本说明不充当发布收据。正式发布前需用户完成手机候选对照，并核对 COOP 例外的取舍；电脑现象不构成发布该候选的有效性证明。发布过程使用项目既有 Production Release 流程，并在单一发布账本中记录 PR、检查、合并版本、生产版本和验收结果。
