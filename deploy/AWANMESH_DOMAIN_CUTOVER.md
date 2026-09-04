# AwanMesh 双店域名与数据同步切换方案

状态：代码与配置已准备；生产 DNS、证书、数据库迁移和 Channel 数据尚未执行。

## 目标映射

| 入口                   | Vendure 归属                                          | 用途           |
| ---------------------- | ----------------------------------------------------- | -------------- |
| `moyaoai.com`          | AwanMesh 主 Channel（当前预设 `__default_channel__`） | 主网店         |
| `www.moyaoai.com`      | 301 到 `moyaoai.com`                                  | 主网店别名     |
| `damatong.net`         | 美宜佳 Channel（上线前必须确认实际 code/id）          | 美宜佳店铺     |
| `www.damatong.net`     | 301 到 `damatong.net`                                 | 美宜佳别名     |
| `console.moyaoai.com`  | 同一 Vendure Admin API                                | 统一管理后台   |
| `console.damatong.net` | 301 到 `console.moyaoai.com`                          | 旧后台兼容入口 |

两个前台复用同一套 Storefront 构建和同一套 Vendure 服务，但请求 Host 先由 Store Domain 插件解析为 Channel。商品、价格、库存、订单、客户、品牌和页面配置都按 Channel 读取；不维护第二份前台数据库，也不依靠前端硬编码 Channel Token。

## 后台到客户端同步链

1. 管理后台在当前 Channel 修改 StoreProfile、商品或内容。
2. Admin API 在数据库内保存对应 Channel 的唯一记录；品牌更新包含乐观锁 `expectedUpdatedAt`。
3. 品牌/内容服务发布 Channel 定向的 `StorefrontDataChangedEvent`。
4. 已打开的前台通过 `/storefront-realtime/events` 收到 `config` 失效事件并重新读取 Shop API。
5. Shop API 返回同一 StoreProfile 的名称、双语口号、颜色和三个 Asset ID/URL；客户端据此更新 Logo 和 CSS 变量。

域名转移使用 SuperAdmin 专用 `storeDomainTransferImpact` + `transferStoreDomain`：在事务中校验 `expectedUpdatedAt`、转移现有已验证记录、切换目标主域并为来源 Channel 选择替代主域，避免删掉再新建导致验证状态丢失。正在打开的旧页面在域名归属变化后必须刷新，因为既有 SSE 连接仍属于打开页面时的 Channel。

## 上线前硬门禁

- 从生产 Admin API 只读确认 AwanMesh 与美宜佳各自唯一的 Channel code/id、StoreProfile 和管理员权限；没有美宜佳 Channel 时先按现有开店流程创建，禁止把名称相近的 Channel 当作目标。
- 对美宜佳商品源做字段级确认：SKU、名称、价格、库存、上下架、图片、删除策略和冲突优先级。现有外部美宜佳/Pospal 自动化不是 Vendure 数据源，未完成映射与一次 dry-run 对账前不得开启写入。
- 备份 MySQL，并保存 StoreDomain、StoreProfile、Channel、商品/价格/库存数量及当前主域快照。
- 证书 `/etc/letsencrypt/live/moyaoai.com/` 必须实际覆盖 `moyaoai.com`、`www.moyaoai.com`、`console.moyaoai.com`、`damatong.net`、`www.damatong.net`、`console.damatong.net`；证书未覆盖时禁止加载新 Nginx 配置。
- 上述六域名证书只覆盖本次固定切换，不会自动覆盖以后新增的客户域名。启用 Cloudflare 一键绑定前，必须用真实自定义域名验证当前套餐的回源 SNI 覆盖或其他可支持的源站证书方案。
- Cloudflare 先创建 `stores.moyaoai.com` 源站目标；两个根域和 `www`/`console` 记录保持代理开启，并按 Store Domain 提供的 TXT 值完成所有权验证。实时 DNS 与源站 IP必须在切换当日重查。

## 无串店切换顺序

1. 部署并运行数据库迁移，但暂不改 DNS；启动新 API/Worker 后检查 `/health`。
2. 对 AwanMesh 主 Channel 运行 `sync-awanmesh-brand.mjs --dry-run`，审核目标 profile/channel 和素材哈希；再以 `--apply --allow-remote` 执行并完成中英文 Shop API 反查。
3. 在后台先添加并验证 `moyaoai.com`，确认它属于 AwanMesh 主 Channel；此时仍不移走 `damatong.net`。
4. 只读检查美宜佳 Channel 的商品、价格、库存、配送/税区、支付和 StoreProfile；缺任一门禁就停止。
5. 查看 `damatong.net` 转移影响，核对来源/目标 Channel 与替代主域；使用最新 `updatedAt` 执行原子转移到美宜佳 Channel。
6. 安装双域名 Nginx 配置，先 `nginx -t`，再 reload；随后切换 Cloudflare DNS。不要在域名转移成功前把 `moyaoai.com` 当作唯一可回退入口。
7. 分别从公网验证两个 Host 的首页、Shop API、品牌、随机 SKU/价格/库存、购物车隔离和 SSE；统一后台必须能切换两个 Channel 并看到与各自前台一致的数据。

## 验收查询

对两个域名分别发送以下 Shop API 查询，并保存响应作为发布证据：

```graphql
query DomainChannelAcceptance {
    activeChannel {
        id
        code
        token
        customFields {
            storefrontNameZh
            storefrontNameEn
        }
    }
    storefrontBranding {
        logoAssetId
        logoOnLightAssetId
        logoOnDarkAssetId
        name
        tagline
        backgroundColor
        primaryColor
        accentColor
        highlightColor
    }
    products(options: { take: 5 }) {
        totalItems
        items {
            id
            name
            slug
        }
    }
}
```

合格条件：`moyaoai.com` 与 `damatong.net` 的 `activeChannel.id/code` 不同；AwanMesh 返回官方品牌字段，美宜佳返回其自身 StoreProfile；同一 SKU 的价格/库存符合批准的 Channel 规则；公开域名 `/admin-api` 为拒绝状态，只有 `console.moyaoai.com` 可访问 Admin API。

## 回滚边界

- 代码/静态文件：切回上一份已验证的不可变运行产物。
- 域名：用相同影响预览和最新 `updatedAt` 把 `damatong.net` 原子转回原 Channel；不删除域名记录。
- DNS：恢复切换前已记录的精确记录值；保留低 TTL 直到完整验收结束。
- 数据：品牌资产不删除，旧关联保留可恢复；商品同步失败时停止后续批次，不以全库覆盖或删除修复。
