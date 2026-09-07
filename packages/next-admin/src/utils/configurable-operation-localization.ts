export interface ConfigurableArgumentDefinitionLike {
    name: string;
    type: string;
    list?: boolean;
    required?: boolean;
    defaultValue?: unknown;
    label?: string | null;
    description?: string | null;
    ui?: unknown;
}

export interface ConfigurableOperationDefinitionLike {
    code: string;
    description?: string | null;
    args: ConfigurableArgumentDefinitionLike[];
}

interface SelectOption {
    value: string;
    label: string;
}

const argumentLabels: Record<string, string> = {
    amount: '金额',
    automaticsettle: '自动结算',
    allowedcountrycodes: '允许配送的国家代码',
    baserate: '基础运费',
    blockedpostalprefixes: '不配送的邮编前缀',
    collectionids: '商品分类',
    combinewithand: '与其他规则同时满足',
    containsany: '任意匹配',
    countrycode: '国家代码',
    currencycode: '币种',
    discount: '减免金额',
    estimatemaxdays: '预计最多配送天数',
    estimatemindays: '预计最少配送天数',
    facetvalueids: '筛选属性值',
    freeabove: '免邮门槛',
    includestax: '税费计算方式',
    operator: '匹配方式',
    orderminimum: '最低订单金额',
    percentage: '百分比',
    priceincludestax: '运费是否含税',
    productids: '商品',
    rate: '运费金额',
    taxinclusive: '按含税金额判断',
    taxrate: '税率',
    term: '名称关键词',
    variantids: '商品 SKU',
    variantrules: '秒杀商品价格规则',
};

const operationArgumentLabels: Record<string, string> = {
    'store_currency_minimum_order_amount.amount': '最低商品小计',
    'store_currency_minimum_order_amount.currencyCode': '金额币种',
    'store_currency_minimum_order_amount.taxInclusive': '按含税商品小计判断',
    'store_currency_order_fixed_discount.discount': '固定减免金额',
    'store_currency_order_fixed_discount.currencyCode': '减免金额币种',
};

const argumentDescriptions: Record<string, string> = {
    amount: '填写规则要求的金额。',
    automaticsettle: '开启后，付款记录会直接进入已结算状态。',
    allowedcountrycodes: '填写允许配送的两位国家代码。',
    blockedpostalprefixes: '填写不支持配送的邮编开头；留空表示不限制。',
    collectionids: '每行填写一个商品分类 ID。',
    combinewithand: '开启后，此规则必须与其他规则同时满足。',
    containsany: '开启后，满足任意一个所选值即可命中。',
    currencycode: '填写三位币种代码，例如 MYR。',
    discount: '填写需要减免的金额。',
    facetvalueids: '每行填写一个筛选属性值 ID。',
    operator: '选择名称关键词的匹配方式。',
    percentage: '填写百分比数值，例如 10 表示 10%。',
    productids: '每行填写一个商品 ID。',
    taxinclusive: '开启后，使用含税商品小计判断是否满足条件。',
    term: '填写需要匹配的名称文字。',
    variantids: '每行填写一个商品 SKU ID。',
};

const operationLabels: Record<string, string> = {
    'default-shipping-calculator': '按固定金额收取运费',
    'default-shipping-eligibility-checker': '订单商品小计达到指定金额',
    'dummy-payment-handler': '测试支付方式',
    'facet-value-filter': '按筛选属性值匹配商品 SKU',
    minimum_order_amount: '订单商品小计达到指定金额',
    order_fixed_discount: '订单商品小计固定金额立减',
    order_percentage_discount: '订单商品小计按比例减免',
    'physical-subtotal-shipping-calculator': '按实物商品小计计算运费',
    'product-id-filter': '手动选择商品',
    store_collection_percentage_discount: '指定商品分类按比例减免',
    store_currency_minimum_order_amount: '订单商品小计达到指定币种金额',
    store_currency_order_fixed_discount: '订单按指定币种固定金额立减',
    store_customer_coupon_entitlement: '客户已领取并在当前订单使用此优惠券',
    store_flash_sale_price: '指定商品按限时秒杀价结算',
    'supported-destination-eligibility-checker': '限制配送国家和邮编范围',
    'variant-id-filter': '手动选择商品 SKU',
    'variant-name-filter': '按商品 SKU 名称筛选',
};

const optionLabels: Record<string, string> = {
    auto: '跟随店铺设置',
    contains: '包含',
    doesnotcontain: '不包含',
    endswith: '结尾是',
    exclude: '金额未税',
    false: '否',
    include: '金额含税',
    startswith: '开头是',
    true: '是',
};

const operationArgumentDescriptions: Record<string, string> = {
    'store_currency_minimum_order_amount.amount': '按所选币种的最小货币单位填写，例如 100 表示 1.00。',
    'store_currency_minimum_order_amount.currencyCode': '填写该门槛金额使用的三位币种代码，例如 MYR。',
    'store_currency_minimum_order_amount.taxInclusive': '开启后，使用含税商品小计判断是否达到门槛。',
    'store_currency_order_fixed_discount.discount': '按所选币种的最小货币单位填写，例如 100 表示减免 1.00。',
    'store_currency_order_fixed_discount.currencyCode': '填写减免金额使用的三位币种代码，例如 MYR。',
};

