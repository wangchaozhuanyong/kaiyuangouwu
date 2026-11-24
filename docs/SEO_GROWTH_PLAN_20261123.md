# MOYAO AI 谷歌自然流量 90 天作战方案

日期：2026-11-23
目标站点：`https://moyaoai.com/`（中文 `/zh/`，英文 `/en/`）
商品结构：41 个在售商品 / 8 个分类（Codex、Claude、Gemini、Grok、苹果ID、谷歌账号、GPT成品、中转站充值）
目标：4-8 周出现品类词排名，90 天 2-3 个品类词进前 10，且所有高风险动作不影响主域长期安全。

---

## 已完成（2026-11-23）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 指南正文渲染 | ✅ 已实现 | `/guides/{slug}` 原来把后台 Markdown 当纯文本输出，现在由共享 `GuideBody` 渲染标题、列表、**价格表格**与站内链接；纯文本解析，不注入任何作者 HTML |
| 指南渲染测试 | ✅ 通过 | 解析器 7 条用例；`storefront-content-plugin` 全量 239 条通过；`public-snapshot` 75 条通过 |
| 类型与门禁 | ✅ 通过 | `check:typography`（502 文件 / 93 token）、`check:interaction` 均通过 |
| 后台发布内容包 | ✅ 已备好 | [SEO_CONTENT_PACK_20261123.md](SEO_CONTENT_PACK_20261123.md)：8 个分类 × 中英 SEO 记录 + 3 篇指南全文（含真实价格表） |
| JSON-LD 重复 | ❌ 误报 | 已复核，线上只有 3 个块，嵌套 `@type` 不是重复 |
| URL slug 改造 | ⏸ 延后 | 会改动 `PublicPageRequest` 契约，波及 SSR 快照一致性、hydration、LCP 预加载与 6 个测试套件；收益（URL 关键词）远小于风险，需单独变更集 |
| 分类页说明正文 | ✅ 已实现 | 分类自身的描述现在渲染成商品列表上方的正文块（共享 `CategoryIntro`，不按店铺分支）；8 个分类的中英说明已写进内容包，后台替换即可 |
| 分类页 FAQ | ✅ 已实现 | 分类描述里的 `## 常见问题` 区块 → 页面问答列表 + `FAQPage` 结构化数据，两者共用 `parseCollectionDescription`；FAQ 文案见内容包第四之二节 |
| sitemap 缓存 | ✅ 已实现 | 生成结果进程内缓存 5 分钟（按 channel+host+kind+shard），响应头 `s-maxage=600, stale-while-revalidate=3600`；实测生成耗时 30–90s 的问题不再影响每次抓取 |
| HTML 共享缓存 | ✅ 已实现 | 无语言/币种 cookie 且非 iOS COOP 例外的公开文档给 `s-maxage=300`，其余保持 `no-store`；nginx map + 隐藏后端原值，harness 同步 |
| 抓取监控 | ✅ 已实现 | nginx 日志新增 `crawler` 类别字段（不落 UA），`seo-crawl-report.mjs` 出周报 |
| GSC 周报 | ✅ 已实现 | `seo-gsc-report.mjs`（服务账号 JWT，只读 webmasters scope），需运营提供凭据 |
| slug URL（T1） | ✅ 代码完成 | `/p/{slug}`、`/c/{slug}` 可渲染；canonical/hreflang/JSON-LD/sitemap 已用 slug；`?id=` 保留 200 别名 |
| slug 规范化（T2） | ⏸ 待后台执行 | 49 条映射已备：`docs/seo/SLUG_MIGRATION_20261123.csv` |
| 首批 8 篇指南（W1-2） | ✅ 已备 | 内容包第三、三之二节：Codex、Claude、API 中转、Google AI Pro 付法、Ultra 5x/20x、Grok 三档、美区 Apple ID、中转 vs 官方 |
| 博客整治清单（5.2） | ✅ 已备 | `docs/seo/BLOG_CLEANUP_20261123.csv`：43 篇与商品无关的开发工具文（skill-*、vercel-* 等）待后台取消发布；**不能走 301**——SEO 重定向的 `from` 白名单不含 `/blog/`，见 `storefront-seo.validation.ts` |
| 指南互链（T7） | ✅ 已实现 | 每篇指南尾部渲染「相关指南」：同语言、已发布、最多 3 条，由 `relatedGuideLinks` 统一挑选 |

