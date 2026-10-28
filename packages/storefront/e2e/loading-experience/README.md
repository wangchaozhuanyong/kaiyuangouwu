# 加载体验本地浏览器验收

复用实际 storefront `dist/`、公开 SSR renderer 和合成匿名数据。服务仅监听本机，所有 GraphQL mutation/subscription 被拒绝，不连接生产、数据库或真实用户账户。浏览器通过 CUA 操作，不由此脚本启动。

在仓库根运行：

```sh
node packages/storefront/e2e/loading-experience/preview-server.mjs --port=5198 --label=release-candidate
```

用浏览器打开 `http://127.0.0.1:5198/__qa`。选择 390/1440 宽度和场景，再点击“打开场景”。iframe 的实际 CSS 视口保持所选宽度，过宽时只缩放外部预览。记录每帧几何、scrollY、标题与节点连续性、启动层、长任务、布局位移和绘制时间。12 秒后自动保存报告，刷新/离开也会保存当前采样。

“滚动到正文”后再“刷新当前页”检查原生滚动恢复。“后退/前进”用于检查通过真实导航进入详情后返回。缺优惠字段、无券、身份未知、已准备匿名券、迟到公开券、慢图片、慢入口和深色皮肤有独立场景。

正文包含 12 件匿名合成商品，支持实际商品详情往返；`StorefrontProductsByIds` 按请求 ID 返回完整且数量一致的结果。采样也记录公开 history key、popstate/scroll 事件、页面高度、读取失败提示，以及动画实例的实际 duration/delay。完整逐帧 JSON 超过 sendBeacon 的队列上限，正常采样使用本地 fetch 落盘；离开页面前优先等到 12 秒完成。

汇总已有报告（不会操作浏览器）：

```sh
node packages/storefront/e2e/loading-experience/summarize.mjs release-candidate
```

证据保存在当前隔离树的 `docs/local-validation/soft-loading-release-20261028/<label>/`，含实际构建文件校验值。旧 `dist` 如被使用必须标明 `baseline-existing-dist`，不代表当前源码构建；最终构建完成后重启服务并使用新 label，保证 renderer 与浏览器 bundle 相符。

此测试页面注入同步本地采样器，会增加少量测量开销。iframe 与本地合成数据的结果不能作为生产网络、真实手机性能、地区网络、INP 百分位或最终线上验收。首屏图片和服务端主题还需与生产渲染器定向测试交叉验证。

优惠场景遵循当前 `couponCampaigns` / `couponAudience` 协议：

- `coupons`：明确匿名、活动数组为空，从首帧起无模块、无占位。
- `old`：两个字段均缺失，表示旧快照或未知，整个本次首页无占位，不迟到插入。
- `targeted`：公开活动已准备但请求身份为 `unknown`，首帧不显示访客券。这只是身份未知的合成场景，不模拟真实定向资格或登录账号。
- `prepared`：匿名身份与可领取公开活动均已准备，SSR 与接管首帧显示相同专区。
- `late`：首文档缺活动字段，后续 page-data/GraphQL 读取才有合成活动，读取额外延迟 1200ms。本次首页不得迟到插入。验收必须确认实际发生后续读取；未发生则只证明未知首帧，不能声称迟到响应已覆盖。

采样记录优惠专区首帧是否存在、是否后来出现、节点连续性、占位节点数及下方商品每帧位移；现行规则不预期优惠骨架或空壳收起动画。

仅运行服务端与保护检查（不打开浏览器）：

```sh
node --test packages/storefront/e2e/loading-experience/preview-server.spec.mjs
```

构建由主任务统一执行，构建通过后才启动本地服务并用 CUA 验收；完成后关闭本次服务。最终人工报告归原仓库的 `docs/local-validation/soft-loading-release-20261028/`，与旧候选证据分开记录。
