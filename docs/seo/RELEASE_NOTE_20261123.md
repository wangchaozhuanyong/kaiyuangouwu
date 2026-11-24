# 发布说明 + URL（slug）变更方案 2026-11-23

## 一、本次代码改动（已提交到工作区，未发布）

| 文件 | 改动 | 影响面 |
| --- | --- | --- |
| `packages/storefront-content-plugin/src/shared/guide-body.tsx` | 新增受限 Markdown 渲染（H2/H3、段落、列表、表格、分隔线、加粗、站内/站外链接），纯文本解析，不执行作者 HTML | 全部店铺的 `/guides/{slug}` |
| `packages/storefront-content-plugin/src/shared/guide-body.css` | 新增，仅用 `--type-*` / `--font-weight-*` / `--line-*` token | 同上 |
| `packages/storefront-content-plugin/src/shared/guide-body.spec.ts` | 新增 7 条解析用例 | — |
| `packages/storefront/src/pages/guide-page.tsx` | 正文从纯文本改为 `GuideBody` | 同上 |
| `packages/storefront/src/storefront-ui/category-intro.tsx` | 新增分类正文块，读分类描述，`textOnly` 白名单清洗，空描述返回 `null` | 全部店铺的分类页 |
| `packages/storefront/src/styles/category-intro.css` | 新增，`--type-reading-*`，72ch 限宽 | 同上 |
| `packages/storefront/src/pages/category-page.tsx` | 一处插入：分类排序栏之后、商品列表之前 | 同上 |
| `packages/storefront/src/storefront-ui/category-intro.spec.tsx` | 新增 8 条用例 | — |
| `packages/store-management-plugin/src/seo/storefront-seo-output.ts` | hreflang 增加 `x-default`（指向中文页；仅中文时指向自身），契约里本来已允许该值但从未输出 | 全部店铺的所有公开页 |
| `packages/store-management-plugin/src/seo/storefront-public-seo.service.ts` | Product 结构化数据补 `brand`（店铺品牌）与 `inLanguage` | 全部店铺的商品页 |
| `.../seo/storefront-seo-output.spec.ts`、`.../storefront-seo-public-integration.spec.ts` | 同步 `alternates` 断言（新增 x-default） | — |
| `packages/dev-server/scripts/seo-index-now.mjs` | 新增 IndexNow 提交工具（默认 dry-run，`--apply` 才发送），读 `/sitemap.xml` → 收集子 sitemap → 过滤私有路径 → 分批推送 → 写回执 | 全部店铺通用 |
| `packages/dev-server/scripts/seo-index-now.spec.mjs` | 新增 8 条用例（解析、过滤、去重、分批、载荷） | — |
| `packages/dev-server/package.json` | 新增 `seo:indexnow` 脚本入口 | — |
| `packages/store-management-plugin/src/seo/storefront-seo.controller.ts` | sitemap 响应改为可按共享缓存保存（`s-maxage=600` + `stale-while-revalidate`），并加进程内 5 分钟生成缓存（按 channel + host + kind + shard，上限 64 条） | 全部店铺的 sitemap |
| `packages/store-management-plugin/src/seo/storefront-seo.controller.spec.ts` | 新增用例：重复抓取复用生成的 sitemap、不同 shard 不串用 | — |
| `deploy/nginx/damatong.conf` | 三个 sitemap location 统一输出 `Cache-Control: public, max-age=300, s-maxage=600, stale-while-revalidate=3600`，并隐藏后端原值 | 全部店铺 |
| `deploy/nginx/damatong.conf` | 新增 `$storefront_public_pref_cookie`、`$storefront_html_cache_control` 两个 map；公开 HTML location 改用变量，仅在无语言/币种 cookie 且非 iOS COOP 例外时允许共享缓存 | 全部店铺的公开页 |
| `deploy/nginx/damatong.conf` | 新增 `$vendure_crawler_class` map，访问日志增加 `crawler` 字段（只落类别，不落 UA） | 访问日志格式 |
| `deploy/nginx/storefront-fallback.spec.mjs` | 同步 harness：新增两个 map、按 cookie/UA 分别断言缓存值，并新增「有偏好 cookie 时保持 no-store」用例 | — |
| `packages/dev-server/scripts/seo-crawl-report.mjs` + `.spec.mjs` | 新增抓取报告工具（解析 JSON 访问日志、按爬虫聚合状态与路径）与 6 条用例 | 全部店铺 |
| `packages/dev-server/scripts/seo-gsc-report.mjs` + `.spec.mjs` | 新增 GSC 周报工具（服务账号 JWT、只读 webmasters scope）与 7 条用例 | 需运营凭据 |

