export type LocalizedHelpText = {
    zh_Hans: string;
    en: string;
};

export type ImageSizeGuidance =
    | 'assetLibrary'
    | 'product'
    | 'productGroup'
    | 'richText'
    | 'logo'
    | 'hero'
    | 'banner'
    | 'contentCard'
    | 'icon';

export type PageHelpTopic = {
    title: LocalizedHelpText;
    purpose: LocalizedHelpText;
    listSteps?: LocalizedHelpText[];
    detailSteps?: LocalizedHelpText[];
    tips: LocalizedHelpText[];
    warning?: LocalizedHelpText;
};

const text = (zh_Hans: string, en: string): LocalizedHelpText => ({ zh_Hans, en });

const imageSizeGuidance: Record<ImageSizeGuidance, LocalizedHelpText> = {
    assetLibrary: text(
        '常用建议尺寸：商品与分组图 1200 × 1200 px；首页主视觉 1440 × 720 px；店铺 Logo 512 × 512 px。',
        'Common recommendations: product and group images 1200 × 1200 px; homepage hero 1440 × 720 px; store logo 512 × 512 px.',
    ),
    product: text(
        '建议尺寸：1200 × 1200 px（1:1）。主体居中，四周保留约 8% 安全边距。',
        'Recommended: 1200 × 1200 px (1:1). Centre the subject and keep about 8% safe space around the edges.',
    ),
    productGroup: text(
        '建议尺寸：1200 × 1200 px（1:1）。分组主体居中，避免文字和标志贴近边缘。',
        'Recommended: 1200 × 1200 px (1:1). Centre the group subject and keep text and logos away from the edges.',
    ),
    richText: text(
        '建议宽度：1200 px；高度按原图比例。请勿放大小于正文实际展示宽度的图片。',
        'Recommended width: 1200 px, with height following the original aspect ratio. Avoid upscaling images smaller than their displayed width.',
    ),
    logo: text(
        '建议尺寸：512 × 512 px（1:1），使用透明背景 PNG 或 SVG，图形四周保留安全边距。',
        'Recommended: 512 × 512 px (1:1), using a transparent PNG or SVG with safe space around the mark.',
    ),
    hero: text(
        '建议尺寸：1440 × 720 px（2:1）。主要图形放在右侧，左侧预留标题和按钮区域。',
        'Recommended: 1440 × 720 px (2:1). Place the main artwork on the right and reserve the left side for headings and actions.',
    ),
    banner: text(
        '建议尺寸：1440 × 720 px（2:1）。主要内容居中，上下各保留约 8% 安全边距。',
        'Recommended: 1440 × 720 px (2:1). Centre the main content and keep about 8% safe space at the top and bottom.',
    ),
    contentCard: text(
        '建议尺寸：1200 × 1200 px（1:1）。主要内容居中，避免关键信息贴近边缘。',
        'Recommended: 1200 × 1200 px (1:1). Centre the main content and keep important details away from the edges.',
    ),
    icon: text(
        '建议尺寸：320 × 320 px（1:1），优先使用透明背景 PNG 或 SVG。',
        'Recommended: 320 × 320 px (1:1), preferably a transparent PNG or SVG.',
    ),
};

export function localizeHelpText(value: LocalizedHelpText, locale: string) {
    return locale.startsWith('zh') ? value.zh_Hans : value.en;
}

export function getImageSizeGuidance(kind: ImageSizeGuidance): LocalizedHelpText {
    return imageSizeGuidance[kind];
}

