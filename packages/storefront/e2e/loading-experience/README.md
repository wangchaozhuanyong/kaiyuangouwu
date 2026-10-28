# 加载体验本地浏览器验收

复用实际 storefront `dist/`、公开 SSR renderer 和合成匿名数据。服务仅监听本机，所有 GraphQL mutation/subscription 被拒绝，CSP 限定同源，不连接生产、数据库或真实账户。浏览器由 CUA 操作；此工具不启动或自动操作浏览器。

## 基线与候选启动

将下列占位路径替换为实际 Git 根目录或本项目内部工作树的绝对路径，工具、报告与截图均归该目录：

`/absolute/path/to/vendure-master`

在这个绝对目录运行下列命令。构建由主任务执行；工具不会构建或写入指定 `dist`。基线、候选使用同一版 fixture 和 observer，分别选择构建产物：

```sh
cd '/absolute/path/to/vendure-master'
node packages/storefront/e2e/loading-experience/preview-server.mjs --port=5198 --label=baseline --dist-root=/absolute/path/to/vendure-master/.codex-worktrees/loading-baseline/packages/storefront/dist
```

另一终端，同样在上述绝对目录：

```sh
node packages/storefront/e2e/loading-experience/preview-server.mjs --port=5199 --label=candidate
```

打开 `http://127.0.0.1:5198/__qa` 或 `http://127.0.0.1:5199/__qa`。`--dist-root` 必须是绝对路径，真实路径必须属于本仓库或内部 `.codex-worktrees/<name>/packages/storefront/dist`；SSR renderer、HTML 和所有静态资源均从所选 dist 读取。每次启动记录构建及 fixture/observer/依赖工具文件 SHA-256，并生成 artifactId；每份报告绑定对应 artifactId，保留不可覆盖的 artifact-<id>.json。不同工具哈希或传输模式的旧轮次只作 diagnostic-only，不混入正式对照。旧报告缺 artifactId 时不能补造当时版本。不把旧 dist 当作当前源码构建。更换构建产物后重启服务并换 label。

HTML 的路由脚本预加载直接调用所选 dist renderer 的可选 `getPublicRouteScriptPreloads(page, assetNames, readSource)` 异步导出，等待它按实际公开页面和该 dist 的 assets 文件名计算纯静态依赖闭包（不追踪动态 import()）。readSource 只接受已存在且通过白名单的 JavaScript 裸文件名，从同一选定 dist/assets 读取 UTF-8 源码；用返回的裸文件名生成 `/assets/` 下的 `rel="modulepreload" crossorigin` 链接，并去重模板已有 src/href。根据实测下载竞争，home-page 与 commerce-styles 两个较大展示模块使用 low 优先级，其余必需静态依赖使用 auto；首屏样式和图片保留原有优先级。旧基线缺少此导出时不添加提示，旧同步导出也兼容；cold 无 SSR 场景不调用此导出或读取模块源码。没有基于 label 或人工开关的特殊预加载；与生产使用同一 renderer 决策，renderer 与工具哈希均已纳入证据。

报告统一保存在当前工具工作树的 `docs/local-validation/moyao-loading-20261029/<label>/`，即使读的是基线 dist 也不向基线写文件。`/__qa/health` 返回实际绝对路径与构建校验值；`/__qa/requests` 返回当前服务收到的本地请求，可核实延迟读取是否实际发生。

本工具默认 `--compression=auto`，按浏览器 Accept-Encoding 协商 br / gzip，压缩 HTML、JS 和 CSS（含本地观察脚本）；可选 `off`、`gzip`、`br` 用于诊断。使用 Node 内置 zlib，保留 Content-Type，Content-Length 表示线传字节，添加 Vary: Accept-Encoding，不重复压缩已有 Content-Encoding。图片与数据延迟保持原场景，其他预览服务默认行为未改。基线与候选必须使用相同压缩模式。

## 采样方式

先选择 390 / 1440 宽度、模式、图片缓存及场景，再打开场景。iframe 保持所选 CSS 视口，外框过宽时仅缩放预览。默认每轮采样 12 秒；性能模式可选30秒观察多次自动轮播，几何模式固定12秒（最多900帧）。自动保存本地 JSON。保存结果显示在控制台；“开始导航采样”可在同一文档开始下一轮，再执行真实点击、详情往返或轮播操作。

| 模式                | 采集内容                                                                                                          | 使用边界                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| performance（默认） | 原生长任务、Layout Shift、LCP、Resource Timing、Event Timing；500ms 轻量状态、app-owned 事件、可信点击与 DOM 反馈 | 不读取每帧元素几何、计算样式或动画清单，不用此模式证明节点和图片视觉连续性      |
| geometry            | rAF 几何、节点身份、启动层/主页状态、动画 duration/delay、首屏及400px近屏图片、滚动位置；同时保留原生事件         | 高频读取会影响布局与性能，只作定位；不能与 performance 的长任务数据直接混合比较 |