### T1 阶段一：slug URL 可访问（canonical 未切换）

| 文件 | 改动 |
| --- | --- |
| `packages/store-management-plugin/src/seo/storefront-public-seo.service.ts` | 新增 `productIdBySlug` / `collectionIdBySlug`（按 Channel 过滤、跳过停用与私有记录） |
| `packages/store-management-plugin/src/seo/storefront-seo.controller.ts` | 新增 `publicSlugTarget`；`/p/{slug}`、`/c/{slug}` 先解析成 id 再走原有渲染管线；解析不到直接 404 |
| `packages/storefront/src/public-slug-url.ts` + `.spec.ts` | 客户端用内嵌快照把 slug URL 换回 `?id=` 形式（含子分类递归查找、编码解码），5 条用例 |
| `packages/storefront/src/public-page-bootstrap.ts` | 水合前调用上面的转换，再解析请求；快照不匹配时保持原 URL 走 404 |
| `deploy/nginx/damatong.conf` | 公开 HTML location 正则增加 `p/[^/?#]+`、`c/[^/?#]+` |
| `deploy/nginx/storefront-fallback.spec.mjs` | harness 的 location 标签同步 |

**本阶段刻意不做的事**：canonical、hreflang、sitemap 仍输出 `?id=`。slug URL 只是「可访问」，还没有任何地方指向它，因此对现有索引零影响。

阶段二（切 canonical + sitemap + 旧 URL 301）必须在线上确认 `/zh/p/{slug}` 返回 200、且用户从搜索结果进入后地址栏被客户端换回 `?id=` 且页面正常后再做。

### T1 阶段二：canonical / sitemap 已切（代码完成）

| 文件 | 改动 |
| --- | --- |
| `storefront-seo-output.ts` | `PublicSeoFacts` 新增 `canonicalPath`；canonical、hreflang、x-default 统一以它为路径 |
| `storefront-public-seo.service.ts` | `enrich()` 在商品分支写 `/p/{slug}`、分类分支写 `/c/{slug}`；Product 的 `Offer.url` 同步改用 slug；商品与分类 sitemap 条目优先输出 slug URL |
| `storefront-seo-output.spec.ts` | 新增「slug 优先于 id 路由」用例（canonical + 三条 hreflang） |
| `storefront-public-seo.service.ts` | 新增 `entityCanonicalPath`（slug → `/p/`、`/c/` 的唯一规则）与 `relatedGuideLinks`（相关指南挑选）；指南页数据新增 `relatedGuides` |
| `packages/storefront-content-plugin/src/shared/public-seo.ts` | `PublicGuideContent` 增加可选 `relatedGuides`（老部署缺省） |
| `packages/storefront/src/pages/guide-page.tsx` | 指南页尾部渲染「相关指南」区块（站内链接，跟随语言前缀） |
| `storefront-public-seo.canonical-path.spec.ts`、`storefront-public-seo.guides.spec.ts` | 新增 3 + 4 条用例 |
| `packages/storefront-content-plugin/src/shared/collection-faq.ts` + `.spec.ts` | 新增分类描述 FAQ 解析器（`## 常见问题` / `## FAQ` + `### 问题` + 答案），7 条用例 |
| `packages/storefront/src/storefront-ui/category-intro.tsx` + `styles/category-intro.css` | 分类说明拆成「正文 + FAQ 列表」，FAQ 用 `dl/dt/dd` 渲染 |
| `storefront-public-seo.service.ts` | 分类页输出 `FAQPage` 结构化数据，与页面共用同一解析器 |
| `category-intro.spec.tsx` | 新增 4 条 FAQ 渲染与转义用例 |

