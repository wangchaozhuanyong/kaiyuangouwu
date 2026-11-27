# 上线操作清单 2026-11-23

对象：`moyaoai.com`（主店铺）与同一 Vendure 服务的其它店铺。
原则：**先把后台数据改好 → 再发版 → 再发内容 → 最后通知搜索引擎**。顺序错会让 canonical 指向不存在的 URL。

---

## 阶段 0：发版前（只动后台，不影响现网）

### 0.1 改 49 条 slug（务必在发版前完成）

文件：[SLUG_MIGRATION_20261123.csv](SLUG_MIGRATION_20261123.csv)

- 位置：后台 → 商品 / 商品分类 → `slug` 字段。
- 用 CSV 的 `proposed_slug` 覆盖 `current_slug`。
- 重点修掉这几个：分类 15 `中专站充值` → `api-credit-topup`；分类 39 `grok订阅-2` → `grok-subscription`；分类 2 `gpt订阅` → `codex-subscription`；商品 6301 `id` → `apple-id-custom`；商品 6285 `gmail-6` → `gmail-6months`。
- 校验：改完后跑一遍
  ```bash
  cd packages/dev-server && bun run seo:indexnow -- --host https://moyaoai.com | head -3
  ```
  能正常读到 sitemap 即可；再看任意商品页 URL 仍是 `?id=` 形式（说明还没切，正常）。

> **发版后不要再改 slug**：目前重定向白名单不含 `/p/*`，改 slug 等于让已收录的 `/p/旧slug` 直接 404。要改必须发版前改。

### 0.2 准备内容（可先存草稿）

- 8 个分类描述（含 FAQ 追加段）：[SEO_CONTENT_PACK_20261123.md](SEO_CONTENT_PACK_20261123.md) 第四节 + 第四之二节。
- 8 个分类 SEO 标题/描述：同文件第二节。
- 8 篇指南：同文件第三节 + 第三之二节。
- 43 篇下线清单：[BLOG_CLEANUP_20261123.csv](BLOG_CLEANUP_20261123.csv)。

指南发布必填：正文、作者、**审核人（必须真实）**、审核时间、至少 1 条来源。

---

## 阶段 1：发版（代码）

### 1.1 本次发布包含

| 组件 | 变更 |
| --- | --- |
| storefront | 指南 Markdown 渲染、分类说明 + FAQ、slug URL 客户端回退、IndexNow 密钥文件 `public/fdc4b2ba72100dfba93a90f5df200225.txt` |
| store-management-plugin | slug 解析、canonical/sitemap 切 slug、x-default、Product `brand`/`inLanguage`、sitemap 生成缓存、FAQPage |
| storefront-content-plugin | FAQ 解析器、`relatedGuides` 字段 |
| dev-server | `seo:indexnow`、`seo:crawl-report`、`seo:gsc-report` 三个脚本 |
| nginx | sitemap 缓存头、HTML 条件缓存（cookie/COOP 感知）、`p/` `c/` 路由放行、日志 `crawler` 字段 |

### 1.2 发布顺序

1. `nginx -t` 通过后再 reload（配置不合法会直接挡住，这是预期的保护）。
2. 后端发布（sitemap/canonical 逻辑在服务端）。
3. 前端发布（指南渲染、分类正文、密钥文件）。
4. 顺序不能反：前端先上而后端未上时，指南仍按旧逻辑输出，页面不会坏，但 `canonical` 仍是 `?id=`。

### 1.3 回滚

- 前端/后端：切回上一份不可变产物。
- nginx：还原上一份配置并 reload。
- 后台数据（slug/描述/内容）不需要回滚，它们是纯数据。

---

## 阶段 2：发版后验收（逐条，全部通过再进阶段 3）

```bash
# 1. slug URL 返回 200，且不跳转
curl -sI https://moyaoai.com/zh/p/codex-go-1month | head -1

# 2. canonical 指向 slug
curl -s https://moyaoai.com/zh/p/codex-go-1month | grep -o 'rel="canonical" href="[^"]*"'

# 3. hreflang 三条都带 /p/
curl -s https://moyaoai.com/zh/p/codex-go-1month | grep -o 'hreflang="[^"]*" href="[^"]*"'

# 4. 旧 id URL 仍是 200 别名（不是 301、不是 404）
curl -sI "https://moyaoai.com/zh/product?id=6257" | head -1

# 5. 不存在的 slug 返回 404
curl -sI https://moyaoai.com/zh/p/no-such-product | head -1

# 6. sitemap 已输出 slug（缓存 5 分钟，必要时等一会）
curl -s https://moyaoai.com/sitemap-products-0.xml | head -15

# 7. IndexNow 密钥可取
curl -s https://moyaoai.com/fdc4b2ba72100dfba93a90f5df200225.txt

# 8. 分类页 FAQ 已渲染（先得有描述内容）
curl -s "https://moyaoai.com/zh/category?collectionId=2" | grep -c 'category-faq'

# 9. 分类页有 FAQPage 结构化数据
curl -s "https://moyaoai.com/zh/category?collectionId=2" | grep -o '"@type":"FAQPage"'
```

