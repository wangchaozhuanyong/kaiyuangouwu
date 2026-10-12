# 缓存导航本地实验与桌面旧页读取修复

最后运行时输入已经过完整 storefront 构建、64 项首屏接管回归和 80 项缓存导航实验。构建没有修改预算，最终入口 376440 字节（367.617 KiB），低于原 380 KiB 上限。

## 计时方法

使用最终正式产物、真实 UI 控件和浏览器可信点击事件，循环首页 → 商品 → 首页 → 分类 → 首页。每个视口先完成 8 次导航加热代码和查询，再记录 40 次导航；每个方向各 10 个样本。

起点是 document capture 阶段的真实 click，终点是首个 requestAnimationFrame 中同时满足目标 data-route、目标页面可见、page-readiness=ready 的时刻。两个时间值均在页面内读取 performance.now，排除自动化工具往返和控件等待耗时。每项还检查原页面框架和内容容器保留，以及目标没有必需数据占位区域。p95 使用 nearest rank，原始样本在 warm-navigation-report.json。

实验环境为本机无 CPU / 网络限速的 Headless Chromium，390 × 844 和 1440 × 844 视口、英文、合成 36 商品目录。这是浏览器内的 ready DOM 帧计时，不是物理屏幕已绘制计时，也不是真实用户或生产服务器 p95。

| 最终视口 | 样本 | p50 | p95 | 最大值 | 新代码读取 | 新业务读取 |
| --- | --- | --- | --- | --- | --- | --- |
| 390px | 40 | 11.9ms | 13.6ms | 13.9ms | 0 | 0 |
| 1440px | 40 | 11.7ms | 12.6ms | 13.6ms | 0 | 0 |

两种视口均满足缓存切页 p95 ≤ 200ms，目标没有必需数据占位，框架和内容容器原节点均保留。80 个样本在运行时修复后全部重新采集；此次实验独立于同时运行浏览器回归，避免引入回归进程争用。

## 发现与最小修复

修复前，桌面 40 个样本中出现 10 次无 collectionId 的目录读取；切页本身仍达到目标。只读诊断进一步区分了两个行为：

- 单独悬停“商品”入口：同一无 collectionId 意图查询只读取一次，数据正常缓存；第二次悬停缓存年龄从 154ms 变为 815ms，没有重复读取。证据 warm-prefetch-diagnosis.json。
- 分类 → 首页完整循环：旧 DesktopCatalogPage 尚未卸载时收到首页 route。原 `route.name !== 'category'` 条件把这个不属于目录的 route 当作可读取目录；新的无 collectionId 查询随即在卸载时取消，状态回到 pending + idle + 无数据。下一轮又重复启动，不是 TTL 到期。证据 warm-prefetch-full-cycle-diagnosis.json。

DesktopCatalogPage 现只在当前 destination 属于 category / search 时启用读取，分类仍要求已解析的 collectionId，有效 search 无须 collection。离开目录时沿用最后实际 layout commit 的目录 route 和查询输入；目录内部使用同一 route 上下文，保留原商品卡和选中分类，直到新页面提交。运行时修复没有新增缓存、加载状态机或路由分支。

新 mounted 回归使用真实 QueryClient，覆盖离开到首页与商品时不启动读取、商品卡 DOM 原节点和选中目录保留、无占位区域、有效搜索仍读取、未解析分类等待且解析后读取。4 个相关测试文件共 53 项通过；测试回调最后格式修复后新增 4 项再次通过，其他 49 项输入未变复用。owned 5 文件 ESLint、Prettier、TypeScript 均通过。

## 最终证据

- final-navigation-guard-build.log：完整构建 exit 0，包含公共检查、类型、CSR 预算、SSR、2FA。
- navigation-final-core.log / navigation-final-edges.log：最终产物 28 / 36 项全部通过；错误和匿名账户重模块下载均为 0。
- warm-navigation-final.log / warm-navigation-report.json：最终 80 个原始缓存导航样本与请求记录，两种视口新业务读取均为 0。
- desktop-catalog-transition-tests.log / desktop-catalog-transition-tests-final.log：53 项相关回归与最终新增 4 项复测。
- navigation-owned-lint.log / desktop-catalog-transition-types.log：owned lint 与定向类型检查成功。
- preview-server-targeted.log / preview-server-listen-host-targeted.log：原 9 个 Node fixture 用例成功，并新增 IPv4 listenHost 专项 1 项成功。实际随机监听地址与浏览器地址一致；不需要更改生产运行时。

早期脚本设置失败记录仍保留：监听地址与本机 Docker IPv4 端口冲突的 warm-navigation-bind-collision-failure.json、桌面目标选择器错误的 warm-navigation-selector-failure.json、修复前观察的 pre-guard-warm-navigation-1440-report.json。没有把失败样本计入最终通过结果，也没有把无关预取重复读取归因为已证实的 fixture 问题。