**回退规则**：实体没有 slug 时自动回落到 `?id=` / `?collectionId=`，所以未配置 slug 的店铺行为不变。

**未做 301**：`/zh/product?id=…` 与 `/zh/category?collectionId=…` 继续返回 200，由 canonical 收口。这与计划里「保留 6 个月双 URL 并存期」一致；等新 URL 索引稳定后再评估是否 301。

**覆盖说明**：该切换由纯单元用例覆盖（`storefront-seo-output.spec.ts`）；SQL 集成夹具里的 `Product` 无法写入 `slug`（`save` 后读回为 undefined、`update` 直接报错），所以没有为它加集成用例，改为发布后线上核对。

### 已验证

| 检查 | 结果 |
| --- | --- |
| `guide-body.spec.ts` | 7 通过 |
| `storefront-content-plugin` 全量 vitest | 25 文件 / 239 通过 |
| `category-intro.spec.tsx` | 8 通过 |
| `catalog-route-pages.spec.tsx` | 28 通过 |
| `public-snapshot.spec.tsx` + `hydration-ssr-parity.spec.tsx` | 73 通过 |
| `check:typography` | 通过（504 文件 / 93 token），EXIT=0 |
| `check:interaction` | 通过，EXIT=0 |
| `storefront-content-plugin` `check-types` | 仅 1 条**既有**报错 `storefront-content.service.spec.ts:116`（本次未触碰），其余干净 |
| `storefront-seo-output.spec.ts` | 32 通过（含 x-default 新断言） |
| `storefront-public-seo.service.spec.ts` | 31 通过（含 Product `brand`/`inLanguage`） |
| `storefront-seo-html-artifact.spec.ts` | 34 通过（20 跳过） |
| `storefront-seo-public-integration.spec.ts` | 37 通过（构建全部本地插件后运行；此前失败原因是工作区包 `dist` 缺失，非代码问题） |
| `seo-index-now.spec.mjs`（`node --test`） | 8 通过 |
| `storefront-seo.controller.spec.ts` | 68 通过（含 sitemap 缓存复用、按 shard 隔离） |
| `deployment-security.spec.mjs` 的 Nginx 路由断言 | 通过（含 `location = /sitemap.xml` 形状） |
| `nginx-release.spec.mjs`、`nginx/storefront-fallback.spec.mjs` | **本机不可运行**：需要 `bash` 与 unix socket 的本地 Docker（真实 nginx 容器）。必须在发布主机或 Linux CI 上执行；HTML 缓存 map 与 harness 断言只能在那一层被真正验证 |
| `seo-crawl-report.spec.mjs`、`seo-gsc-report.spec.mjs` | 6 + 7 通过（`node --test`） |
| `storefront-seo.controller.spec.ts`（含 slug 解析与渲染） | 79 通过 |
| `storefront-seo-public-integration.spec.ts` | 37 通过 |
| `public-slug-url.spec.ts` | 5 通过 |
| `public-snapshot.spec.tsx` + `hydration-ssr-parity.spec.tsx` | 73 通过 |
| `store-management-plugin` `tsc` 构建 | 通过 |
| `src/seo` 全量套件 | **241 通过 / 21 跳过**（12 个文件） |
| `collection-faq.spec.ts` | 7 通过 |
| `category-intro.spec.tsx` | 12 通过（含 FAQ 渲染、英文标题、脚本转义） |
| `check:typography` / `check:interaction` | 通过（506 文件 / 93 token） |
| `public-snapshot.spec.tsx`（指南渲染路径） | 66 通过 |
| IndexNow 实网 dry-run（`https://moyaoai.com`） | 发现 311 个公开 URL，选中 311，用时 31 秒，EXIT=0 |

