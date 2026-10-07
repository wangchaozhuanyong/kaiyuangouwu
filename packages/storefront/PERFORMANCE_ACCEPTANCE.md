# 三商城客户端加载改造与验收

记录日期：2026-10-06。适用于 MOYAO、大马通、闪铸共用客户端。

## 当前交付状态

- 本地实现及受影响检查完成。当前工作分支 `fix/client-loading-unification-20261006`，基础提交 `a535b99d937858b3907372bad77429aad809d8dd`。
- 工作区 `.codex-worktrees/unified-performance-20261006`；原主工作区既有修改未纳入本次修改。
- 未推送、未合并、未运行远端 CI、未部署、未购买资源。本地构建和合成数据验收不代表生产性能达标。
- 真实 Redis 已进行本地双进程集成测试；生产 Redis、队列、数据库规模和 CDN 仍须验收。

## 正式入口与迁移

| 范围 | 当前唯一入口 | 已退出的重复机制 |
| --- | --- | --- |
| 路由身份 | shared/public-page-data 的 canonical request / requestKey | 不同筛选共用 /category 身份 |
| 首屏 | SSI 快速快照 + 独立 public-page-bootstrap + public-page-transport | 首页快照用于分类、等待 React 后才开始目录请求 |
| 查询缓存 | 现有 TanStack Query，持久缓存 v7，目录 InfiniteData 每页 12 | 错分页形状、跨筛选 placeholder、旧空结果冒充新分类 |
| 导航 | 路由代码与公开数据并行，缓存页面立即显示并在后台更新 | 过期缓存页面必须等待数据后才返回、分类嵌套 lazy |
| 刷新 | config aggregate owner + public-refresh-scheduler | 配置、装修、活动各自定时轮询 |
| 兼容读取 | 聚合缺失数据段时由 config owner 刷新已挂载旧查询 | fallback 数据永久被排除刷新 |
| 加载 | PageReadinessBoundary + usePageReadiness 的明确必要查询 | DOM/图片/透明度推断 ready、整页透明淡入、无限循环顶部条 |
| 图片 | MediaDescriptor + 实际布局 sizes + 共用预取队列 | 160px 分类图标声明、手机行沿用网格尺寸、无上限旧原图回退 |
| 弹层 | OverlayHost | 迁移页面独立 Escape、body overflow、巨大层级 |
| 遥测 | storefront-performance + /_storefront/performance + performance-report.mjs | 不以动画或构建结果代替性能证据 |

配置／内容更新不会截断已加载的多页商品。SSE 失效会提升读取代次，迟到的旧聚合不能回填；筛选、币种、语言和店铺维持隔离。账户、购物车、订单不进入公共快照。

服务端 worker 维护每店最多 20 个热路由，固定保留默认币种的两语首页及主要可见分类；提前重建快照并复用各数据段缓存。预热去重以当前单 worker 部署为前提，多 worker 扩容前必须增加分布式调度互斥。共享缓存故障、持续过载或队列延迟仍可能造成冷读取。

图片保持原文件、质量及权限。手机普通行／侧栏行、桌面目录、图标和缩略图使用共享尺寸；SSI 根据原 URL 的实际布局选择同一组候选。冷转换按同键合并、限并发；预取最大并发 2，并遵守节省流量设置。

## 本次实际验证

详细原始证据位于本工作区：
`reports/unified-performance-20261006/` 和 `reports/client-loading-unification-20261006/`。

| 检查 | 本地结果 | 证据 |
| --- | --- | --- |
| storefront + two-factor 类型／生产构建 | 通过；未提高体积上限，入口 380 KiB 内、关键 CSS 368 KiB、最大路由 CSS 27 KiB | client-loading-final-integrated-build.log |
| content / management / asset 构建与定向 lint | 通过 | backend-public-route.md、client-image-implementation-20261006.md |
| 客户端定向回归 | 通过，包括真实发现的空状态闪现、失效迟到响应、多页截断、缓存返回等待及缺段恢复 | client-loading-*-regression.log、public-fallback-evidence.md |
| 弹层与预览竞争 | 定向测试通过；浏览器筛选／分享关闭与路由离开通过 | overlay-migration-evidence.md |
| 真实 Redis | 两独立 Node 进程使用真实 RedisCacheStrategy / CacheService；跨进程失效、币种隔离、12 并发只读 1 次、旧回填拒绝、故障恢复通过 | redis-live-evidence.json |
| Nginx 本地语法 | 临时容器 nginx -t 通过；副本省略生产 TLS 路径并使用本地 include fixture | nginx-local-syntax-report.md |
| 性能汇总脚本 | 7 项 Node 测试通过；不足 20 样本、未知地区／网络不可 PASS | performance-report-tests.log |
| 前端交互／排版约束 | 通过 | client-loading-interaction-guard.log、生产构建日志 |

分轮测试有重叠，不把日志用例数相加为唯一用例数。临时 Redis、Nginx 容器测试后均清理，既有容器未改动。

## 浏览器证据的含义

使用独立 loopback 合成数据服务，未代理生产账号或业务写入。覆盖首页、分类、搜索、详情，以及 360／390／768／1024／1440 宽度。浏览器为 Chromium，不能代替真实 iPhone Safari／Android Chrome。