export const normalizeConfigurableIdentifier = (value: string) =>
    value.replace(/[^a-z0-9]/giu, '').toLowerCase();

const hasChinese = (value?: string | null) => Boolean(value && /\p{Script=Han}/u.test(value));

export function configurableUiRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function localizedOptionText(value: unknown, fallbackValue: string, index: number): string {
    if (Array.isArray(value)) {
        const translations = value.flatMap(item =>
            item && typeof item === 'object' ? [item as Record<string, unknown>] : [],
        );
        const chinese = translations.find(item =>
            ['zh_hans', 'zh_cn', 'zh'].includes(String(item.languageCode ?? '').toLowerCase()),
        );
        if (typeof chinese?.value === 'string' && chinese.value.trim()) return chinese.value.trim();
    }
    if (typeof value === 'string' && hasChinese(value)) return value.trim();
    return optionLabels[normalizeConfigurableIdentifier(fallbackValue)] ?? `选项 ${index + 1}`;
}

export function configurableArgumentLabel(
    definition: ConfigurableArgumentDefinitionLike,
    operationCode?: string,
): string {
    const operationLabel = operationArgumentLabels[`${operationCode ?? ''}.${definition.name}`];
    if (operationLabel) return operationLabel;
    if (hasChinese(definition.label)) return definition.label!.trim();
    const knownLabel = argumentLabels[normalizeConfigurableIdentifier(definition.name)];
    if (knownLabel) return knownLabel;
    const type = definition.type.toLowerCase();
    if (definition.list) return '列表参数';
    if (type.includes('boolean')) return '开关选项';
    if (type.includes('password')) return '安全凭据';
    if (['int', 'float', 'money', 'number'].some(item => type.includes(item))) return '数值参数';
    if (type.includes('date')) return '日期时间';
    if (type === 'id') return '关联对象';
    return '文本参数';
}

export function configurableArgumentDescription(
    definition: ConfigurableArgumentDefinitionLike,
    operationCode?: string,
): string | null {
    const operationDescription = operationArgumentDescriptions[`${operationCode ?? ''}.${definition.name}`];
    if (operationDescription) return operationDescription;
    if (hasChinese(definition.description)) {
        const suffix = definition.list ? '每行填写一项。' : '';
        return [definition.description!.trim(), suffix].filter(Boolean).join(' ');
    }
    const knownDescription = argumentDescriptions[normalizeConfigurableIdentifier(definition.name)];
    if (knownDescription) return knownDescription;
    if (definition.list) return '每行填写一项。';
    const ui = configurableUiRecord(definition.ui);
    if (ui?.component === 'currency-form-input') {
        return '按最小货币单位填写，例如 100 表示 1.00。';
    }
    if (ui?.suffix === '%') return '填写百分比数值，例如 10 表示 10%。';
    return null;
}

export function configurableArgumentOptions(definition: ConfigurableArgumentDefinitionLike): SelectOption[] {
    const options = configurableUiRecord(definition.ui)?.options;
    if (!Array.isArray(options)) return [];
    return options.flatMap((option, index) => {
        if (!option || typeof option !== 'object') return [];
        const record = option as Record<string, unknown>;
        if (record.value == null) return [];
        const value = String(record.value);
        return [{ value, label: localizedOptionText(record.label, value, index) }];
    });
}

export function configurableOperationLabel(
    definition: ConfigurableOperationDefinitionLike,
    fallback = '服务端规则',
): string {
    const base = hasChinese(definition.description)
        ? definition.description!.trim()
        : (operationLabels[definition.code] ?? fallback);
    return base
        .replace(/\{\s*([A-Za-z0-9_.-]+)\s*\}/gu, (_match, name: string) => {
            const argument = definition.args.find(item => item.name === name);
            return `「${
                argument
                    ? configurableArgumentLabel(argument, definition.code)
                    : (argumentLabels[normalizeConfigurableIdentifier(name)] ?? '配置值')
            }」`;
        })
        .replace(/\s+「/gu, '「');
}

export function configurableListValueForDisplay(value: string): string {
    if (!value.trim()) return '';
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return value;
        return parsed.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
    } catch {
        return value;
    }
}

export function serializeConfigurableListValue(value: string, type: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '[]';
    let entries: unknown[];
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        entries = Array.isArray(parsed) ? parsed : trimmed.split(/\r?\n/u);
    } catch {
        entries = value.split(/\r?\n/u);
    }
    const normalizedType = type.toLowerCase();
    const normalized = entries
        .map(item => (typeof item === 'string' ? item.trim() : item))
        .filter(item => item !== '')
        .map(item => {
            if (normalizedType.includes('boolean')) {
                if (item === true || item === 'true' || item === '是') return true;
                if (item === false || item === 'false' || item === '否') return false;
                throw new Error(`“${String(item)}”不是有效的是/否选项`);
            }
            if (['int', 'float', 'money', 'number'].some(typeName => normalizedType.includes(typeName))) {
                const numeric = Number(item);
                if (!Number.isFinite(numeric)) throw new Error(`“${String(item)}”不是有效数字`);
                if (normalizedType.includes('int') && !Number.isInteger(numeric)) {
                    throw new Error(`“${String(item)}”不是有效整数`);
                }
                return numeric;
            }
            return String(item);
        });
    return JSON.stringify(normalized);
}
