# Content Translation Plugin

本插件统一管理客户可见内容的简体中文到英文翻译。简体中文是源内容，英文由服务端自动生成；运营人员仍可填写英文进行人工覆盖。

## 运行规则

- 管理后台只要求简体中文，英文留空时在保存事务中自动生成。
- 人工填写的英文会被锁定。之后修改中文时，保存会保留该人工英文并将状态标记为 `STALE`，避免覆盖人工内容或阻断日常编辑；日常录入仍只需维护中文，有精确英文文案需求时再进行复核。
- 当前店铺存在 `STALE` 内容时，管理后台通知铃铛会显示英文待复核数量，但不会要求日常编辑重复填写英文。
- 翻译服务未配置或必填英文生成失败时，保存会明确失败，不会把只有中文的新增内容发布给英文客户端。
- 客户端语言切换仍通过 Vendure 的 `languageCode` 请求上下文完成，不依赖浏览器网页翻译。
- 英文客户端不使用中文内容兜底。历史数据缺少英文时，对应自定义文本为空或整块不发布，直到完成回填。

## 配置

开发服务器使用 Google Cloud Translation Basic v2：

```dotenv
VENDURE_GOOGLE_TRANSLATION_API_KEY=replace-with-a-restricted-server-key
```

生产环境检查会把缺失或占位密钥标记为阻断项。API Key 应只允许调用 Cloud Translation API，并在 Google Cloud 中限制到生产服务端可用的网络身份。

## 管理接口

接口仅允许 `SuperAdmin` 调用。

查询最近的翻译状态：

```graphql
query TranslationAudit($channelId: ID) {
    contentTranslationAudit(channelId: $channelId) {
        configured
        provider
        total
        counts {
            status
            count
        }
        states {
            entityType
            entityId
            fieldPath
            status
            origin
            locked
            updatedAt
        }
    }
}
```

分批回填 Vendure 原生内容：

```graphql
mutation BackfillTranslations($entityType: String, $limit: Int, $offset: Int) {
    backfillCustomerContentTranslations(entityType: $entityType, limit: $limit, offset: $offset) {
        total
        scanned
        processed
        failed
        nextOffset
        hasMore
        errors
    }
}
```

`entityType` 可省略，也可使用 `Product`、`ProductVariant`、`ProductOptionGroup`、`ProductOption`、`Collection`、`Facet`、`FacetValue`、`Promotion`、`ShippingMethod`、`PaymentMethod`、`Country` 或 `Province`。单次上限为 500；每次将返回的 `nextOffset` 作为下一次的 `offset`，直到 `hasMore` 为 `false`，并处理返回的错误。

历史上在英语语言槽中填写、但实际仍包含中文字符的原生内容，会由数据库迁移先复制为 `zh_Hans` 源内容。配置翻译服务后，服务端启动会自动扫描并替换这些伪英文历史值，即使它们与当前中文源文案不完全相同；不包含中文的人工英文仍会保留并锁定。已经是最新状态的自动翻译不会在每次启动时重复调用翻译 API。

自定义店铺资料、公告和装修内容在保存时自动翻译；旧数据缺译会被店铺上线检查或发布过滤器拦截，运营人员重新保存该记录即可补齐。

## 发布顺序

1. 配置受限的翻译 API Key。
2. 执行数据库迁移。
3. 查看启动日志中的自动回填结果；如果有失败记录，再通过管理接口分批重试，直到 `failed` 为 0。
4. 重新保存被上线检查或发布过滤器标记为缺译的自定义内容。
5. 查看翻译状态审计，再开放英文客户端流量。