## 0. 结论先行

1. **你的技术底子已经比同行的 90% 好**：服务端直出 HTML、sitemap 分片、canonical、hreflang、JSON-LD、后台可配 301、robots 分 UA。问题不在"能不能被收录"，而在"页面能不能打赢关键词"。
2. **最大单点损失是 URL**：`/zh/product?id=6257`、`/zh/category?collectionId=2` 这种参数 URL 没有关键词、外链不可读、ID 一换排名归零。这是必须先改的 P0。
3. **第二大损失是内容错配**：博客已发 100+ 篇，绝大多数是"OpenAI 建数据中心""vercel 最佳实践"这类与商品零关系的新闻，正文约 1.2k 字，商品内链为 0。真正的商业落地页路由（`/guides/{slug}`）在代码里已经存在，但**一篇文章都没有**。
4. **这个类目的自然搜索是可以打的**：竞品用"价格对比表 + 实测数据"就能拿到排名（例：[明价 AI 的 ChatGPT Plus 代充 56 家店报价对比](https://www.aipickguides.com/guides/chatgpt-plus-recharge-price/)、[GPTHubs 代充价目页](https://gpthubs.net/recharge)）。竞争页面质量低，内容门槛不高。
5. **"快 + 稳"的实现方式只有一个：风险外置**。主域只做白帽；灰黑手法全部放在可丢弃的卫星域和第三方寄生页上，用"两跳"结构让链路永远不直接指向主站。主站被牵连的概率接近 0，卫星站被清掉也只是丢几条外链。

---

## 1. 现场审计（实测数据）

### 1.1 已经具备（不用重做）

| 能力 | 现状 | 价值 |
| --- | --- | --- |
| SSR 直出 | 后端 `/storefront/html` 注入完整 body 到 `#root`，带 `data-public-rendered` | 抓取友好，不依赖 Google 渲染 JS |
| sitemap | `/sitemap.xml` 索引 + `sitemap-pages.xml`(213 URL) / `sitemap-products-0.xml`(82) / `sitemap-collections-0.xml`(16) | 结构正确，分片机制到位 |
| robots | 分 UA 输出；已屏蔽 `/shop-api`、`/admin-api`、`/promo/*`；允许 OAI-SearchBot、PerplexityBot；屏蔽 GPTBot、ClaudeBot、Google-Extended | 基础卫生合格 |
| canonical / hreflang | 每页输出，zh-CN + en 双向 | 已消除大部分重复内容 |
| JSON-LD | WebSite、Organization、Product+Offer、BreadcrumbList、BlogPosting | 富结果基础已有 |
| 后台 SEO 覆盖 | `HOME / PRODUCT / COLLECTION / PAGE / ARTICLE` 五类目标可单独写标题描述 | 可做批量精细化 |
| 301 引擎 | `settings.redirects` 支持 `from → to` 301（含 UTM 参数剥离） | URL 迁移有现成能力 |
| 落地页路由 | `/zh/guides/{slug}` 已在 nginx、路由表、SEO 校验中实现 | **空置资产，最快见效** |

### 1.2 阻断项（按杀伤力排序）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P0-1 | 商品/分类 URL 是查询参数 | sitemap 内全部为 `/zh/product?id=4`、`/zh/category?collectionId=2` | 无关键词权重、锚文本难写、ID 变更即失分、SERP 点击率低 |
| P0-2 | 商业落地页为零 | `sitemap-pages.xml` 中 0 个 `/guides/` URL；仅有新闻类 `/blog/` | 品类词、长尾词无承接页 |
| P0-3 | 博客主题稀释 | 100+ 篇中大量 `skill-*`、`vercel-*`、`lark-*`、`OpenAI 数据中心` 等非商品内容 | 站点主题相关性被稀释，商业页权重被摊薄 |
| P0-4 | 内链断裂 | 抽查文章页：指向商品的内链 = 0，站内链接 13 条多为导航 | 权重无法从内容页流向成交页 |
| P0-5 | 分类页内容过薄 | `/zh/category?collectionId=2` H1 仅「Codex订阅」，无正文、无价格对比、无 FAQ | 无法竞争「Codex 订阅」这类词 |
| P0-6 | 商品结构化数据被污染 | `Product.description` 塞入 ~1000 字售后/风控长文；缺 `brand`、`category`、`priceValidUntil` | 富结果质量低，且与页面主描述不一致 |
| ~~P1-1~~ | ~~JSON-LD 重复输出~~ | 复核后为误报：文章页只有 3 个 `ld+json` 块，`Organization/WebSite` 是 Product、BlogPosting 里的嵌套引用 | 无问题，不需要改 |
| P1-2 | 缺 `x-default` | 只有 zh-CN / en | 多语言信号不完整 |
| P1-3 | 品牌词被同名实体抢占 | 「MoYa」是另一家机器人的品牌（百度百科已有词条） | 品牌 SERP 需要主动占位 |
| P1-4 | 间歇性慢响应 | 社区有 `moyaoai.com` 524 / 33s HTML 报告；实测 HTML 461KB，首包 0.5-1.8s，`Cache-Control: no-store` | 抓取预算被吃掉，收录速度变慢 |
| P1-5 | AI 爬虫策略保守 | `GPTBot` / `ClaudeBot` 被 Disallow | 放弃 ChatGPT / Claude 侧的引用曝光（可选决策） |

### 1.3 评分

| 维度 | 得分 | 说明 |
| --- | --- | --- |
| 技术 SEO | 7 / 10 | 骨架好，URL 与缓存是硬伤 |
| 内容资产 | 3 / 10 | 有量无质，与商品脱节 |
| 站外权威 | 1 / 10 | 基本为零 |
| 品牌资产 | 3 / 10 | 有品牌名，无品牌 SERP 控制权 |

---

## 2. 打法总纲：三层隔离 + 双轨内容

### 2.1 三层资产结构（核心风控设计）

| 层级 | 资产 | 允许的手法 | 被罚影响半径 | 是否可撤销 |
| --- | --- | --- | --- | --- |
| **L0 主站** | `moyaoai.com`（及 `damatong.net`） | 只做白帽：技术修复、落地页、内容集群、内链、结构化数据、真实测评、目录提交、PR | 全盘（必须为零） | — |
| **L1 卫星站** | 5-8 个独立域名（AI 工具测评 / API 价格 / 账号指南） | 灰帽 + 部分黑帽：过期域 301、PBN 承接、AI 批量页、cloaking 实验、CTR 操纵 | 只损失该卫星站 | 可 offline / 转 nofollow / 删链 |
| **L2 寄生页** | 知乎、小红书、Medium、Reddit、GitHub、Notion、Google Sites、AI 导航站 | 全部无风险：软文、回答、仓库 README、公开笔记 | 单篇被删 | 天然可弃 |

**铁律：**

1. PBN、买链、批量 AI 页**永远不直连主站**，只连 L1；L1 再以低频品牌锚连主站（两跳）。
2. 主站每月新增外链 ≤ 15 条，锚文本分布：品牌/裸链 60%、长尾 30%、精确匹配 ≤ 10%。
3. 主站与卫星站不共用 Cloudflare 账号、GSC 账号、邮箱、IP、模板、GA 属性。
4. 每条外链进台账，记录"可撤销方式"；任一资产出事，24 小时内可摘除。

### 2.2 双轨内容

- **转化轨（guides / 分类页 / 商品页）**：承接品类词与长尾词，必须带价格表、适用人群、交付说明、FAQ、对比表。
- **资讯轨（blog）**：只保留与商品强相关的模型动态，每篇强制挂 1 个商品模块 + 2 条内链；其余历史文章合并或 301 到分类页。

---

## 3. 关键词与页面蓝图

### 3.1 词库分层

| 层级 | 示例词 | 承接页面 | 难度 | 周期 |
| --- | --- | --- | --- | --- |
| 品牌词 | 模钥、模钥AI、moyaoai、模钥官网、模钥靠谱吗 | 首页 + 品牌页 | 极低 | 1-2 周 |
| 品类词 | ChatGPT 代充、Codex 订阅、Claude Pro 代充、Gemini Pro 订阅、Grok 订阅、苹果ID 美区、谷歌账号购买、API 中转充值 | 8 个分类页 | 中 | 4-10 周 |
| 型号词 | Codex Go / Plus / Pro $100 / Pro $200、Claude Max 5x / 20x、Google AI Ultra 5x / 20x、Grok Super | 41 个商品页 | 低 | 3-6 周 |
| 长尾词 | ChatGPT Plus 代充多少钱、Claude Pro 和 Max 区别、Google AI Pro 年付划算吗、美区 Apple ID 余额怎么用、API 中转和官方 API 区别 | guides | 低 | 2-6 周 |
| 对比词 | 官方订阅 vs 代充、Poe 替代、中转 API 平台对比、淘宝代充 vs 专业站 | guides（对比模板） | 中 | 6-10 周 |
| 英文词 | chatgpt plus subscription reseller、buy claude pro account、openai api credit reseller、gemini ai pro subscription | `/en/` 镜像页 | 中 | 6-12 周 |
| 防御词 | 模钥 是骗局吗、moyaoai 退款、模钥 账号被封 | 品牌防御页（自己先写） | 极低 | 1 周 |

### 3.2 页面矩阵（建议第一批 26 个 guides）

**价格/对比类（最容易起量，直接对标竞品）**

1. `chatgpt-plus-daichong-jiage` — ChatGPT Plus 代充价格全表（含官方价对照、汇率、到账时间）
2. `codex-dingyue-jiage-duibi` — Codex Go/Plus/Pro 三档价格与额度对比
3. `claude-pro-max-quibie` — Claude Pro / Max 5x / Max 20x 区别与选购
4. `google-ai-pro-nianfu-huabuluai` — Google AI Pro 月付 vs 年付测算
5. `gemini-ultra-5x-20x-duibi` — Gemini Ultra 5x / 20x 额度实测
6. `grok-dingyue-duibi` — Grok Plus / Super / Premium 对比
7. `api-zhongzhuan-jiage-biao` — API 中转站充值档位与官方价换算
8. `meiqu-apple-id-yue-zenmeyong` — 美区 Apple ID 余额使用与充值路径

**教程/决策类（承接"怎么用/值不值"）**

9. `chatgpt-plus-zenme-chongzhi` — 代充流程与到账时间（含风险提示）
10. `codex-shi-shenme` — Codex 是什么、和 ChatGPT 订阅的关系
11. `claude-code-gongzuoliu` — Claude Code 工作流与订阅选择
12. `gpt-chengpinhao-fengxian` — 成品号与自充的差异、封号风险说明
13. `guge-zhanghao-goumai-zhuyi` — 谷歌账号购买注意事项与养号
14. `api-zhongzhuan-vs-guanfang` — 中转 API 与官方 API 的技术差异（延迟/额度/限流）
15. `haiwai-mac-zuyong-claude` — 海外 Mac 远程环境适用场景

**对比/替代类（抢竞品流量）**

16. `poe-tidai` — Poe 替代方案对比
17. `chatgpt-jingxiangzhan-duibi` — 镜像站 vs 官方 vs 代充
18. `ai-huiyuan-hezu-fengxian` — 合租账号的风险与识别

**品牌与信任类（必须自己占位）**

19. `moyao-ai-shi-shenme` — 模钥 AI 是什么、服务边界
20. `moyao-ai-kaopu-ma` — 交付、售后、退款政策说明（真实可核验）
21. `moyao-ai-fapiao-yu-shuiwu` — 发票与付款凭证
22. `moyao-ai-anquan-shuoming` — 账号安全与数据边界

**英文镜像（先做 12 个）**

23-34. `chatgpt-plus-subscription-price`、`claude-max-plans-compared`、`gemini-ai-pro-worth-it`、`grok-subscription-guide`、`openai-api-credit-reseller`、`buy-apple-id-us-balance` …（与中文页一一对应，不做机翻）

### 3.3 分类页改造（8 页）

每页固定结构：

```
H1（品类词，唯一）
├── 60-90 字导语（谁适合、交付方式、周期）
├── 价格表（3-6 档，含官方价对照）
├── 选购建议（3 条，指向具体商品）
├── FAQ × 6（带 FAQPage 结构化数据）
├── 相关指南 × 3（内链）
└── 商品列表（现有组件）
```

### 3.4 商品页改造（41 页）

- 标题模板：`{型号} 订阅代充 {周期}｜价格 {价}｜MOYAO AI`（保留现有关键词，降低堆砌）
- 正文 600-900 字：适用人群 → 交付流程 → 生效验证 → 限制与售后边界 → FAQ × 4
- JSON-LD：`description` 改用商品短描述（≤ 300 字），补 `brand`、`category`、`priceValidUntil`；有评价后启用 `aggregateRating`
- 页脚统一免责声明：**第三方代充服务，与 OpenAI / Anthropic / Google 无关联、无授权关系**（降低商标投诉与"误导性内容"判定风险）

---

## 4. P0 技术改造清单（按优先级）

| # | 改造 | 落点 | 验收 |
| --- | --- | --- | --- |
| T1 | **slug URL `/p/`、`/c/`** | ✅ **代码完成（阶段一+二）**：slug URL 可 200 渲染、客户端回退到 id 路由、canonical/hreflang/JSON-LD offer/sitemap 全部改用 slug；`?id=` 保留 200 别名（计划的"双 URL 并存期"），不设 301 | 发布后按发布说明逐条验证；`?id=` 靠 canonical 收口 |
| T2 | **slug 规范化**：现为 `codexchatgpt-go订阅代充1个月`、`中专站充值`（错别字） | 后台批量改写为 `codex-go-1month`、`api-recharge`，保留旧 slug 301 | 全站 slug 仅含 `a-z0-9-` |
| T3 | **缓存**：sitemap + HTML 均已完成 | `storefront-seo.controller.ts`、`deploy/nginx/damatong.conf` | sitemap 生成 5 分钟缓存 + `s-maxage=600`；HTML 仅在无语言/币种 cookie 且非 iOS COOP 例外时给 `s-maxage=300`，其余保持 `no-store` |
| T6 | **IndexNow + GSC 日报** | 均已完成：`seo-index-now.mjs`、`seo-gsc-report.mjs`（服务账号 JWT，需运营提供凭据） | IndexNow 实网 dry-run 311 URL / 31 秒；GSC 报告 7 条用例通过 |
| T7 | **内链**：✅ 完成 | 指南 → 相关商品（`relatedProductIds`）+ 相关指南（同语言已发布，最多 3 条）；博客 → 相关商品与相关文章 | 页面内商品与指南链接均已渲染，`relatedGuideLinks` 4 条用例 |
| T8 | **抓取监控**：已完成 | `seo-crawl-report.mjs` + nginx `crawler` 日志字段（只落爬虫类别，不落 UA） | 部署后对 `moyao-storefront-access.log` 运行即可出周报 |

> T1/T2 是唯一有迁移风险的动作：必须先在预发用真实快照跑一遍 301 映射，保留 6 个月双 URL 并存期，再逐步收紧。

---

## 5. 内容引擎（guides）

### 5.1 生产节奏

- 第 1-2 周：8 篇价格/对比类（客单价最高、竞争最低）
- 第 3-4 周：8 篇教程/决策类 + 8 个分类页重写
- 第 5-8 周：10 篇对比/替代/品牌防御 + 12 篇英文镜像
- 第 9-12 周：按 GSC 曝光数据补 20 篇"有展现无点击"的词

单篇标准：1200-2000 字、1 张数据表、1 个流程图/截图、4 条 FAQ、3 条内链、1 个商品模块。**AI 起草 + 人工加真实数据（价格、到账时长、实测延迟、退款案例）**，纯模板换词一律不做。

### 5.2 博客整治

| 类型 | 处理 |
| --- | --- |
| 与 ChatGPT/Claude/Gemini/Grok 直接相关（约 45 篇） | 保留，补商品模块 + 内链 |
| `skill-*` / `vercel-*` / `lark-*` / 通用工程文（约 35 篇） | 合并为 2 篇"AI 工具榜单"，其余 301 到对应分类页 |
| 纯新闻搬运（低信息量） | 停止日更，改周更 2 篇，只写"模型更新 → 对我们的商品/价格有什么影响" |

> 已产出待执行清单：[BLOG_CLEANUP_20261123.csv](seo/BLOG_CLEANUP_20261123.csv)，43 篇。落地方式是后台「取消发布」而不是 301：SEO 重定向的 `from` 白名单只允许 `/`、`/product`、`/category`、`/services`、`/support`、`/legal`、`/promo`、`/guides/*`，`/blog/*` 不在其中。

### 5.3 内链规则

```
商品页 → 所属分类 ×1 + 相关指南 ×2
指南页 → 商品 ×3 + 分类 ×1 + 指南 ×2
分类页 → 商品 ×5 + 指南 ×3
博客页 → 分类 ×1 + 商品 ×1（禁止超过 3 条，避免权重稀释）
```

---

## 6. 站外：白帽六招（先做，零风险）

1. **AI 目录站批量提交**（1 周内可完成 30+）：There's An AI For That、Futurepedia、Toolify、AI Tool Directory、TopAI.tools、SaaSworthy、Product Hunt（做一次 Launch）。
2. **寄生页矩阵**：知乎（"ChatGPT 代充怎么选"类问题）、小红书（价格对比图文）、Medium（英文长文）、Reddit（r/ChatGPT、r/ClaudeAI 的真实经验贴，不硬广）、GitHub（开源一个"AI 订阅价格对比 JSON"仓库，README 放数据表）、Notion / Google Sites 公开页。
3. **数据型内容外链**：做一份"AI 订阅官方价 vs 各渠道价"月度公开数据集，主动投稿给测评号、价格比较站——这是本类目最容易拿到自然外链的钩子（竞品已在用）。
4. **真实测评/开箱**：B 站、YouTube 短视频 + 文字版，标题带品牌词，导品牌搜索量。
5. **品牌 SERP 占位**：把"模钥 靠谱吗/是骗局吗/退款"这类词用自己的 FAQ、售后政策页占住，避免被第三方问答定义。
6. **PR/媒体**：面向出海/独立开发者媒体的"AI 订阅成本"数据稿，1 篇可换 5-15 条引用域。

---

## 7. 站外：灰黑八招 + 隔离规则

> 全部只作用于 L1 / L2，主站零接触。

| # | 手法 | 具体做法 | 风险 | 影响半径 |
| --- | --- | --- | --- | --- |
| G1 | **卫星站矩阵** | 5-8 个域名，主题分别为"AI 工具测评""API 价格对比""数字账号指南"；每站 20-30 篇真实可读内容；独立 CF 账号/IP/邮箱/模板 | 低 | 单站 |
| G2 | **两跳链接** | PBN/批量链 → 卫星站；卫星站 → 主站，每周 2-3 条，品牌锚为主 | 低 | 卫星站 |
| G3 | **过期域 301** | 采购同主题、archive 干净、有真实自然链的老域（$100-400），先做独立站养 60 天，再 301 到卫星站相关文章（不直连主站首页） | 中 | 该域 |
| G4 | **付费客座 / niche edit** | 每月 5-15 条，$50-300/条，锚文本按 60/30/10 分布，优先真实流量站 | 中 | 单条可删 |
| G5 | **AI 批量落地页（programmatic）** | 模型 × 周期 × 价格组合页，每页必须有真实差异数据（价格、额度、到账时长），差异度 ≥ 60% | 中 | 主站可控（属灰区白帽） |
| G6 | **CTR 操纵** | 仅对排 5-15 的词，真实设备 + 分散住宅 IP，每词每日 ≤ 20 次，持续 2-4 周即停 | 中高 | 不计入主站手法，用卫星站测试效果 |
| G7 | **Cloaking 实验** | 仅卫星站：给爬虫干净版、给用户转化版 | 高 | 卫星站 |
| G8 | **竞品词截流** | 做"{竞品} 替代/对比"页，标题不用对方商标做主语，不仿冒 UI | 低 | 主站（合规灰） |

**禁止事项（会导致不可逆损失）：**

- 入侵他人站点挂黑链（法律风险 + 不可控的"混合信誉"污染）→ 用 G4 付费位替代。
- 主站任何形式的 cloaking、隐藏文字、门页、自动翻译堆页。
- 一次性购买几百条论坛签名链（增速异常是最容易被识别的信号）。
- 与主站共用账号/IP 操作卫星站（一旦关联，隔离失效）。

---

## 8. 稳定性设计（"以后出问题也不影响主站"）

1. **台账**：`docs/seo/LINK_LEDGER.md`，字段：日期 / 来源资产 / 手法 / 目标 URL / 锚文本 / dofollow / 可撤销方式 / 复查日期。
2. **撤销预案**：预生成 `disavow.txt` 模板；卫星站保留"一键转 nofollow / 下线"开关；过期域保留 DNS 控制权。
3. **监控**：GSC 手动操作通知邮件 → 企业微信/Telegram 机器人；每周看三个数：索引量、品类词位置、外链增速。
4. **止损线**（触发即回滚）：
   - 收到 GSC 手动操作（任何类型）→ 24h 内摘除当周新增全部外链，提交复议。
   - 主站索引量 7 天内下降 > 30% → 暂停所有站外动作，只保留技术修复。
   - 品牌词跌出前 3 → 检查是否有负面/仿冒页，启动品牌防御内容。
5. **灰度**：URL 迁移、模板改版一律先 10% 流量或单分类灰度，观察 7 天。

---

## 9. 90 天执行日历

| 周 | 技术 | 内容 | 站外 | 周验收 |
| --- | --- | --- | --- | --- |
| W1 (11/24-11/30) | GSC 双域验证、sitemap 提交、IndexNow、T3 缓存、T4/T5 JSON-LD | 8 篇价格页上线（占位先发） | 30 个 AI 目录提交 | 收录 ≥ 60%，Rich Results 0 错误 |
| W2 | T1 slug 方案评审 + 预发验证 | 8 个分类页重写 | 知乎 3 篇 + 小红书 2 篇 | 分类页全部有正文/FAQ |
| W3 | T1 上线（灰度 1 个分类） | 8 篇教程页 | Medium 3 篇 + GitHub 数据仓库 | 301 无 404，canonical 正确 |
| W4 | T1 全量 + T7 内链 | 博客整治（35 篇合并/301） | 首批 niche edit 3 条 | 品牌词前 3，长尾 20 个进前 50 |
| W5-6 | T6 日报 + T8 监控 | 10 篇对比/品牌页 | 卫星站 1-2 号上线（各 15 篇） | 品类词 2 个进前 30 |
| W7-8 | 性能优化（LCP、图片） | 12 篇英文镜像 | 过期域 3 个采购 + 养站 | 自然点击 ≥ 200/日 |
| W9-10 | 结构化数据补 `ItemList`/`FAQPage` | 按 GSC 补 10 篇 | 卫星站 3-5 号 + 两跳投放启动 | 品类词 3 个进前 20 |
| W11-12 | 复盘 + 第二轮 URL 收紧 | 20 篇"高展现低点击"补写 | G4 累计 20 条，G6 小规模测试 | 品类词 2-3 个进前 10 |

**预期（不承诺 #1）：** 30 天收录 > 80%、品牌词第 1；60 天品类词进前 3 页；90 天 2-3 个品类词进前 10，自然流量 300-800/日量级，注册转化按现有落地页基线提升。

---

## 10. 预算（首季）

| 项目 | 数量 | 单价 | 小计 |
| --- | --- | --- | --- |
| guides 内容（AI 起草 + 人工数据） | 60 篇 | ¥150-400 | ¥9,000-24,000 |
| 英文镜像 | 12 篇 | ¥300 | ¥3,600 |
| 过期域 | 5 个 | $100-400 | ¥3,500-14,000 |
| 卫星站托管 + 域名 | 8 站 | $5-8/月 | ¥2,500 |
| 付费客座/niche edit | 20 条 | $100-300 | ¥14,000-42,000 |
| 工具（Ahrefs/Semrush + 代理） | 3 个月 | $150/月 | ¥3,200 |
| **合计** | | | **¥3.6-8.9 万** |

---

## 11. 主站红线清单（打印贴墙）

1. 不做 cloaking、隐藏文字、门页、参数页刷量。
2. 不用"官方 / 授权 / 合作 / 独家"等未经证实的背书。
3. 不做"保证不封号""永久有效"类承诺。
4. 不接受来源不明的大批量外链（发现即 disavow）。
5. 不在主站任何页面出现卫星站链接（单向，只进不出）。
6. 不同一账号/IP 同时登录主站与卫星站后台。
7. 所有 URL 变更必须配 301 + 6 个月并存期。

---

## 12. 本周就能做的三件事

1. 打开 GSC，验证 `moyaoai.com` 与 `www`，提交 `/sitemap.xml`，用 URL 检查工具手动提交首页 + 8 个分类页。
2. 把 8 个分类页的 SEO 标题/描述/正文/FAQ 填掉（后台已支持，无需发版）。
3. 发第一批 3 篇价格对比页（`chatgpt-plus-daichong-jiage`、`codex-dingyue-jiage-duibi`、`api-zhongzhuan-jiage-biao`），每篇带真实价格表 + 2 个商品内链。

> 这三件事不依赖任何发版，48 小时内可上线，是第一波收录与排名的起点。
