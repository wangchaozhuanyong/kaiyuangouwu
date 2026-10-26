# 充值草稿完整外壳路径补修

首轮 PR #838 已合并并发布为 `20f8dad84992964d9b065291930f3f9d03b76cae`，CI `40292422045` 和 Production Release `40295941110` 均成功。但线上验收使用真实键盘输入、同页中文切英文、CNY 不变后，兑换码仍清空。因此首轮发布不能记为全部线上验收通过。

## 根因与改动

充值路由自身的语言 key 已移除，外层 `StorefrontShell` 的 `AuthEmailDraftBoundary` 仍把 `storefrontCode` 放入 key。新语言公开配置尚未返回时，实际 bootstrap 会把这个展示字段短暂设为空，重建包含 Outlet 的整个子树。

沿用同文件已有登录弹层的身份回退：配置暂缺时使用稳定的 `market.code`。真实店铺或结算币种改变仍重建原边界。不缓存兑换码，不改登录协议、权限、样式、商品或支付接口。

## 证据

- 线上：首次新语言读取时，真实输入 `SYNTHETIC-NATIVE-20261026` 从有值变为空；URL 保持 `/gpt-recharge`，CNY 保持不变。未验证或提交兑换码。
- 修复前：实际 Shell → Outlet → 充值路由 → 真实表单在配置从有效代码变为空的中间帧重建输入，手机和桌面 2 项均失败，见 `recharge-shell-before.log`。
- 修复后：同一业务断言通过；Shell、充值路由、bootstrap 共 61 项通过，见 `recharge-shell-after-ordered.log`。既有真实店铺、市场、币种改变时清理草稿的断言保持不变。
- 浏览器：真实 Shell、Router、语言设置弹层和表单；只模拟配置到达及 API 配置读取。390/1440 视口双向切语言，在配置未到达和到达后均保留原输入节点及值，硬刷新清空，无 pageerror，见 `recharge-shell-browser-final.log` 及 `recharge-shell-20261026/results.json`。

新增用例最初插在依赖首次增强模块初始化的既有用例之前，导致该既有用例等待超时及连带失败；已保留原日志并恢复原用例先后顺序，没有修改断言或超时。浏览器夹具也补上真实 Router 提交完成标识，等待组件就绪后才输入；中间失败日志保留。

本地日志位于 `packages/storefront/test-results/release-functional-repairs-20261026/`，生成文件不提交。此补修需取得独立的定向 CI 和正式发布证据，再以新的公开版本核验；不能用第一轮成功部署代替此次线上验收。

## 按要求从正式 main 重新编译

既有 `rebuild_runtime` 开关只传给运行时构建，纯前端发布仍会恢复 CI 编译产物。现把同一开关传给既有前端发布流程；开启时跳过编译产物恢复，在固定 main 提交重新构建两个受影响前端。检查证据继续复用，不触发重复全量 CI，也不改部署锁、备份和验收门禁。

测试执行实际工作流中的 Bash 构建步骤，只模拟外围 Git/Bun/制品工具：开启开关且缓存存在时仍须构建两个前端；关闭时分别验证命中和缺失。修复前强制构建场景及开关传递两项失败，见 `fresh-frontend-before.log`；修复后连同既有前端保留契约共 10 项通过，见 `fresh-frontend-after.log`。