### IndexNow 推送（发布后执行）

```bash
# 只读预演：读 sitemap、过滤私有路径、打印计划，不发送任何请求
cd packages/dev-server
bun run seo:indexnow -- --host https://moyaoai.com

# 真正提交（密钥文件随前端产物发布后可用）
INDEXNOW_KEY=fdc4b2ba72100dfba93a90f5df200225 bun run seo:indexnow -- --host https://moyaoai.com --apply
```

- 只推新内容时加过滤：`--include '/guides/'`。
- 每次运行写回执到 `tmp/seo-index-now/<时间戳>-<runId>.json`（含 URL 清单与每批状态码）。
- 前置条件：`https://<域名>/fdc4b2ba72100dfba93a90f5df200225.txt` 必须返回密钥本身。发布后先验证这个地址再 `--apply`。
- Google 不读 IndexNow，仍以 `/sitemap.xml` 为准；Bing、Yandex、Naver、Seznam 通常在数分钟内抓取。
- 站点当前的 `sitemap-pages.xml` 生成偏慢（实测 30–90 秒），脚本已内置 60 秒超时 + 1 次重试；若持续超时，优先排查 sitemap 生成缓存，而不是调大超时。

### 发布后核对（slug）

1. `curl -sI https://moyaoai.com/zh/p/<真实slug> | head -1` → `200`，无 301/302。
2. 同一 URL 在浏览器打开：内容正常，且控制台执行前地址栏已变成 `/zh/product?id=…`。
3. 查看该页源码：`<link rel="canonical">` 指向 `/zh/p/<slug>`，三条 `hreflang` 都带 `/p/`。
4. 不存在的 slug → `404`。
5. `/sitemap-products-0.xml` 里的商品 URL 已变成 `/zh/p/{slug}`。
6. 以上全部成立后，在 GSC 重新提交 `/sitemap.xml`。

### 发布步骤

1. 前端 lane 发布（`packages/storefront` 构建产物，走既有 Production Release 前端路径，不重建后端）。
2. 发布后验收：
   - `/zh/guides/{任一已发布 slug}`：价格表以 `<table>` 渲染，H2 分层正常，无横向溢出（窄屏应可横向滚动）。
   - `/zh/category?collectionId=2`：商品列表上方出现分类说明；分类描述为空时不出现空白块。
   - 抓一份页面源码，确认正文文本在 HTML 里（SSR），不是水合后才出现。
3. 回滚：切回上一份不可变静态产物；本次无数据库、无后端、无配置变更，回滚即恢复。

### 注意

指南的表格渲染与分类正文都依赖这次前端发布。**先发版，再在后台填内容**，否则后台看起来"没生效"。

---

## 二、URL（slug）变更方案：数据已生成，代码未动

### 2.1 为什么拆成独立变更集

现网商品/分类 URL 是 `/zh/product?id=6257`、`/zh/category?collectionId=2`。改成 `/zh/p/{slug}`、`/zh/c/{slug}` 需要同时改：请求契约、客户端路由、SSR 解析、canonical、sitemap、nginx 正则、301 引擎，并同步 6 个测试套件（快照一致性、hydration parity、LCP 预加载、sitemap 分片、路由重写、SEO 输出）。这不是"顺手改一下"，必须单独评审、单独灰度。

### 2.2 已产出

- [SLUG_MIGRATION_20261123.csv](SLUG_MIGRATION_20261123.csv)：49 条（8 分类 + 41 商品），字段为 `kind,id,name,current_slug,proposed_slug,old_url,new_url`，全部校验：唯一、仅 `[a-z0-9-]`、无重复。

现网 slug 的问题（本次一并修）：