- 冷分类人为设置数据延迟 1.8 秒、图片延迟 5 秒：初始保留导航与静态骨架；商品数据可见时 ready，图片仍未完成，不再阻塞整页操作。
- 冷样本目录请求在首个应用脚本请求后约 26ms 启动、先于分类模块；一次首屏仅 1 个相同目录聚合请求。这个数字只用于证明并行顺序，不是生产速度或 p75。
- 空分类切换到有商品分类：先显示目标骨架，再显示目标商品；无错误空状态、无旧分类冒充。
- 热快照在 360px／DPR3 下无需额外目录聚合请求；首图实际 79.44 CSS px，选择 240px 候选，仅下载一次，preload 和 img 的 sizes 相同。
- 360／390／768 筛选按钮位于可见区域且命中测试未被遮挡；Tab 留在顶层，Escape 关闭后恢复焦点和滚动。商品分享弹层打开后返回分类，未留下遮罩或锁。
- 1024／1440 目录未出现页面横向溢出。嵌套弹层和 AI 预览迟到响应主要由定向组件测试覆盖。

截图及 JSON：client-loading-final-mobile.jpg、client-loading-final-filter-360.jpg、client-loading-layout-evidence.json、client-loading-hot-dpr3-evidence.json、client-loading-browser-network.json。

本地 fixture 启动：在仓库根目录执行 `node packages/storefront/e2e/client-loading/preview-server.mjs --port=5199`。参数和隔离边界见 e2e/client-loading/README.md；fixture 写操作全部拒绝。

## 生产与真实网络仍待完成

| 项目 | 当前证据／阻断 | 后续验收 |
| --- | --- | --- |
| 生产版本 | 大马通只读浏览器基线入口为 index-C4Q0rDd9.js；不是本次构建，不是 Git 运行 SHA 证明 | 发布候选确定后核对 artifact SHA 与运行 SHA |
| 三店 CDN | 脚本公开探针返回 403；大马通正常浏览器可访问，其已缓存图片记录含 max-age=14400、s-maxage=300 | 查看三域名 Browser TTL／Cache Rules／Worker／响应头变换，比较源站与新鲜边缘响应，公开图浏览器和边缘均应不超过 300 秒 |
| 图片撤销／下架 | 权限和回退定向测试通过；真实 CDN purge 未测 | 隔离环境验证源站拒绝、精确清除边缘；旧浏览器缓存不会随 purge 清除，必须明确其残留窗口 |
| 生产开关 | 未读取或更改生产 Redis、媒体预生成、CDN purge 配置 | 复用已有配置确认 API／worker 私网 Redis 一致、预生成单并发及 purge 已配置，然后再测发布后首次访问 |
| 服务端指标 | 真实 Redis 本地正确性通过；无生产规模数据库样本 | 记录聚合热 p95≤300ms／冷≤800ms、已生成图片源站 p95≤200ms、SQL 和连接池等待 |
| 地区与设备 | 没有两地真实网络及实机 20 次样本 | 中国大陆／马来西亚 × 实际蜂窝 4G／固定宽带，分别测试冷、热、过期、发布后首次访问，每关键场景至少 20 次 |
| 视觉及交互全矩阵 | 合成数据主要页面和关键弹层通过 | 三店真实配置、长内容、全部迁移弹层、软键盘、Safari／Android、离线重连及取消发布回归 |

CDN 四小时覆盖来源尚未确认；不能只凭缓存响应头判定具体是哪一条 Cloudflare 规则。不得把本次本地构建称为线上修复完成。

## 指标采集和发布门槛

客户端沿用现有统计偏好，仅发送临时文档 UUID、版本、页面类型、设备、有效网络等级及数值指标；不发送完整 URL、DOM 选择器、订单、账户、表单或 Cookie。地区仅由可信 Cloudflare 连接在服务端确认，否则 UNKNOWN。

`navigator.connection.effectiveType=4g` 是有效网络等级，不证明实际蜂窝 4G；Safari 可能没有该值。物理网络必须由独立实机验收记录证明，不能由 RUM 自动推断。CWV 记录以当前文档首开页面类型归类，不将一次 SPA 会话伪装成多份独立首屏样本。

汇总匿名日志：
`node packages/storefront/scripts/performance-report.mjs /项目内/anonymous-performance.log`。
输出按版本／店铺／地区／设备／有效网络等级／页面／指标分组，重复 sampleId 的更新不增加样本数，包含 LCP 各阶段 p75。样本不足明确标记，不与实验室数据混算。

正式门槛：LCP p75≤2.5s、INP≤200ms、CLS≤0.1，缓存返回≤200ms；服务端使用上表 p95；首屏相同目录及同候选图片重复下载为零；错分类、旧响应覆盖、遮罩残留、按钮遮挡为禁止发布项。

获得发布授权后，先固定最终候选和输入指纹，复用有效本地证据，只触发一次对应远端 CI、同 SHA 一次 Production Release。分别报告 CI、合并、运行 SHA、功能验收、真实性能；未达门槛继续定位，不以发布成功替代体验结果。