const pageHelpTopics: Record<string, PageHelpTopic> = {
    insights: {
        title: text('经营概览操作说明', 'Business overview guide'),
        purpose: text(
            '集中查看订单、销售额和经营趋势，快速判断近期业务变化。',
            'Review orders, revenue, and business trends in one place to understand recent performance.',
        ),
        detailSteps: [
            text('先选择需要分析的时间范围。', 'Start by selecting the period you want to analyse.'),
            text(
                '对比订单量、销售额和客单价的变化。',
                'Compare changes in order volume, revenue, and average order value.',
            ),
            text(
                '发现异常后进入订单或商品页面继续排查。',
                'Open Orders or Products to investigate any unusual change.',
            ),
        ],
        tips: [
            text(
                '指标会受当前销售渠道和地区格式影响。',
                'Metrics reflect the active sales channel and regional format.',
            ),
        ],
    },
    product: {
        title: text('商品管理操作说明', 'Product management guide'),
        purpose: text(
            '维护商品基础资料、图文介绍、所属分组和销售规格。',
            'Maintain product information, descriptions, product groups, and saleable SKUs.',
        ),
        listSteps: [
            text(
                '使用搜索、筛选和列设置找到目标商品。',
                'Use search, filters, and column settings to find a product.',
            ),
            text(
                '点击商品名称进入详情，或使用“新建商品”创建商品。',
                'Open a product name for details, or select New product to create one.',
            ),
            text(
                '批量操作前先核对选择数量和当前销售渠道。',
                'Before a bulk action, confirm the selection count and active sales channel.',
            ),
        ],
        detailSteps: [
            text(
                '填写商品名称、URL 标识和商品介绍。',
                'Enter the product name, URL identifier, and description.',
            ),
            text('添加素材、筛选属性和商品分组。', 'Add assets, filter attributes, and product groups.'),
            text(
                '创建商品 SKU，设置价格、库存和规格组合。',
                'Create product SKUs and set prices, stock, and option combinations.',
            ),
            text(
                '保存后切换销售渠道检查可见范围。',
                'After saving, check availability in each sales channel.',
            ),
        ],
        tips: [
            text(
                '商品本身不能直接销售，实际价格和库存记录在商品 SKU 上。',
                'The product itself is not sold directly; prices and stock belong to product SKUs.',
            ),
        ],
    },
    productVariant: {
        title: text('商品 SKU 操作说明', 'Product SKU guide'),
        purpose: text(
            '管理可独立定价、记录库存和加入订单的具体销售规格。',
            'Manage saleable SKUs that have their own prices, stock, and order lines.',
        ),
        listSteps: [
            text('按 SKU、商品名称或库存状态筛选。', 'Filter by SKU, product name, or stock status.'),
            text(
                '点击 SKU 查看价格、库存和所属商品。',
                'Open a SKU to review prices, stock, and its parent product.',
            ),
        ],
        detailSteps: [
            text('确认 SKU 唯一且便于仓库识别。', 'Use a unique SKU that warehouse staff can recognise.'),
            text(
                '按销售渠道维护价格，并按库存点维护库存。',
                'Maintain prices by sales channel and stock by stock location.',
            ),
            text(
                '保存前检查规格组合是否与商品一致。',
                'Before saving, confirm that the option combination matches the product.',
            ),
        ],
        tips: [
            text(
                '修改 SKU 可能影响外部 ERP、仓储或订单对接。',
                'Changing a SKU can affect ERP, warehouse, or order integrations.',
            ),
        ],
        warning: text(
            '已有订单使用的 SKU 不建议随意修改或删除。',
            'Avoid changing or deleting a SKU that is already used by orders.',
        ),
    },
    optionGroup: {
        title: text('规格组操作说明', 'Option group guide'),
        purpose: text(
            '定义颜色、尺寸等规格维度，并为商品 SKU 生成可选组合。',
            'Define option dimensions such as colour and size for product SKU combinations.',
        ),
        listSteps: [
            text(
                '先创建规格组，再进入规格组添加规格值。',
                'Create an option group, then add its option values.',
            ),
            text(
                '进入商品详情，把需要的规格组关联到商品。',
                'Open a product and assign the required option groups.',
            ),
        ],
        detailSteps: [
            text(
                '名称使用用户能理解的维度，例如“颜色”。',
                'Use a customer-friendly dimension name, such as Colour.',
            ),
            text(
                '代码用于系统识别，保存后尽量不要修改。',
                'The code is a system identifier and should remain stable after saving.',
            ),
            text('添加规格值，例如“黑色”“白色”。', 'Add option values such as Black and White.'),
        ],
        tips: [
            text(
                '规格组决定 SKU 组合，不要把普通筛选属性放在这里。',
                'Option groups define SKU combinations; do not use them for ordinary filter attributes.',
            ),
        ],
    },
    facet: {
        title: text('筛选属性操作说明', 'Filter attribute guide'),
        purpose: text(
            '维护品牌、材质、适用人群等商品筛选条件，也可用于自动商品分组。',
            'Maintain product filters such as brand, material, and audience, and use them in automatic product groups.',
        ),
        listSteps: [
            text(
                '创建筛选属性后，再添加可选属性值。',
                'Create a filter attribute, then add its available values.',
            ),
            text(
                '进入商品或商品 SKU 详情分配属性值。',
                'Assign values from a product or product SKU detail page.',
            ),
        ],
        detailSteps: [
            text(
                '名称面向运营人员和顾客，代码面向系统对接。',
                'The name is for operators and customers; the code is for integrations.',
            ),
            text(
                '根据前台需求决定是否公开显示。',
                'Choose whether the attribute should be publicly visible.',
            ),
            text('添加属性值并检查多语言内容。', 'Add values and review their content translations.'),
        ],
        tips: [
            text(
                '颜色、尺寸如果会形成独立 SKU，应使用规格组而不是筛选属性。',
                'Use an option group instead when colour or size creates a separate SKU.',
            ),
        ],
    },
    collection: {
        title: text('商品分组操作说明', 'Product group guide'),
        purpose: text(
            '按人工选择或筛选规则组织商品，用于店铺导航、专题页和运营活动。',
            'Organise products manually or by rules for storefront navigation, campaigns, and merchandising.',
        ),
        listSteps: [
            text(
                '查看分组层级，并通过搜索定位目标分组。',
                'Review the hierarchy and use search to find a product group.',
            ),
            text(
                '点击分组名称编辑，或创建新的商品分组。',
                'Open a group to edit it, or create a new product group.',
            ),
        ],
        detailSteps: [
            text('填写名称、URL 标识和说明。', 'Enter the name, URL identifier, and description.'),
            text(
                '选择上级分组，确认前台导航层级。',
                'Choose a parent group and confirm the storefront hierarchy.',
            ),
            text('添加筛选规则并预览匹配商品。', 'Add filter rules and preview the matching products.'),
        ],
        tips: [
            text(
                '规则修改后，分组内商品可能随商品属性变化而自动增减。',
                'After rules change, group membership can update automatically with product data.',
            ),
        ],
    },
    asset: {
        title: text('素材库操作说明', 'Asset library guide'),
        purpose: text(
            '集中上传、查找和复用商品图片及文件。',
            'Upload, find, and reuse product images and files.',
        ),
        listSteps: [
            text('上传素材后补充名称、焦点和标签。', 'After upload, add a name, focal point, and tags.'),
            text('使用类型、标签和搜索快速定位素材。', 'Use type, tags, and search to find assets.'),
            text(
                '删除前确认素材没有被商品或页面使用。',
                'Before deleting, confirm that no product or page uses the asset.',
            ),
        ],
        detailSteps: [
            text('检查文件预览、大小和来源文件名。', 'Review the preview, file size, and source filename.'),
            text(
                '设置焦点，避免响应式裁剪切掉主体。',
                'Set a focal point so responsive cropping keeps the subject visible.',
            ),
            text('使用标签建立可维护的素材分类。', 'Use tags to create a maintainable asset taxonomy.'),
        ],
        tips: [
            text(
                '商品主图建议使用统一比例和清晰度。',
                'Use a consistent aspect ratio and resolution for primary product images.',
            ),
        ],
    },
    review: {
        title: text('商品评价操作说明', 'Product review guide'),
        purpose: text(
            '审核顾客评价、维护回复并处理不合规内容。',
            'Moderate customer reviews, maintain responses, and handle inappropriate content.',
        ),
        listSteps: [
            text('按状态和评分筛选待处理评价。', 'Filter pending reviews by status and rating.'),
            text(
                '打开评价核对商品、正文和作者信息。',
                'Open a review to check the product, body, and author details.',
            ),
            text(
                '选择通过或拒绝，并按需要填写商家回复。',
                'Approve or reject the review and add a merchant response when needed.',
            ),
        ],
        detailSteps: [
            text('先核对评价内容和关联商品。', 'First verify the review content and related product.'),
            text('更新审核状态并填写回复。', 'Update the moderation status and enter a response.'),
            text('保存后确认前台显示结果。', 'After saving, confirm the storefront result.'),
        ],
        tips: [
            text('审核标准应在团队内部保持一致。', 'Keep moderation standards consistent across the team.'),
        ],
    },
    order: {
        title: text('订单处理操作说明', 'Order processing guide'),
        purpose: text(
            '查看订单、处理收款发货、修改订单并记录售后过程。',
            'Review orders, manage payments and fulfilment, modify orders, and record after-sales activity.',
        ),
        listSteps: [
            text('按订单编号、状态、顾客或日期筛选。', 'Filter by order code, status, customer, or date.'),
            text(
                '打开订单后先核对商品、金额、地址和付款状态。',
                'Open an order and verify items, totals, addresses, and payment status.',
            ),
            text(
                '根据履约流程执行收款、发货、取消或退款。',
                'Follow your workflow for payment, fulfilment, cancellation, or refund.',
            ),
        ],
        detailSteps: [
            text(
                '先检查订单状态和允许执行的下一步操作。',
                'Check the order state and available next actions.',
            ),
            text(
                '修改订单时预览金额和库存变化。',
                'Preview total and stock changes before modifying an order.',
            ),
            text('在历史记录中补充关键处理说明。', 'Record important actions in the order history.'),
        ],
        tips: [
            text(
                '界面金额受显示地区格式影响，但不会改变订单保存的币种。',
                'Regional display formatting does not change the currency stored on the order.',
            ),
        ],
        warning: text(
            '取消、退款和删除草稿订单可能无法撤销。',
            'Cancellation, refund, and draft-order deletion may be irreversible.',
        ),
    },
    customer: {
        title: text('客户管理操作说明', 'Customer management guide'),
        purpose: text(
            '维护客户资料、地址、所属客户组和订单关系。',
            'Maintain customer profiles, addresses, customer groups, and order relationships.',
        ),
        listSteps: [
            text('按姓名、邮箱或客户组查找客户。', 'Find a customer by name, email, or customer group.'),
            text(
                '进入详情查看资料、地址和历史订单。',
                'Open details to review profile data, addresses, and order history.',
            ),
        ],
        detailSteps: [
            text('核对联系方式和账户状态。', 'Verify contact information and account status.'),
            text('维护常用地址和客户组。', 'Maintain saved addresses and customer groups.'),
            text('敏感信息变更后记录原因。', 'Record the reason for sensitive account changes.'),
        ],
        tips: [
            text(
                '不要在备注中记录密码、支付卡号等敏感信息。',
                'Do not store passwords, payment card numbers, or other sensitive data in notes.',
            ),
        ],
    },
    customerGroup: {
        title: text('客户分组操作说明', 'Customer group guide'),
        purpose: text(
            '把客户组织成可用于定价、促销或运营管理的分组。',
            'Organise customers into groups for pricing, promotions, or operations.',
        ),
        listSteps: [
            text('创建分组并使用清晰的业务名称。', 'Create a group with a clear business name.'),
            text('进入分组添加或移除客户。', 'Open the group to add or remove customers.'),
        ],
        detailSteps: [
            text('确认分组用途和影响的业务规则。', 'Confirm the purpose and affected business rules.'),
            text('维护成员并保存。', 'Maintain the members and save changes.'),
        ],
        tips: [
            text(
                '移除客户前检查该分组是否用于专属价格或促销。',
                'Before removing a customer, check whether the group controls prices or promotions.',
            ),
        ],
    },
    promotion: {
        title: text('促销活动操作说明', 'Promotion guide'),
        purpose: text(
            '配置活动时间、适用条件、优惠方式和优惠券。',
            'Configure campaign dates, eligibility rules, discounts, and coupon codes.',
        ),
        listSteps: [
            text('按启用状态和时间范围查找活动。', 'Find campaigns by status and date range.'),
            text(
                '创建活动后依次设置条件、优惠和优惠券。',
                'Create a campaign, then configure conditions, discounts, and coupons.',
            ),
        ],
        detailSteps: [
            text(
                '设置活动名称、启用状态和有效期。',
                'Set the campaign name, enabled status, and validity period.',
            ),
            text('配置顾客或订单需要满足的条件。', 'Configure customer or order eligibility conditions.'),
            text('配置优惠动作并测试临界金额。', 'Configure discounts and test boundary order values.'),
            text(
                '需要优惠券时再添加代码和使用限制。',
                'Add coupon codes and usage limits only when required.',
            ),
        ],
        tips: [
            text(
                '多项促销可能叠加，发布前应使用测试订单验证最终价格。',
                'Promotions may stack; verify the final price with a test order before publishing.',
            ),
        ],
    },
    seller: {
        title: text('商家管理操作说明', 'Seller management guide'),
        purpose: text(
            '管理多商家模式中的销售主体及其关联销售渠道。',
            'Manage merchant entities and their related sales channels in a marketplace.',
        ),
        listSteps: [
            text(
                '查看商家列表并进入详情维护资料。',
                'Review sellers and open details to maintain their information.',
            ),
            text(
                '创建商家后配置对应销售渠道和权限。',
                'After creating a seller, configure its sales channels and permissions.',
            ),
        ],
        detailSteps: [
            text('填写商家名称和系统代码。', 'Enter the seller name and system code.'),
            text(
                '确认关联渠道、管理员和结算对接。',
                'Confirm related channels, administrators, and settlement integrations.',
            ),
        ],
        tips: [
            text(
                '单商家项目通常不需要额外创建商家。',
                'Single-merchant projects usually do not need additional sellers.',
            ),
        ],
    },
    channel: {
        title: text('销售渠道操作说明', 'Sales channel guide'),
        purpose: text(
            '隔离不同店铺、品牌或地区的商品、价格、库存和订单。',
            'Separate products, prices, stock, and orders across stores, brands, or regions.',
        ),
        listSteps: [
            text(
                '先明确渠道对应的店铺、地区和币种。',
                'Define the store, region, and currency represented by the channel.',
            ),
            text(
                '创建渠道后配置语言、币种、税区和配送区。',
                'After creating a channel, configure languages, currencies, tax zone, and shipping zone.',
            ),
        ],
        detailSteps: [
            text('填写稳定且唯一的渠道代码和令牌。', 'Enter a stable, unique channel code and token.'),
            text(
                '选择可用语言和默认内容语言。',
                'Choose available languages and the default content language.',
            ),
            text(
                '选择可用币种和默认交易币种。',
                'Choose available currencies and the default transaction currency.',
            ),
            text(
                '核对税价、库存策略和默认区域。',
                'Review tax-inclusive pricing, inventory policy, and default zones.',
            ),
        ],
        tips: [
            text(
                '界面语言只改变后台文字，不会改变渠道的商品内容语言。',
                'The interface language changes dashboard text only; it does not change channel content language.',
            ),
        ],
        warning: text(
            '渠道代码和令牌可能被前端或外部系统使用，修改前先检查对接。',
            'Channel codes and tokens may be used by storefronts or integrations; check dependencies before changing them.',
        ),
    },
    stockLocation: {
        title: text('仓库与库存点操作说明', 'Stock location guide'),
        purpose: text(
            '定义商品库存实际存放、分配和扣减的位置。',
            'Define where product stock is physically stored, allocated, and deducted.',
        ),
        listSteps: [
            text('按仓库名称或代码查找库存点。', 'Find a stock location by name or code.'),
            text(
                '创建后进入商品 SKU 维护该位置的库存。',
                'After creation, maintain stock for this location from product SKUs.',
            ),
        ],
        detailSteps: [
            text('填写仓库名称和内部代码。', 'Enter the warehouse name and internal code.'),
            text(
                '核对与销售渠道、分配策略和履约流程的关系。',
                'Review its relationship to channels, allocation rules, and fulfilment.',
            ),
        ],
        tips: [
            text(
                '仓库代码应与 ERP 或 WMS 的标识保持一致。',
                'Keep warehouse codes aligned with ERP or WMS identifiers.',
            ),
        ],
    },
    administrator: {
        title: text('管理员操作说明', 'Administrator guide'),
        purpose: text(
            '创建后台账号，并通过角色控制可查看和操作的功能。',
            'Create dashboard accounts and control access through roles.',
        ),
        listSteps: [
            text('按姓名或登录标识查找管理员。', 'Find an administrator by name or login identifier.'),
            text(
                '创建账号后分配最少必要角色。',
                'After creating an account, assign only the roles required.',
            ),
        ],
        detailSteps: [
            text('填写姓名、登录标识和联系方式。', 'Enter the name, login identifier, and contact details.'),
            text(
                '按职责分配角色，并核对角色权限。',
                'Assign roles by responsibility and review their permissions.',
            ),
            text(
                '人员离职或职责变化时及时调整账号。',
                'Update or disable access promptly when responsibilities change.',
            ),
        ],
        tips: [
            text(
                '日常账号不要长期使用超级管理员权限。',
                'Do not use super-administrator access for routine work.',
            ),
        ],
    },
    role: {
        title: text('角色与权限操作说明', 'Role and permission guide'),
        purpose: text(
            '按岗位组合后台权限和可访问的销售渠道。',
            'Group dashboard permissions and sales-channel access by job responsibility.',
        ),
        listSteps: [
            text(
                '优先复用现有角色，避免创建重复角色。',
                'Reuse existing roles when possible to avoid duplicates.',
            ),
            text('进入详情核对权限和销售渠道范围。', 'Open details to review permissions and channel scope.'),
        ],
        detailSteps: [
            text(
                '用岗位名称描述角色，例如“订单客服”。',
                'Name roles after responsibilities, such as Order support.',
            ),
            text(
                '从只读权限开始，再增加确实需要的写入权限。',
                'Start with read access, then add only necessary write permissions.',
            ),
            text('限制角色可访问的销售渠道。', 'Limit the sales channels available to the role.'),
        ],
        tips: [
            text(
                '权限变更会影响所有使用该角色的管理员。',
                'Permission changes affect every administrator assigned to the role.',
            ),
        ],
    },
    shippingMethod: {
        title: text('配送方式操作说明', 'Shipping method guide'),
        purpose: text(
            '配置顾客可选的配送服务、适用条件、运费和履约处理器。',
            'Configure delivery services, eligibility, shipping cost, and fulfilment handling.',
        ),
        listSteps: [
            text('查看启用状态和所属销售渠道。', 'Review enabled status and assigned sales channels.'),
            text(
                '创建后设置资格检查、运费计算和履约处理。',
                'After creation, configure eligibility, cost calculation, and fulfilment.',
            ),
        ],
        detailSteps: [
            text(
                '填写顾客能理解的配送名称和说明。',
                'Enter a customer-friendly delivery name and description.',
            ),
            text('配置适用订单条件和配送区域。', 'Configure eligible order conditions and delivery regions.'),
            text('配置运费并使用测试订单验证。', 'Configure shipping cost and verify it with test orders.'),
        ],
        tips: [
            text(
                '同一订单可能同时满足多个配送方式，注意排序和前台展示。',
                'An order may match multiple methods; review ordering and storefront presentation.',
            ),
        ],
    },
    paymentMethod: {
        title: text('支付方式操作说明', 'Payment method guide'),
        purpose: text(
            '配置顾客可用的支付入口、适用条件和支付处理器。',
            'Configure customer payment options, eligibility, and payment handlers.',
        ),
        listSteps: [
            text('查看启用状态和所属销售渠道。', 'Review enabled status and assigned sales channels.'),
            text(
                '创建后选择支付处理器并填写所需参数。',
                'After creation, choose a payment handler and enter its required parameters.',
            ),
        ],
        detailSteps: [
            text('填写前台显示名称和说明。', 'Enter the storefront name and description.'),
            text('配置资格检查和支付处理器。', 'Configure eligibility and the payment handler.'),
            text(
                '使用测试环境完成支付、取消和退款验证。',
                'Use a test environment to verify payment, cancellation, and refund flows.',
            ),
        ],
        tips: [
            text(
                '密钥、密码和签名信息只能通过安全配置保存。',
                'Store keys, passwords, and signing secrets only through secure configuration.',
            ),
        ],
        warning: text(
            '修改生产支付参数前必须完成测试订单验证。',
            'Complete test-order verification before changing production payment settings.',
        ),
    },
    taxCategory: {
        title: text('税务分类操作说明', 'Tax category guide'),
        purpose: text(
            '按商品税务性质分类，以便匹配不同税率。',
            'Classify products by tax treatment so the correct rates can be applied.',
        ),
        listSteps: [
            text('创建业务需要的税务分类。', 'Create the tax categories required by the business.'),
            text('为商品 SKU 分配正确分类。', 'Assign the correct category to product SKUs.'),
        ],
        detailSteps: [
            text('使用财税人员认可的分类名称。', 'Use category names approved by finance or tax staff.'),
            text('只设置一个默认税务分类。', 'Keep exactly one default tax category.'),
        ],
        tips: [
            text(
                '税务分类本身不包含税率，税率在“税率”页面配置。',
                'A category does not contain rates; configure rates on the Tax rates page.',
            ),
        ],
    },
    taxRate: {
        title: text('税率操作说明', 'Tax rate guide'),
        purpose: text(
            '按税务分类、区域和销售渠道配置实际税率。',
            'Configure actual rates by tax category, zone, and sales channel.',
        ),
        listSteps: [
            text('按分类或区域核对现有税率。', 'Review existing rates by category or zone.'),
            text(
                '创建前确认没有时间和范围重叠的规则。',
                'Before creating a rate, check for overlapping rules.',
            ),
        ],
        detailSteps: [
            text('选择税务分类、区域和适用渠道。', 'Choose the tax category, zone, and sales channels.'),
            text(
                '填写税率并通过测试订单核对含税结果。',
                'Enter the rate and verify tax-inclusive results with a test order.',
            ),
        ],
        tips: [
            text(
                '税率和含税策略应由财税人员确认。',
                'Tax rates and tax-inclusive pricing policy should be approved by finance or tax staff.',
            ),
        ],
    },
    country: {
        title: text('国家或地区操作说明', 'Country and region guide'),
        purpose: text(
            '维护可用于客户地址、区域、税务和配送的国家或地区。启用地区不等于自动允许配送，最终范围由商品类型、配送方式和支付规则共同决定。',
            // eslint-disable-next-line max-len
            'Maintain countries or regions used by customer addresses, zones, tax, and shipping. Enabling a region does not automatically enable delivery; product type, shipping methods, and payment rules determine the final sales coverage.',
        ),
        listSteps: [
            text('按名称或代码查找国家或地区。', 'Find a country or region by name or code.'),
            text(
                '只启用当前业务实际支持的地区。',
                'Enable only the regions currently supported by the business.',
            ),
        ],
        detailSteps: [
            text('核对标准代码和显示名称。', 'Verify the standard code and display name.'),
            text('设置启用状态并加入需要的区域。', 'Set enabled status and add it to the required zones.'),
        ],
        tips: [
            text(
                '停用地区前检查现有地址、配送和税务规则。',
                'Before disabling a region, review existing addresses, shipping, and tax rules.',
            ),
        ],
    },
    zone: {
        title: text('业务区域操作说明', 'Business zone guide'),
        purpose: text(
            '把国家或地区组合成税务、配送和渠道配置可复用的区域。它是业务规则分组，不是独立站的访问地区封锁。',
            // eslint-disable-next-line max-len
            'Group countries or regions for reuse in tax, shipping, and channel settings. A zone groups business rules; it is not a geographic access block for the storefront.',
        ),
        listSteps: [
            text(
                '按业务范围创建区域，例如“中国大陆”。',
                'Create zones that match business scope, such as Mainland China.',
            ),
            text('进入详情维护区域成员。', 'Open details to maintain zone members.'),
        ],
        detailSteps: [
            text('填写清晰的内部名称。', 'Enter a clear internal name.'),
            text('添加国家或地区并保存。', 'Add countries or regions and save.'),
            text(
                '检查该区域关联的税率、配送和渠道。',
                'Review tax, shipping, and channel settings that use the zone.',
            ),
        ],
        tips: [
            text(
                '区域成员变化会同时影响所有引用该区域的规则。',
                'Membership changes affect every rule that references the zone.',
            ),
        ],
    },
    globalSettings: {
        title: text('全局设置操作说明', 'Global settings guide'),
        purpose: text(
            '配置整个系统共享的内容语言、库存策略和全局默认值。',
            'Configure shared content languages, inventory policy, and system-wide defaults.',
        ),
        detailSteps: [
            text('先确认启用的商品内容语言。', 'Confirm the enabled product-content languages.'),
            text('设置库存跟踪和缺货阈值。', 'Configure inventory tracking and out-of-stock threshold.'),
            text(
                '保存后检查各销售渠道是否仍有有效默认值。',
                'After saving, confirm that every sales channel still has valid defaults.',
            ),
        ],
        tips: [
            text(
                '这里的语言用于商品等业务内容，不是后台界面语言。',
                'Languages here apply to business content such as products, not the dashboard interface.',
            ),
        ],
        warning: text(
            '全局设置会影响所有销售渠道，修改前应评估范围。',
            'Global settings affect every sales channel; assess the impact before changing them.',
        ),
    },
    jobQueue: {
        title: text('后台任务操作说明', 'Background task guide'),
        purpose: text(
            '监控导入、搜索索引、邮件等异步任务的执行情况。',
            'Monitor asynchronous work such as imports, search indexing, and email delivery.',
        ),
        listSteps: [
            text('按队列、状态和时间筛选任务。', 'Filter tasks by queue, status, and time.'),
            text('失败时打开任务查看错误和重试次数。', 'Open failed tasks to review errors and retry count.'),
            text('确认根因后再重试或取消。', 'Retry or cancel only after identifying the cause.'),
        ],
        tips: [
            text(
                '任务短暂等待通常是正常现象，持续堆积才需要排查。',
                'Short waits are normal; investigate when tasks continue to accumulate.',
            ),
        ],
        warning: text(
            '取消正在写入数据的任务可能留下未完成结果。',
            'Cancelling a data-writing task may leave incomplete results.',
        ),
    },
    scheduledTasks: {
        title: text('定时任务操作说明', 'Scheduled task guide'),
        purpose: text(
            '查看系统按计划自动运行的维护和业务任务。',
            'Review maintenance and business tasks that run automatically on a schedule.',
        ),
        listSteps: [
            text('查看任务上次和下次运行时间。', 'Review the previous and next run time.'),
            text('出现失败时查看日志和依赖服务。', 'When a task fails, inspect logs and dependent services.'),
            text(
                '手动执行前确认任务可以重复运行。',
                'Before running manually, confirm that the task is safe to repeat.',
            ),
        ],
        tips: [
            text(
                '运行时间按服务器时区计算时，要与运营时区进行换算。',
                'If schedules use server time, account for the operations time zone.',
            ),
        ],
    },
    settingsStore: {
        title: text('系统配置操作说明', 'System configuration guide'),
        purpose: text(
            '查看和维护系统或插件保存的结构化配置项。',
            'Review and maintain structured settings stored by the system or plugins.',
        ),
        listSteps: [
            text('按命名空间找到对应系统或插件。', 'Find the relevant system or plugin namespace.'),
            text(
                '编辑前记录原值并确认字段用途。',
                'Record the previous value and confirm its purpose before editing.',
            ),
            text(
                '保存后验证使用该配置的功能。',
                'After saving, verify the feature that consumes the setting.',
            ),
        ],
        tips: [
            text(
                '只读配置用于展示运行状态，不能在此修改。',
                'Read-only settings display runtime state and cannot be changed here.',
            ),
        ],
        warning: text(
            '不明确的配置不要尝试修改，错误值可能导致插件不可用。',
            'Do not change unfamiliar settings; invalid values may disable a plugin.',
        ),
    },
    apiKey: {
        title: text('API 密钥操作说明', 'API key guide'),
        purpose: text(
            '为服务器对服务器的接口调用创建受限访问凭证。',
            'Create restricted credentials for server-to-server API access.',
        ),
        listSteps: [
            text('按系统或用途分别创建密钥。', 'Create separate keys for each system or purpose.'),
            text('分配最少必要角色并记录负责人。', 'Assign the minimum required roles and record an owner.'),
            text('定期检查最后使用时间并轮换密钥。', 'Review last-used time and rotate keys regularly.'),
        ],
        detailSteps: [
            text('填写可识别的名称并选择角色。', 'Enter an identifiable name and choose roles.'),
            text(
                '创建后立即保存密钥，页面不会再次完整显示。',
                'Save the secret immediately after creation; it will not be shown in full again.',
            ),
            text(
                '在调用方验证后再停用旧密钥。',
                'Verify the new key in the client before disabling the old one.',
            ),
        ],
        tips: [
            text(
                '不要把 API 密钥写入源码、聊天记录或公开文档。',
                'Never put API keys in source code, chat messages, or public documentation.',
            ),
        ],
        warning: text('泄露的密钥必须立即撤销并重新创建。', 'Revoke and replace a leaked key immediately.'),
    },
    profile: {
        title: text('个人资料操作说明', 'Profile guide'),
        purpose: text(
            '维护当前管理员的姓名、登录信息和个人偏好。',
            'Maintain the current administrator name, login details, and preferences.',
        ),
        detailSteps: [
            text('更新姓名或联系方式。', 'Update your name or contact details.'),
            text(
                '需要时修改密码并重新登录验证。',
                'Change your password when needed and verify it by signing in again.',
            ),
        ],
        tips: [
            text(
                '界面语言和显示格式可在左下角用户菜单中调整。',
                'Interface language and regional formatting are available from the user menu.',
            ),
        ],
    },
};

