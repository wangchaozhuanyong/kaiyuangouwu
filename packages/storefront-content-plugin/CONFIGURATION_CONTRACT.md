# 店铺配置契约

所有店铺共用一套功能和实现。Channel 只隔离品牌、商品、装修、导航、客户端插件与分享配置；店名、域名和 Channel code 不决定功能分支。

## 保存与显示

- `homepage-manifest.ts` 是首页模块目录，`client-plugin-manifest.ts` 是客户端插件目录；后台和客户端消费同一目录。默认启用值只用于新建编辑草稿，不创建虚拟楼层。
- 客户端装修内容以当前 Channel 的 Shop API `storefrontContent` 为准。未配置或全部停用的店铺不自动出现轮播、快捷入口、服务承诺或营销楼层；系统导航、商品空状态和登录表单仍使用统一基础界面。
- 发布检查由 `content-publication.ts` 统一执行：启用、展示排期、中英文完成、有效轮播图片均满足才显示。关闭的条目不阻塞其父块发布。后台显示对应未展示原因；可选中英文字段同时留空时保持空白。
- 图片来自当前保存的 Asset/受管地址。读取失败时显示统一图片占位，不换成其他店铺的图片。颜色和样式由保存的设置决定，不按店名、业务词或轮播序号替换。
- 轮播卖点、快捷入口、服务信息和结构预览不再使用旧的 3/4/6/8 条静默截断。核心品类的双卡模板及显式商品展示数量保留其已有规则；后台描述应说明这些模板限制。
- 多个 HERO 组成一个轮播楼层，轮播内有独立顺序；分类专题、精选集合、品牌故事及 CUSTOM 各自按保存位置显示。NOTICE 等固定业务模块仍由模块目录的单一配置入口管理。
- 通用视觉选项为标准/彩色卡片、标准/暖色/清晰原图轮播。旧 `damatong-colorful`、`damatong-balanced`、`cloudbridge-bright`、`marketplace-bright` 值仅映射到通用选项，保留数据兼容；不据此生成额外内容。

## 管理入口与权限

- 商城首页装修右上角“首页轮播图”管理图片、双语文案、跳转、排期、图片顺序和轮播间隔；整组轮播的位置在楼层列表调整。
- 分享设置单独位于 `/marketing/sharing`，使用现有 Referral API。默认模板、启停、背景与文案全部归当前店铺。旧 `?tab=posters` 跳转到新入口。
- `settings.purpose` 为 `referral-system-poster` 或 `referral-custom-poster` 的记录不计入装修楼层或公开首页。原记录和素材不删除、不迁移；普通同名 CUSTOM 内容不受影响。
- 装修、内容页和客户端插件使用 `ReadStorefrontContent` 及各自创建/更新/删除权限；分享沿用 Referral 权限。全局系统公告仅超级管理员可管理，不能为让商家打开装修页而扩大平台设置权限。
- 写入固定到读取配置时的 Channel，并保留后端 Channel 归属和版本校验。切换店铺后重新读取配置；空的新店配置不继承上一店的草稿。
- 结构预览与公开 API 共用发布条件，按保存顺序和语言显示内容。它不是客户端样式的逐像素预览，真实商品、自动营销数据和页面布局必须在客户端验证。

## 旧数据和发布器

本次修复不清空、重建或统一覆盖已有店铺数据。各店图片、文案、商品和启停状态允许不同；功能目录、控制入口和执行规则必须相同。新店不复制旧店的品牌或整店数据。

历史整店发布器不是日常装修入口。`sync-damatong-storefront.mjs` 的写入需要已审核 dry-run 的 `reviewHash`，通过 `STOREFRONT_PUBLISH_REVIEW_SHA256` 传入。该值绑定目标、当前版本和计划修改；目标或配置变化后必须重新预演审核。未提供或过期时在素材上传和配置写入前停止。其他专用发布器继续沿用各自既有的显式范围、`--apply --allow-remote` 和双 API 验证规则。

发布前逐店只读核对原始配置和新发布结果，尤其是以前依赖客户端补默认模块、缺少英文或轮播图片的记录。需要补内容时由后台保存，或另行审核精确数据差异；不能运行整店模板来掩盖缺项。生产工作流的审核摘要传递需要单独完成门禁引导，详见发布手册；没有摘要时历史整店写入保持阻断。

## 本地验收

`e2e/storefront-unification.e2e-spec.ts` 创建一次性 SQL.js 数据库和三个测试 Channel，测试 Admin 保存到 Shop 读取的中英文、图片、空字段、顺序、启停、间隔、分享排除与跨店隔离，并用真实 HomePage 在 390/1440 宽度连接测试 API。它不会连接现有或生产数据库。

```bash
PACKAGE=storefront-content-plugin VENDURE_DISABLE_TELEMETRY=true bunx vitest run --config e2e-common/vitest.config.mts packages/storefront-content-plugin/e2e/storefront-unification.e2e-spec.ts
```

后台轮播和分享浏览器验收位于 `packages/next-admin/e2e/carousel` 与 `e2e/sharing`，使用真实页面组件和内存 API，另行覆盖失败重试、权限、移动端、默认模板和旧链接跳转。这些本地结果不能替代线上数据库和登录后的验收。