浏览器再确认一次：

- 打开 `/zh/p/codex-go-1month`：页面正常，地址栏在短暂加载后变成 `/zh/product?id=6257`。
- 打开 `/zh/guides/<任一已发布 slug>`：价格表是表格、标题分层正常、窄屏可横向滚动。
- 打开 `/zh/category?collectionId=2`：正文 + 常见问题列表显示，手机与电脑都看一遍。

---

## 阶段 3：发布内容（后台）

顺序建议：分类描述 → 分类 SEO → 指南 → 博客下线。

1. **8 个分类描述**：把第四节正文 + 第四之二节 FAQ 追加到描述末尾。
   分类 ID：2 Codex、8 Claude、11 Gemini、39 Grok、13 苹果ID、14 谷歌账号、240 GPT成品、15 中转站充值。
2. **8 个分类 SEO 记录**：目标类型 `COLLECTION`，标题/描述按第二节。
3. **8 篇指南**（目标类型 `ARTICLE`，语言 `zh_Hans`）：
   `codex-dingyue-jiage-duibi`、`claude-pro-max-quibie`、`api-zhongzhuan-jiage-biao`、`google-ai-pro-nianfu-huabuluai`、`gemini-ultra-5x-20x-duibi`、`grok-dingyue-duibi`、`meiqu-apple-id-yue-zenmeyong`、`api-zhongzhuan-vs-guanfang`。
   每篇都要填相关商品 ID（见内容包），发布后指南页会自动出现「相关商品」和「相关指南」。
4. **43 篇博客下线**：后台博客模块按 CSV 的 slug 逐条取消发布（不能配 301，白名单不含 `/blog/`）。
5. 每完成一批，跑一次：
   ```bash
   cd packages/dev-server
   bun run seo:indexnow -- --host https://moyaoai.com --include '/guides/' --apply
   ```
   （`INDEXNOW_KEY=fdc4b2ba72100dfba93a90f5df200225`）

---

## 阶段 4：搜索引擎

1. **GSC 验证两个域名**：`moyaoai.com`、`damatong.net`（各店铺独立）。
2. **提交 sitemap**：`https://moyaoai.com/sitemap.xml`（发版后 10 分钟再提交，等缓存过期）。
3. **手动请求收录**：8 个分类页 + 8 篇指南，每个用「URL 检查」提交一次。
4. **Bing**：IndexNow 已覆盖，无需再提交；可在 Bing Webmaster 里看抓取。
5. **Cloudflare（可选）**：给 HTML 开 Cache Rule 才能吃到 `s-maxage=300`；不开也不会错，只是回源多。
6. **GSC 周报**（需服务账号）：
   ```bash
   cd packages/dev-server
   bun run seo:gsc-report -- --credentials ~/gsc-service-account.json --site sc-domain:moyaoai.com --days 28
   ```

---

## 阶段 5：例行监控

| 频率 | 动作 | 命令/位置 |
| --- | --- | --- |
| 每天 | 看 GSC 覆盖率与手动操作通知 | GSC |
| 每周 | 抓取报告（需要发版后才有 `crawler` 字段） | `bun run seo:crawl-report -- --input /var/log/nginx/moyao-storefront-access.log --top 20` |
| 每周 | GSC 词与页表现 | `seo:gsc-report` |
| 每周 | 新内容推送 | `seo:indexnow --include '/guides/' --apply` |
| 每月 | 更新指南里的价格表 | 按商品页当前价改 8 篇指南 |

---

## 阶段 6：基础设施（与 SEO 独立，但别拖）

1. **确认现役源站**：EC2 实例页清掉「迁移筛选条件」，或用
   ```bash
   aws ec2 describe-instances --region ap-northeast-1 \
     --filters "Name=instance-state-name,Values=running" \
     --query "Reservations[].Instances[].[InstanceId,InstanceType,PublicIpAddress,Tags[?Key=='Name']|[0].Value]" --output table
   ```
   再对 Lightsail 里的 `mi-04476e3f29a528ddc` 核对。线上现在回源正常，说明现役主机不是那两台 `*-quarantined`。
2. **不要启动/终止隔离实例**，先确认它们与现役源站是否共用数据库、Redis、证书。
3. 确认后可清理：`migration-id-business-quarantined`（t3.small）、`migration-vendure-quarantined`（t3.large），清理前先给 EBS 打快照。

---

## 已知限制（不是待办，避免误判为故障）

1. **改 slug 会 404**：重定向白名单不含 `/p/*`、`/c/*`，发版后 slug 视为冻结。
2. **sitemap 最多滞后 5 分钟**：服务端生成缓存 5 分钟，属预期。
3. **HTML 只有无偏好 cookie 才进共享缓存**：带语言/币种 cookie 的请求始终 `no-store`，属预期。
4. **node/JS 侧无法验证 nginx 真实行为**：`deploy/nginx/storefront-fallback.spec.mjs` 需要 bash + unix socket Docker，必须在发布主机或 Linux CI 跑。
5. **SQL 集成夹具写不进 `slug`**：slug canonical 仅有单元用例覆盖，线上靠阶段 2 第 2 条核对。
