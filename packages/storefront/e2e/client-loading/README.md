# 客户端加载本地验收

此服务只读取当前 storefront `dist/` 和仓库内的合成 fixture，复用共享 canonical page / MediaDescriptor 代码。无生产代理、数据库、登录态和真实客户数据；业务写入、GraphQL mutation / subscription 全部拒绝。它用于验证加载时序与界面状态，不能代表生产网络或业务性能。

在仓库工作区运行（Node 22.18+，本机 Node 24 已验证）：

```sh
node packages/storefront/e2e/client-loading/preview-server.mjs --port=5197
node --test packages/storefront/e2e/client-loading/preview-server.spec.mjs
```

先由集成负责人完成 storefront 生产构建。服务不会自行构建或覆盖 `dist`，每个请求重新读取静态文件，后续构建无需重启。入口是 `http://127.0.0.1:5197`，只监听本机。

| 参数                              | 用途                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `qaSsi=hot` / `cold`              | 匹配路由的快照和 preload / 无快照冷启动，默认 cold         |
| `qaDelay=1200`                    | 公共聚合与只读 GraphQL 延迟，最多 10 秒                    |
| `qaImageDelay=2000`               | 图片延迟，最多 30 秒                                       |
| `qaEmpty=1`                       | 成功的空商品列表                                           |
| `qaLegacy=1`                      | aggregate 返回 404，验证旧 GraphQL 回退                    |
| `qaPreset=classic`                | 使用 classic 皮肤，默认 neo-minimalist                     |
| `qaAccessMode=PREVIEW` / `CLOSED` | 合成公开预览／拒绝状态，默认 LIVE；非 LIVE 不提供 SSI 快照 |

参数可放在页面 URL（后续请求通过 Referer 继承），或作为 CLI 参数固定整个会话，例如 `--qaDelay=1200 --qaSsi=cold`。SPA 跳转可能清除 URL 参数；需要持续模拟慢网时使用 CLI 参数。浏览器网络限速可另外叠加。

可用路由：

- `/category?collectionId=collection-daily&childId=collection-cups`：12 件商品。
- `/category?collectionId=collection-daily&childId=collection-other`：另外 12 件商品。
- `/category?collectionId=collection-daily&childId=collection-empty`：成功空分类。
- `/category`：24 件商品，默认每页 12 件。
- `/product?id=product-1`：商品详情。
- `/__qa/requests`：最近 1,000 条页面、聚合、只读 GraphQL、图片请求记录，不含凭据。
- `/__qa/health`：本地 dist 与模式信息。

图片使用已有合成 SVG 生成真实 WebP，尺寸有上限，响应浏览器 TTL 为 300 秒。SSE 返回 ready 和心跳，不产生业务变更；事件失效竞争由前端定向测试覆盖。浏览器访问前应清理该本地站点的旧 sessionStorage，或使用独立浏览器上下文，以免不同测试间复用已加载结果。
