# 页面语言与系统文案显示契约

## 问题来源

中文页面反复出现英文有四条独立路径：页面直接显示插件、状态、部门等内部编码；字典查不到时返回原始编码；服务端翻译链把缺失或空白中文字段补成英文；扩展注册信息和服务错误没有经过展示转换。仅修某个页面的文字无法封闭这些路径。

## 统一规则

1. 系统编码用于接口、存储、路由和查字典。用户看到的名称通过展示解析器获得，未知编码显示当前语言的缺失提示。禁止 `labels[key] ?? key`、`labels[key] || key`。
2. 已翻译业务内容只取请求语言。缺少中文名称显示“未填写中文名称”，缺少中文说明保持为空；英文同理。编辑表单取原始对应语言的翻译记录，缺失时留空，不把展示占位文字或其他语言内容保存回数据。
3. `translateEntity` 在字段赋值阶段执行这一规则，`translateDeep` 和 `translateTree` 自然继承。翻译记录中的新增文本字段自动受保护；ORM 元数据、`slug`、`code`、URL、路径及标识字段保留原有寻址机制。中文和英文的本地化自定义字段也不跨语言回退，原始记录不被修改。
4. 商家明确填写的品牌、商品文案、客户留言、订单号、SKU、邮箱、网址、文件名等业务数据保留原值。语言投影不等于自动翻译，不按英文字母粗暴过滤业务数据。
5. 英文堆栈、服务诊断和错误码不能直接成为中文页面提示。用户提示通过现有错误解析器或 `serviceMessageDisplay` 输出；安全的中文服务提示保留。需要定位问题的内部编码放在默认收起的 `TechnicalDetails` 中，不用它替代业务名称，不放入密码或凭据。

## 公共入口

| 内容 | 入口 |
| --- | --- |
| 系统标签、缺失提示、服务消息、实体翻译投影 | `packages/common/src/display-localization.ts` |
| 状态、事件、部门、严重级别、运行阶段 | `packages/common/src/system-display-labels.ts` |
| 后台当前语言 | `packages/next-admin/src/utils/admin-language.ts` |
| 后台实体名称与说明 | `packages/next-admin/src/utils/localized-entity-display.ts` |
| 插件双语显示元数据 | `packages/storefront-content-plugin/src/dashboard/client-plugin-display.ts` |
| 后台扩展标题、导航、操作及组件说明 | `packages/next-admin/src/extensions/extension-api.ts` |
| 服务端翻译引擎 | `packages/core/src/service/helpers/utils/translate-entity.ts` |

插件清单只存定义和稳定编码；后台及原生插件页使用同一个显示解析器。扩展注册可以提供 `titleTranslations`、`labelTranslations`、`descriptionTranslations`，其中语言键为 `zh_Hans` 和 `en`。中文环境下的英文系统标题会被安全占位文字替代。

## 构建与回归检查

```sh
node scripts/audit-display-localization.mjs
node --test scripts/audit-display-localization.spec.mjs
bun run --cwd packages/next-admin test
bun run --cwd packages/storefront test
bun run --cwd packages/core test src/service/helpers/utils/translate-entity.spec.ts
bun run --cwd packages/store-management-plugin test src/storefront-branding.resolver.spec.ts
```

源码检查覆盖 NextAdmin、客户端、全部自定义插件的 `dashboard` 和 `browser` 目录。检查已知系统字段直出、原始服务错误直出、原始字典回退，以及后台 JSX 文本和展示属性中的未翻译英文。它区分表单值、接口参数、语言分支、业务引用和明确的技术详情。两端现有生产构建验证脚本都会运行此检查，失败即阻止构建成功。

回归用例覆盖未知枚举、原型属性、未来插件、双语扩展注册、缺失整条中文翻译、空中文字段、未来新增翻译字段、嵌套商品/规格，以及源数据不可变性。

源码检查是明确规则的自动门禁，仍需为新业务的动态文案和 API 契约补充对应语言用例。它不会自动翻译商家内容，也不能证明尚未发布的代码已在线上生效。新增系统字段和枚举应先登记展示标签，再接入组件。
