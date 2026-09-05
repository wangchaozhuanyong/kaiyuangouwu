export interface BusinessChoice {
    value: string;
    label: string;
}

export const BUSINESS_LANGUAGE_CHOICES: BusinessChoice[] = [
    { value: 'zh_Hans', label: '简体中文' },
    { value: 'en', label: 'English' },
];

const preferredCurrencyCodes = [
    'MYR',
    'CNY',
    'USD',
    'SGD',
    'AUD',
    'EUR',
    'GBP',
    'JPY',
    'KRW',
    'THB',
    'IDR',
    'PHP',
    'VND',
];
const currencyCodesNotInCurrentVendure = new Set(['SLE', 'XCG', 'XDR', 'XSU', 'ZWG']);
const browserCurrencyCodes =
    typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('currency')
        : preferredCurrencyCodes;
const currencyDisplayNames = new Intl.DisplayNames(['zh-CN'], { type: 'currency' });

export const BUSINESS_CURRENCY_CHOICES: BusinessChoice[] = [
    ...preferredCurrencyCodes,
    ...browserCurrencyCodes.filter(code => !preferredCurrencyCodes.includes(code)),
]
    .filter(code => !currencyCodesNotInCurrentVendure.has(code))
    .map(value => ({ value, label: currencyDisplayNames.of(value) ?? value }));

export interface CountryPreset {
    code: string;
    name: string;
}

export const COUNTRY_PRESETS: CountryPreset[] = [
    { code: 'MY', name: '马来西亚' },
    { code: 'CN', name: '中国' },
    { code: 'SG', name: '新加坡' },
    { code: 'TH', name: '泰国' },
    { code: 'ID', name: '印度尼西亚' },
    { code: 'PH', name: '菲律宾' },
    { code: 'VN', name: '越南' },
    { code: 'JP', name: '日本' },
    { code: 'KR', name: '韩国' },
    { code: 'AU', name: '澳大利亚' },
    { code: 'US', name: '美国' },
    { code: 'GB', name: '英国' },
];

export const TAX_CATEGORY_PRESETS: BusinessChoice[] = [
    { value: '标准商品', label: '标准商品（适合大多数实体商品）' },
    { value: '数字商品', label: '数字商品（卡密、软件或数字内容）' },
    { value: '服务', label: '服务（人工或订阅服务）' },
    { value: '免税商品', label: '免税商品（仍需配置 0% 税率）' },
];

export function businessChoiceLabel(value: string, choices: readonly BusinessChoice[]): string {
    const choice = choices.find(item => item.value === value);
    return choice ? `${choice.label}（${choice.value}）` : value;
}
