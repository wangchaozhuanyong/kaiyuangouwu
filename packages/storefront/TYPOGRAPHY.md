# 商城文字系统

`src/styles/typography.css` 是商城、商家内容预览和独立 2FA 工具的唯一文字规格入口。店铺与皮肤共用同一字号、行高和字重体系；店铺配置可以改变内容，不能改变文字密度。

## 按文字用途选择角色

字号均为 CSS px。电脑断点为 1024px。不要按照旧字号寻找最接近的数字，应先判断文字用途。

| 角色                 | 手机字号／行高 | 电脑字号／行高 | 用途                             |
| -------------------- | -------------- | -------------- | -------------------------------- |
| `topbar`             | 16／20         | 16／20         | 顶部紧凑导航标题                 |
| `page`               | 24／32         | 28／36         | 页面主标题                       |
| `section`            | 16／22         | 18／26         | 普通区块标题                     |
| `section-compact`    | 14／20         | 16／22         | 密集分组标题                     |
| `card`               | 16／24         | 16／24         | 普通卡片、空状态标题             |
| `body`               | 14／21         | 14／21         | 界面正文                         |
| `reading`            | 16／26         | 16／26         | 文章、协议、连续阅读内容         |
| `label`              | 14／20         | 14／20         | 表单标签、侧栏导航、选项文字     |
| `action`             | 15／22         | 16／24         | 主要操作按钮                     |
| `input`              | 16／24         | 16／24         | 可编辑输入内容，手机不能缩小     |
| `helper`             | 13／20         | 13／20         | 分组说明、帮助信息、交付说明     |
| `meta`               | 12／18         | 12／18         | 时间、数量、非主要状态等短元信息 |
| `navigation-compact` | 12／18         | 12／18         | 手机底栏等空间受限的短导航       |
| `product-name`       | 13／1.4        | 15／1.4        | 已确认的紧凑商品卡名称           |
| `product-subtitle`   | 12／1.5        | 13／1.5        | 已确认的商品卡副说明             |
| `product-detail`     | 22／30         | 28／38         | 商品详情名称                     |
| `price`              | 18／24         | 18／24         | 商品列表价格                     |
| `price-detail`       | 28／36         | 32／40         | 商品详情主价格                   |
| `metric`             | 22／28         | 22／28         | 统计数字                         |
| `identity`           | 22／30         | 28／36         | 身份卡主名称                     |
| `code`               | 22／30         | 26／34         | 等宽验证码                       |

营销标题使用 `hero / display / showcase / showcase-compact`，优惠券金额使用 `coupon`，活动大金额使用 `promotion`，认证标题使用 `auth / auth-compact`。这些是明确用途的角色，不能替代普通页面的标题、正文或按钮。

字重：正文 400，标签 500，标题／按钮 600，金额与重点 700。使用 `--font-weight-*`；常规中文标题使用 `--tracking-normal`，价格使用 `--tracking-numeric`，代码使用 `--tracking-code`。字体使用 `--font-ui / --font-numeric / --font-code`，保留系统字体栈。

## 新页面写法

Tailwind 优先使用成对的语义工具类：

```tsx
<h1 className="type-page">账户设置</h1>
<label className="type-label" htmlFor="name">名称</label>
<input className="type-input" id="name" />
<p className="type-helper">填写后可在订单中查看。</p>
<button className="type-action">保存</button>
```

既有 CSS 组件在原所有者文件消费同一字号／行高对：

```css
.account-navigation-link {
    font-size: var(--type-label-size);
    line-height: var(--type-label-leading);
    font-weight: var(--font-weight-medium);
}
```

确有必要使用内联样式时，`fontSize` 与 `lineHeight` 也必须引用同一角色。选中态可以改变颜色和字重，不能改变字号或行高。金额小数和货币符号由共享 `price-lockup` 统一拥有比例，不在各页面复制。

禁止：固定字号、Tailwind 的 `text-xs/text-sm/text-[11px]`、固定字重／行高／字距、字体简写，以及页面、断点、店铺或皮肤重新定义 `--type-*`。禁止用 `meta`、`badge` 或封面微型字承载主要操作、正文和侧栏导航。文字太长时先检查容器宽度、换行、间距与省略规则，不能通过缩字解决。

新增角色必须在唯一入口声明，写明可复用的文字用途、手机／电脑规格和相关页面验收；不得创建 `page-x-12px` 一类页面字号别名。不要追加覆盖文件解决所有权冲突。

## 明确例外

- `badge` 仅供数字角标，手机与电脑均为 10px／12px。`CountBadge` 与 `styles/count-badge.css` 统一拥有购物车、订单、收藏、优惠券入口角标：18px 等高、个位正圆、多位胶囊、双向居中，超过 99 显示 `99+`；完整数量保留在所属控件的可访问名称和角标标题中。零值／未加载不显示，桌面行内统计和通知圆点保持各自语义。商品封面装饰微型字 `artwork-caption / artwork-title` 仅由 `styles/ai-product-covers.css` 使用，自动检查禁止其他页面借用。
- `watermark` 仅为结算页的装饰符号；`illustration / error-code` 仅用于非正文插画或错误编号。
- `referral-poster-layout.ts` 的画布导出测量属于固定图片尺寸，不属于 DOM 排版；检查仅放行此文件中的 `lineHeight` 测量属性，不放行新的页面样式。
- 商家上传图片内的文字属于素材内容；不要通过修改界面字号模仿图片文字。

## 验证与防回归

在 `packages/storefront` 运行：

```sh
bun run check:typography
bun run test:typography
```

开发入口、商城构建和独立工具构建都会执行 `check:typography`。检查递归覆盖新增 CSS／TS／TSX、共享内容预览和独立工具，拒绝原始规格、未知角色、字号／行高不配对、重复定义和越界使用装饰角色。测试包含未来页面的违规注入用例。测试文件及生成路由不作为界面源码扫描。

自动检查约束代码规格，无法代替用途判断和视觉验收。新增或修改界面应检查 360／390px 手机与 1440px 电脑、中文与英文、两种皮肤，以及涉及的长文案、空状态、错误、加载和弹层。验证文字层级、输入内容不低于 16px、无裁切／重叠／横向溢出；放大到 200% 时应保持可读。视觉交付必须标明实际检查范围，不能把构建通过写成线上验收通过。