| 现状 | 问题 | 建议 |
| --- | --- | --- |
| `gpt订阅`（分类 2） | 与名称「Codex订阅」不一致，会被百分号编码 | `codex-subscription` |
| `中专站充值`（分类 15） | **错别字**（应为"中转"） | `api-credit-topup` |
| `grok订阅-2`（分类 39） | `-2` 后缀是历史冲突残留 | `grok-subscription` |
| `id`（商品 6301） | 无语义 | `apple-id-custom` |
| `gmail-6`（商品 6285） | 无语义 | `gmail-6months` |
| `codexchatgpt-go订阅代充1个月` | 中英混排、超长、被编码 | `codex-go-1month` |
| 其余商品 slug | 中文 / 数字编码混排 | 统一英文 kebab（见 CSV） |

### 2.3 代码变更清单

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/storefront-content-plugin/src/shared/public-page-data.ts` | `PublicPageRequest` 的 product 变体加可选 `slug`；`publicPageRequestFromUrl` 解析 `/p/{slug}`、`/c/{slug}`；`publicPageRouteHref` 在有 slug 时输出 slug URL；`publicPageRequestKey` 仍以 id 为键（缓存键不变） |
| 2 | `packages/storefront/src/storefront-router.ts` + `src/routes/` | 新增 `p.$slug.tsx`、`c.$slug.tsx` 两个薄壳路由，复用现有页面组件；`storefrontRouteNames`、`desktopPageFamilyByRoute` 同步登记 |
| 3 | `packages/store-management-plugin/src/storefront-public-page.service.ts` | 入口解析 slug → id（Product/Collection 各一次查询），之后沿用现有 id 流程 |
| 4 | `.../seo/storefront-public-seo.service.ts` | canonical、hreflang、JSON-LD `url`、sitemap 条目改用 slug URL |
| 5 | `.../seo/storefront-seo.controller.ts` | `/storefront/html`：带 `id`/`collectionId` 的请求 301 到 slug URL（复用现有 redirect 校验，保留非身份参数） |
| 6 | `deploy/nginx/damatong.conf:636` | location 正则增加 `p/[a-z0-9-]+`、`c/[a-z0-9-]+` |
| 7 | 测试 | `public-page-data.spec.ts` 增加 slug round-trip；`hydration-ssr-parity` 增加 slug 场景；`storefront-seo-public-integration.spec.ts` 断言新 URL 形状 |

### 2.4 执行顺序（建议）

1. **先在后台改 slug**（用 CSV 的 `proposed_slug`）。当前 URL 是 id 驱动，改 slug 不影响现网链接与排名。
2. 在预发部署代码变更，跑 49 条 301 全量映射：每条旧 URL 返回 301，`Location` 与 CSV 的 `new_url` 完全一致。
3. 灰度一个分类上线（7 天），确认 Googlebot 抓取、canonical、sitemap 正常。
4. 全量上线，重新提交 `/sitemap.xml`，观察 30 天索引迁移。
5. 旧 `?id=` URL 保留 6 个月 301，之后可继续保留（无成本）。

### 2.5 回滚

- 代码：切回上一份前端产物；301 规则随代码回滚一并撤销。
- 数据：后台把 slug 改回原值（CSV 的 `current_slug`）。
- 不涉及后端与数据库，回滚窗口 < 10 分钟。

---

## 三、当前待办（按依赖排序）

| 顺序 | 事项 | 谁做 | 依赖 |
| --- | --- | --- | --- |
| 1 | 前端发布本次代码 | 发布流程 | 本文件第一节 |
| 2 | 后台填 8 个分类描述 + SEO 记录 | 运营 | 第 1 步完成 |
| 3 | 后台发布 3 篇指南 | 运营（需真实审核人） | 第 1 步完成 |
| 4 | 后台改 49 条 slug | 运营 | 无（可提前做） |
| 5 | slug 代码变更集开发 + 预发 301 全量验证 | 开发 | 第 4 步完成 |
| 6 | GSC / Bing 提交、IndexNow | 运营 | 第 2–3 步完成 |
