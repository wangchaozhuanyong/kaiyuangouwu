# MOYAO AI｜模钥

<!-- impeccable:product-schema 1 -->

## Platform

web

## Default site

- Canonical domain: `https://moyaoai.com/`.
- Brand name: Chinese surfaces use `MOYAO AI｜模钥`; English surfaces use `MOYAO AI`.
- Tagline: `全球模型，一钥直达` / `One Key to Every Model.`
- The old default brand and old default-domain wording must not appear in public metadata, navigation, authentication, sharing, referral, promotion, email defaults, or management UI.
- A separately configured Channel may keep its own brand and domain. Default-site fallbacks must never overwrite that Channel's managed profile.

## Users

- 希望把 AI 能力用于实际工作的个人创业者和自由职业者。
- 需要提高选题、表达和制作效率的内容创作者。
- 需要接入模型、API 或调用额度的开发者和程序员。
- 希望为小团队或企业工作流选择合适 AI 服务的负责人。

## Product purpose

MOYAO AI 提供清晰、可信的 AI 数字服务入口。用户应能快速理解服务方向、比较适合自己的方案、确认交付与售后条件，并安全进入购买或服务流程。

## Information architecture

1. 首页先说明品牌价值、核心服务和可信承诺，不用大图重复堆叠同一信息。
2. 分类页负责筛选与比较，商品卡只保留名称、关键差异、价格/状态和一个明确入口。
3. 商品详情页说明适用人群、交付方式、限制、有效期和售后边界。
4. 登录、注册、订单、推荐海报与推广页统一使用同一品牌名、图标、色板和语气。
5. 管理后台继续作为品牌、文案和媒体资产的数据源；代码中的品牌内容只是无数据时的安全默认值。

## Capabilities and constraints

- 服务可包括 AI 订阅、AI API 中转、调用额度、数字商品和人工支持，以后台实际发布内容为准。
- 不虚构价格优势、第三方授权、销量、客户评价、客户名单或效果指标。
- 数字商品必须写清交付介质、时间、使用条件、有效期和售后范围。
- 推广页通过签名 `POST /promo/enter` 进入服务中心，不直接复制交易页面。
- 中文和英文是完整的独立输出，不在同一界面混排翻译文案。

## Success criteria

- 用户在首屏能识别 MOYAO AI、理解主要价值并找到下一步。
- 列表图片不会因比例不一致造成卡片跳动，桌面端不会被超大正方形图片占满。
- 所有公开入口、社交分享和后台品牌面不再回退到旧品牌。
- 页面在移动端、桌面端、弱网和图片加载失败时保持稳定布局。
- 所有能力与保障陈述都可由当前业务真实兑现。

## Accessibility

- 支持键盘操作、可见焦点、语义化标题和减少动态偏好。
- 正文文字目标对比度不低于 4.5:1，主要触控区域不小于 44px。
- 品牌图片带有可理解的替代文本；装饰图片不重复朗读品牌。
