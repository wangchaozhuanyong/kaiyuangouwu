import type { ConfigurableOperationDefinitionRecord } from '../../graphql/management.graphql';
import { configurableOperationLabel } from '../../utils/configurable-operation-localization';

export const SHIPPING_PRESETS = [
    {
        key: 'standard-threshold' as const,
        title: '标准快递（满额免邮）',
        badge: '推荐 · 单条搞定',
        description: '基础运费 5.00，满 200.00 自动免邮。单条规则搞定，买家达标即享 0 元包邮。',
    },
    {
        key: 'pickup-in-store' as const,
        title: '上门自提（门店取货）',
        badge: '0 元自提',
        description: '买家到店提货免运费。与标准快递并列展示，供客户自主选择。',
    },
    {
        key: 'free-shipping' as const,
        title: '全场包邮（固定免运）',
        badge: '全场 0 元',
        description: '所有商品直接免运费，适合包邮店铺或免邮活动。',
    },
];

export function parseArgNumericValue(value: string | undefined): number | null {
    if (value === undefined || value === null || value === '') return null;
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    } catch {}
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

export function parseArgStringValue(value: string | undefined): string {
    if (!value) return '';
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') return parsed;
    } catch {}
    return value;
}

export function formatMoneyCents(cents: number, currencyCode?: string): string {
    const formatted = (cents / 100).toFixed(2);
    return currencyCode ? `${formatted} ${currencyCode}` : formatted;
}

export function formatShippingCalculatorSummary(
    calculator?: { code: string; args?: Array<{ name: string; value: string }> } | null,
    currencyCode = '',
): string {
    if (!calculator) return '未配置计算器';
    const argsMap = new Map((calculator.args ?? []).map(a => [a.name, a.value]));

    if (calculator.code === 'physical-subtotal-shipping-calculator') {
        const baseRate = parseArgNumericValue(argsMap.get('baseRate'));
        const freeAbove = parseArgNumericValue(argsMap.get('freeAbove'));
        const configCurr = parseArgStringValue(argsMap.get('currencyCode')) || currencyCode;

        const baseText =
            baseRate != null ? `基础运费: ${formatMoneyCents(baseRate, configCurr)}` : '实物基础运费';
        if (freeAbove != null && freeAbove > 0) {
            return `${baseText} · 满 ${formatMoneyCents(freeAbove, configCurr)} 免邮`;
        }
        return baseText;
    }

    if (calculator.code === 'default-shipping-calculator') {
        const rate = parseArgNumericValue(argsMap.get('rate'));
        if (rate === 0) {
            return '全场免运费 (0.00)';
        }
        if (rate != null) {
            return `固定运费: ${formatMoneyCents(rate, currencyCode)}`;
        }
        return '按固定金额收取运费';
    }

    return configurableOperationLabel(
        { code: calculator.code, args: [] } as unknown as ConfigurableOperationDefinitionRecord,
        '运费计算器',
    );
}

export function formatShippingCheckerSummary(
    checker?: { code: string; args?: Array<{ name: string; value: string }> } | null,
): string {
    if (!checker || checker.code === 'default-shipping-eligibility-checker') {
        return '全场通用';
    }
    const argsMap = new Map((checker.args ?? []).map(a => [a.name, a.value]));
    if (checker.code === 'supported-destination-eligibility-checker') {
        const countries = parseArgStringValue(argsMap.get('allowedCountryCodes'));
        if (countries) {
            return `仅限配送: ${countries.trim()}`;
        }
        return '限制配送范围';
    }
    if (checker.code === 'has-physical-order-items' || checker.code === 'order-has-physical-goods-checker') {
        return '仅限实物商品';
    }
    return configurableOperationLabel(
        { code: checker.code, args: [] } as unknown as ConfigurableOperationDefinitionRecord,
        '资格检查器',
    );
}

export function formatFulfillmentHandlerSummary(
    code: string,
    definitions: ConfigurableOperationDefinitionRecord[] = [],
): string {
    const def = definitions.find(d => d.code === code);
    if (def) {
        return configurableOperationLabel(def, '履约方式');
    }
    if (code === 'manual-fulfillment') {
        return '手动履约';
    }
    return code;
}