const pageAliases: Array<[string, string]> = [
    ['manage-product-variants', 'productVariant'],
    ['product-variant', 'productVariant'],
    ['option-group-option', 'optionGroup'],
    ['option-group', 'optionGroup'],
    ['facet-value', 'facet'],
    ['facet', 'facet'],
    ['customer-group', 'customerGroup'],
    ['stock-location', 'stockLocation'],
    ['shipping-method', 'shippingMethod'],
    ['payment-method', 'paymentMethod'],
    ['tax-category', 'taxCategory'],
    ['tax-rate', 'taxRate'],
    ['scheduled-tasks', 'scheduledTasks'],
    ['settings-store', 'settingsStore'],
    ['global-settings', 'globalSettings'],
    ['api-key', 'apiKey'],
    ['draft-order', 'order'],
    ['seller-order', 'order'],
    ['order-modification', 'order'],
    ['order-modify', 'order'],
    ['order', 'order'],
    ['administrator', 'administrator'],
    ['collection', 'collection'],
    ['promotion', 'promotion'],
    ['customer', 'customer'],
    ['product', 'product'],
    ['asset', 'asset'],
    ['review', 'review'],
    ['seller', 'seller'],
    ['channel', 'channel'],
    ['role', 'role'],
    ['country', 'country'],
    ['zone', 'zone'],
    ['job-queue', 'jobQueue'],
    ['insights', 'insights'],
    ['profile', 'profile'],
];