对照时保持相同模式、视口、场景、缓存选择和操作顺序，单独比较基线与候选多轮结果。默认 `no-store` 图片场景仍不等于真实移动端冷网络；“允许5分钟缓存”只为暖缓存对照。慢入口延迟 JS 1600ms，慢数据延迟1200ms，慢图延迟2000ms。`product-images` 只延迟商品图，`images` 延迟所有合成图；`image-error` 让商品图返回503。`cold` 刻意去掉 SSR 及内嵌快照，以验收慢数据兜底。

几何模式最多跟踪32张可见/近屏图片，记录 img/frame 节点身份、currentSrc、声明 src/srcset/sizes、自然尺寸、complete、SafeImage 状态、预览图可见状态、位置、首次进入视口与首次具备绘制条件时间。资源时间与候选 URL 对应；缺少 Resource Timing 记录不能解释为未发请求。采样器不会调用 decode、改变 loading 或主动请求图片。

**DOM 可绘制条件不是实际像素证据。** 报告明确标记 `actualPixels: unmeasured-use-cua-screenshot-sequence`。“标记截图时刻”只保存操作者标记；截图序列由 CUA 产生并写入同一 label 的绝对目录。人工记录截图文件、场景、浏览器时间和标记对应关系；截图按钮本身不会生成截图，截图也不应仅凭最接近的 DOM 帧判定准确同步。

可信点击仅记录 `isTrusted` 事件。反馈记录目标状态、路由、弹窗、pending状态和 app-owned 的可观察变化，以及下一次 rAF 机会；没有变化记为未观察到，不冒充真实画面反馈或业务成功。原生 Event Timing 有浏览器阈值和支持范围，单次长任务/点击数据不是 INP 百分位。

## 合成页面与交互

首页按被审查页面的模块顺序与复杂度构造：顶部公告、三张 campaign 轮播、五个快捷入口、热销12件、推荐12件、每日精选、Codex 合成专区、品牌说明及实际页脚。轮播每5秒自动切换，三张使用不同桌面/手机图片路径、颜色与长短文案。每日精选使用真实 `FEATURED_COLLECTION`：1主图+6辅图，桌面两行三列，会经过真实拼图列宽对齐路径。所有商品身份、价格、文案和图片均为合成数据，既不复刻商家素材，也不要求与正式站像素位置相同。

公告和推荐使用真实当前读取字段，`StorefrontProductsByIds` 按请求 ID 返回一致的商品。SSR 推荐骨架接管为实际推荐内容的行为由真实生产组件决定。图片 SVG 均由本机返回。实际商品详情往返可用；购买、领券等写入始终405，不能验收业务提交结果。

“滚动到正文”后刷新检查原生滚动恢复，或在页面自行滚动到精选区。“后退/前进”用于真实详情导航后返回。采样器只在本地 sessionStorage 保存上次离开该 pathname 的 scrollY/history key，并记录这次初始位置；不修改浏览器滚动恢复。相同 pathname 上不同查询参数会共用这一离开位置记录，判断时一并看记录的 route 和时间。

优惠遵循当前 `couponCampaigns` / `couponAudience` 协议：

- `coupons`：明确匿名且无券，首帧起无整个模块和占位。
- `old`：两个字段缺失，本次首页不迟到插区。
- `targeted`：活动已准备、身份 unknown；不模拟登录资格，不显示访客券。
- `prepared`：匿名身份和公开券已准备，SSR 与接管首帧应一致。
- `late`：首文档缺字段，后续 page-data / GraphQL 返回活动并额外延迟1200ms。必须在请求记录中看到后续读取，才能声称覆盖迟到响应。

## 检查与汇总

在上面的项目绝对目录运行：

```sh
node --check packages/storefront/e2e/loading-experience/observe.js
node --check packages/storefront/e2e/loading-experience/preview-server.mjs
node --test packages/storefront/e2e/loading-experience/preview-server.spec.mjs
node packages/storefront/e2e/loading-experience/summarize.mjs baseline
node packages/storefront/e2e/loading-experience/summarize.mjs candidate
```

工具单测覆盖只读保护、优惠语义、场景延迟、dist真实路径隔离、模块/轮播/拼图输入、压缩协商与解压字节一致、证据缺失表达及低干扰采样约束。汇总不会操作浏览器，输出每个 label 的 `summary.json`，未测几何使用 null 而不是成功的0。`fcp` 取原生 Paint Timing；`visibleUnownedGapMs` 只使用原生 FCP 与 app-owned 事件之差。`firstContent` 保留为500ms间隔的DOM存在观测，不能替代绘制时间或1秒接管目标。`startupMaxLongTask` 统计开始时间不晚于 app-owned +100ms 的长任务；`steadyLongTasks` 为其后长任务。继续采样会保留同文档最初 app-owned 时间，30秒稳态轮次与首进单独报告；不支持原生 observer 时返回null。

完整逐帧报告可能超过 sendBeacon 限制，正常保存使用本地 fetch；离开前等到12秒保存回执，快速跳转的 pagehide 报告只作为尽力保存。所有本地测量都有采样开销；iframe和合成网络结果不能作为正式站、真实手机、地区网络或最终线上验收。完成后关闭本次服务。
