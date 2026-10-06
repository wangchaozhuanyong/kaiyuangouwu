import type { EntityCustomFieldsDefinition } from '../../src/custom-fields/custom-field-types';

// Local visual sample, copied from the approved design proposal's public merchandising content.
// Every entity ID is synthetic. This module contains no production API client or customer data.
export const productEditorDesignContent = {
    name: 'Codex Pro $100订阅|1个月',
    slug: 'codexchatgpt-pro-100订阅代充1个月',
    variantName: 'Codex|ChatGPT Pro $100订阅代充|1个月 · 1个月',
    sku: 'MY-CODEX-PRO100-M1',
    description: `使用说明及售后质保规则
一、商品与服务说明
1. 本商品为 ChatGPT 订阅代充服务，服务周期为一个月，具体套餐以订单约定为准
2. 套餐功能、Codex 权益及使用额度以官方账号页面为准；API 调用费用另计
3. 官方参考价格以官方公布信息为准，本商品实际售价以订单页面为准
4. 本商品为数字服务，无需物流。下单后由客服核对账号、地区及可用套餐，再安排人工处理。请勿在订单备注中填写密码
二、使用注意事项
1. 账号仅限本人使用，请勿多人共享、转借或多人同时登录
2. 请勿频繁切换 IP 地址或进行异常多设备登录，以免触发平台风控
3. 请妥善保管账号信息，并遵守平台使用规范，勿进行破解、绕过平台限制或其他违规违法操作
三、质保期限与范围
1. 质保期限自订阅开始生效之日起计算，共30天
2. 质保仅涵盖正常使用情况下，在约定订阅有效期内出现的订阅掉失或提前失效问题。订阅正常到期不属于质保范围
3. 质保期内，经核实符合上述范围的，按已使用天数扣除相应费用，退还剩余未使用天数对应的金额
四、退款计算方式
已使用天数按订阅开始生效之日起至订阅提前失效时经过的天数计算，不按实际登录或使用次数计算
退款金额＝购买金额÷30×（30－已使用天数）
例如：购买金额为900元，订阅生效后第10天出现符合质保范围的订阅失效问题，剩余20天：
900÷30×（30－10）＝600元
即可退还600元
五、不属于质保范围的情况
因个人违规操作、多人共享、账号转借、个人原因造成的账号信息泄露或被盗，以及破解、绕过平台限制、诈骗、攻击或其他违规违法行为，导致账号触发风控、冻结、封禁或停用的，不属于本服务质保范围
六、售后处理
如遇订阅异常，请及时联系客服，并提供订单信息及异常页面截图，便于核实处理。符合上述质保范围的问题，按本规则办理售后`,
    imageUrl: new URL('./assets/product-editor-design-codex.png', import.meta.url).href,
};

export const productEditorDesignCategories = [
    ['Codex订阅', 'gpt订阅'],
    ['Claude订阅', 'claude订阅'],
    ['Gemini订阅', 'gemini订阅'],
    ['Grok订阅', 'grok订阅-2'],
    ['苹果ID', '苹果id'],
    ['谷歌账号', '谷歌账号'],
    ['GPT成品', 'chatgpt-accounts'],
    ['中转站充值', '中专站充值'],
    ['模钥商品整理组', 'moyao-catalog-organizing'],
];

export const productEditorDesignFacets = [
    ['Ai会员订阅', 'ai会员订阅', ['GPT订阅', 'Gemini订阅', 'Claude订阅', 'Grok订阅']],
    ['成品账号', 'gpt', ['谷歌账号', '苹果账号']],
    ['中转站', '中转站', ['小额', '中额', '大额']],
    ['导入分类标记', 'catalog-import-category-store-5', ['ChatGPT成品', '模钥商品整理组']],
    ['导入一级分类标记', 'catalog-import-primary-category-store-5', ['ChatGPT成品', '模钥商品整理组']],
].map(([name, code, values], index) => ({
    __typename: 'Facet',
    id: `design-facet-${index}`,
    name: name as string,
    code: code as string,
    isPrivate: false,
    translations: [{ languageCode: 'zh_Hans', name: name as string }],
    values: (values as string[]).map((value, valueIndex) => ({
        __typename: 'FacetValue',
        id: `design-facet-${index}-${valueIndex}`,
        name: value,
        code: `${code}-${valueIndex}`,
        facet: { id: `design-facet-${index}`, name, code },
        translations: [{ languageCode: 'zh_Hans', name: value }],
    })),
}));

// Existing schema fields only; these definitions reproduce the proposal's expanded sections.
export const productEditorDesignCustomFields: EntityCustomFieldsDefinition[] = [
    {
        entityName: 'Product',
        customFields: [
            {
                __typename: 'DateTimeCustomFieldConfig',
                name: 'sourceCreatedAt',
                type: 'datetime',
                list: false,
                nullable: true,
                label: [{ languageCode: 'zh_Hans', value: '来源创建日期' }],
            },
            {
                __typename: 'StringCustomFieldConfig',
                name: 'pricingMode',
                type: 'string',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '销售方式' }],
                options: [
                    { value: 'FIXED', label: [{ languageCode: 'zh_Hans', value: '标价销售' }] },
                    {
                        value: 'QUOTE_ONLY',
                        label: [{ languageCode: 'zh_Hans', value: '展示并联系客服询价（不可下单）' }],
                    },
                ],
            },
        ],
    },
    {
        entityName: 'ProductVariant',
        customFields: [
            {
                __typename: 'StringCustomFieldConfig',
                name: 'specification',
                type: 'string',
                list: false,
                nullable: true,
                label: [{ languageCode: 'zh_Hans', value: '规格' }],
            },
        ],
    },
];