export function getPageHelpTopic(pageId?: string) {
    if (!pageId) return undefined;
    const match = pageAliases.find(([prefix]) => pageId.startsWith(prefix));
    return match ? pageHelpTopics[match[1]] : undefined;
}

export function getPageHelpMode(pageId?: string): 'list' | 'detail' {
    return pageId?.endsWith('-list') || pageId === 'asset-list' || pageId === 'insights' ? 'list' : 'detail';
}

export type FieldHelpTopic = {
    title: LocalizedHelpText;
    description: LocalizedHelpText;
    note?: LocalizedHelpText;
};

const fieldHelpTopics: Record<string, FieldHelpTopic> = {
    name: {
        title: text('名称', 'Name'),
        description: text(
            '供运营人员识别，也可能显示给顾客。中文内容应使用自然、明确的业务名称。',
            'Identifies this item for operators and may also be customer-facing. Use a clear business name.',
        ),
    },
    description: {
        title: text('说明内容', 'Description'),
        description: text(
            '说明该项目的用途、适用范围或顾客可见内容。切换内容语言后分别维护中文和英文。',
            'Explains the purpose, scope, or customer-facing content. Maintain Chinese and English separately by switching the content language.',
        ),
    },
    enabled: {
        title: text('启用状态', 'Enabled status'),
        description: text(
            '开启后该配置可以参与业务流程；关闭后保留数据，但不会用于新的业务操作。',
            'When enabled, this configuration can participate in business flows. Disabling it keeps the data but prevents new use.',
        ),
        note: text(
            '关闭前先确认没有正在使用该配置的活动或订单。',
            'Before disabling it, check for active campaigns or orders that use it.',
        ),
    },
    code: {
        title: text('系统代码', 'System code'),
        description: text(
            '供接口、规则和外部系统稳定识别。建议使用小写英文、数字和连字符，保存后尽量不要修改。',
            'A stable identifier used by APIs, rules, and integrations. Prefer lowercase letters, numbers, and hyphens, and avoid changing it after saving.',
        ),
    },
    slug: {
        title: text('URL 标识', 'URL identifier'),
        description: text(
            '用于组成前台页面地址。建议使用简短的小写英文和连字符，例如 summer-sale。',
            'Used to build storefront URLs. Use short lowercase words and hyphens, for example summer-sale.',
        ),
        note: text(
            '修改后可能影响旧链接和搜索引擎收录。',
            'Changing it can break old links and affect search indexing.',
        ),
    },
    sku: {
        title: text('商品 SKU', 'Product SKU'),
        description: text(
            '商品具体销售规格的唯一库存编码，应与 ERP、仓库或供应链系统保持一致。',
            'The unique stock code for a saleable product option. Keep it aligned with ERP, warehouse, or supply-chain systems.',
        ),
    },
    token: {
        title: text('渠道令牌', 'Channel token'),
        description: text(
            '前端或接口请求用它指定销售渠道。它不是登录密码，但仍应保持稳定并避免公开。',
            'Storefronts and API clients use this token to select a sales channel. It is not a password, but it should remain stable and non-public.',
        ),
    },
    defaultLanguageCode: {
        title: text('默认内容语言', 'Default content language'),
        description: text(
            '商品、分组等业务内容缺少当前语言时使用的默认语言。它不会改变后台界面语言。',
            'The fallback language for products, groups, and other business content. It does not change the dashboard interface language.',
        ),
    },
    availableLanguageCodes: {
        title: text('可用内容语言', 'Available content languages'),
        description: text(
            '决定该销售渠道可以维护和读取哪些商品内容语言。至少要包含默认内容语言。',
            'Controls which product-content languages this sales channel can maintain and serve. It must include the default content language.',
        ),
    },
    availableLanguages: {
        title: text('全局内容语言', 'Global content languages'),
        description: text(
            '决定整个系统可以维护哪些业务内容语言，与后台界面中英文切换无关。',
            'Controls which business-content languages the system can maintain. It is separate from the dashboard interface language.',
        ),
    },
    defaultCurrencyCode: {
        title: text('默认交易币种', 'Default transaction currency'),
        description: text(
            '该销售渠道创建价格和订单时优先使用的币种，必须包含在可用币种中。',
            'The preferred currency for prices and orders in this sales channel. It must be included in available currencies.',
        ),
    },
    availableCurrencyCodes: {
        title: text('可用币种', 'Available currencies'),
        description: text(
            '该销售渠道允许定价和结算的币种范围。删除前先检查已有价格和订单。',
            'Currencies available for pricing and checkout in this sales channel. Review existing prices and orders before removing one.',
        ),
    },
    pricesIncludeTax: {
        title: text('价格是否含税', 'Tax-inclusive prices'),
        description: text(
            '开启后录入价格视为含税价；关闭后视为未税价。应与财税和前台展示规则保持一致。',
            'When enabled, entered prices include tax; otherwise they exclude tax. Keep this aligned with finance and storefront display rules.',
        ),
    },
    value: {
        title: text('配置数值', 'Configuration value'),
        description: text(
            '填写该规则实际使用的数值。百分比字段按百分数填写，例如 6 表示 6%。',
            'Enter the value used by this rule. For percentage fields, enter 6 to represent 6%.',
        ),
    },
    categoryId: {
        title: text('税费分类', 'Tax category'),
        description: text(
            '选择这条税率适用的商品税费分类。实体商品和虚拟商品可以使用不同分类。',
            'Select the product tax category covered by this rate. Physical and digital products may use different categories.',
        ),
    },
    zoneId: {
        title: text('适用地区', 'Applicable zone'),
        description: text(
            '选择税率或业务规则适用的国家和地区组合。当不同司法辖区的税率或配送规则不同时，应分开建立区域。',
            'Select the countries and regions covered by this tax or business rule. Create separate zones when tax or shipping rules differ between jurisdictions.',
        ),
    },
    startsAt: {
        title: text('开始时间', 'Start time'),
        description: text(
            '到达此时间后活动才会生效。留空表示保存并启用后立即生效。',
            'The campaign becomes active at this time. Leave empty to start as soon as it is saved and enabled.',
        ),
    },
    endsAt: {
        title: text('结束时间', 'End time'),
        description: text(
            '到达此时间后活动自动停止。留空表示长期有效，直到人工关闭。',
            'The campaign stops automatically at this time. Leave empty to keep it active until manually disabled.',
        ),
    },
    couponCode: {
        title: text('优惠码', 'Coupon code'),
        description: text(
            '顾客在结算时输入的活动代码。留空时，满足条件的订单自动参加活动。',
            'A code customers enter during checkout. Leave empty to apply the campaign automatically when its conditions are met.',
        ),
    },
    perCustomerUsageLimit: {
        title: text('每位顾客限用次数', 'Per-customer usage limit'),
        description: text(
            '限制同一顾客最多使用该活动的次数。游客订单可能无法可靠识别为同一顾客。',
            'Limits how many times one customer can use the campaign. Guest orders may not be reliably identified as the same customer.',
        ),
    },
    usageLimit: {
        title: text('活动总使用次数', 'Total usage limit'),
        description: text(
            '限制该活动在全部订单中的累计使用次数。达到上限后不再应用。',
            'Limits total uses across all orders. The campaign stops applying when this limit is reached.',
        ),
    },
    conditions: {
        title: text('生效条件', 'Eligibility conditions'),
        description: text(
            '订单必须满足这些条件，优惠或业务规则才会执行。多个条件的组合关系需要逐项确认。',
            'The order must satisfy these conditions before the promotion or business rule runs. Review how multiple conditions are combined.',
        ),
    },
    actions: {
        title: text('执行结果', 'Actions'),
        description: text(
            '订单满足条件后执行的优惠或业务动作，例如订单折扣、商品折扣或免运费。',
            'The discount or business action applied after conditions are met, such as an order discount, item discount, or free shipping.',
        ),
    },
    fulfillmentHandler: {
        title: text('履约处理方式', 'Fulfillment handler'),
        description: text(
            '决定订单如何完成交付。实体商品通常走物流发货，虚拟商品使用数字内容交付。',
            'Controls how orders are delivered. Physical products normally use shipment fulfilment; digital products use digital delivery.',
        ),
    },
    checker: {
        title: text('可用条件判断', 'Eligibility checker'),
        description: text(
            '决定当前订单是否可以使用这项配送或支付方式，例如按地区、订单金额或商品类型判断。',
            'Determines whether the current order can use this shipping or payment method based on region, order value, or product type.',
        ),
    },
    calculator: {
        title: text('费用计算规则', 'Fee calculator'),
        description: text(
            '根据订单和配送条件计算费用。虚拟商品不应进入实体配送费用计算。',
            'Calculates the fee from order and delivery conditions. Digital products must not be included in physical shipping charges.',
        ),
    },
    handler: {
        title: text('支付处理器', 'Payment handler'),
        description: text(
            '负责创建支付、接收支付结果并处理退款。测试处理器不能用于正式环境。',
            'Creates payments, receives payment results, and handles refunds. Test handlers must not be used in production.',
        ),
        note: text(
            '更换处理器前必须确认已存在订单和退款流程。',
            'Review existing orders and refund flows before changing the handler.',
        ),
    },
    trackInventory: {
        title: text('库存跟踪', 'Inventory tracking'),
        description: text(
            '开启后系统会根据库存和订单分配判断是否可售；关闭后通常不限制可售数量。',
            'When enabled, availability is calculated from stock and allocations. When disabled, sale quantity is usually unrestricted.',
        ),
    },
    outOfStockThreshold: {
        title: text('缺货阈值', 'Out-of-stock threshold'),
        description: text(
            '可售库存等于或低于该数值时视为缺货，可用于预留安全库存。',
            'A SKU is treated as out of stock when saleable inventory reaches this value or lower. Use it to reserve safety stock.',
        ),
    },
    stockOnHand: {
        title: text('实际库存', 'Stock on hand'),
        description: text(
            '仓库记录的实物数量。系统还会扣除已分配库存后计算可售库存。',
            'The physical quantity recorded at the warehouse. Allocated stock is deducted to calculate saleable inventory.',
        ),
    },
};

function normalizeFieldName(fieldName: string) {
    const segments = fieldName.split('.').filter(segment => !/^\d+$/.test(segment));
    return segments.at(-1) ?? fieldName;
}

export function getFieldHelpTopic(fieldName: string) {
    return fieldHelpTopics[normalizeFieldName(fieldName)];
}
