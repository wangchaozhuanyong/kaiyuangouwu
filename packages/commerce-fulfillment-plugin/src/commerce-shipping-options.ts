import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Order, ShippingCalculator, ShippingEligibilityChecker } from '@vendure/core';
import { convertChannelAmount } from '@vendure/store-management-plugin/currency-conversion';

import { getOrderLineFulfillmentType } from './fulfillment-classification';

export function physicalOrderSubtotalWithTax(order: Pick<Order, 'lines'>): number {
    return order.lines
        .filter(line => getOrderLineFulfillmentType(line) === 'physical')
        .reduce((total, line) => total + line.discountedLinePriceWithTax, 0);
}

export function physicalOrderQuantity(order: Pick<Order, 'lines'>): number {
    return order.lines
        .filter(line => getOrderLineFulfillmentType(line) === 'physical')
        .reduce((total, line) => total + line.quantity, 0);
}

export function splitConfigurationList(value: string): string[] {
    return value
        .split(/[\s,;]+/u)
        .map(item => item.trim().toUpperCase())
        .filter(Boolean);
}

export const physicalSubtotalShippingCalculator = new ShippingCalculator({
    code: 'physical-subtotal-shipping-calculator',
    description: [
        {
            languageCode: LanguageCode.zh_Hans,
            value: '仅按实物商品小计计算固定运费和免邮门槛',
        },
        {
            languageCode: LanguageCode.en,
            value: 'Fixed shipping with a free-shipping threshold based on physical items only',
        },
    ],
    args: {
        baseRate: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '基础运费' },
                { languageCode: LanguageCode.en, value: 'Base shipping rate' },
            ],
        },
        freeAbove: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '实物商品免邮门槛' },
                { languageCode: LanguageCode.en, value: 'Free above physical subtotal' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '设为 0 表示不启用免邮' },
                { languageCode: LanguageCode.en, value: 'Set to 0 to disable free shipping' },
            ],
        },
        currencyCode: {
            type: 'string',
            defaultValue: '',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '运费配置币种' },
                { languageCode: LanguageCode.en, value: 'Shipping configuration currency' },
            ],
        },
        taxRate: {
            type: 'float',
            defaultValue: 0,
            ui: { component: 'number-form-input', suffix: '%', min: 0 },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '运费税率' },
                { languageCode: LanguageCode.en, value: 'Shipping tax rate' },
            ],
        },
        priceIncludesTax: {
            type: 'boolean',
            defaultValue: false,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '运费已含税' },
                { languageCode: LanguageCode.en, value: 'Shipping price includes tax' },
            ],
        },
        estimateMinDays: {
            type: 'int',
            defaultValue: 1,
            ui: { component: 'number-form-input', min: 0 },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '预计最少天数' },
                { languageCode: LanguageCode.en, value: 'Minimum delivery days' },
            ],
        },
        estimateMaxDays: {
            type: 'int',
            defaultValue: 3,
            ui: { component: 'number-form-input', min: 0 },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '预计最多天数' },
                { languageCode: LanguageCode.en, value: 'Maximum delivery days' },
            ],
        },
    },
    calculate: (ctx, order, args) => {
        const physicalSubtotalWithTax = physicalOrderSubtotalWithTax(order);
        const sourceCurrency = (args.currencyCode ||
            ctx.channel.defaultCurrencyCode) as typeof ctx.currencyCode;
        const baseRate = convertChannelAmount(ctx, args.baseRate, sourceCurrency, ctx.currencyCode);
        const freeAbove = convertChannelAmount(ctx, args.freeAbove, sourceCurrency, ctx.currencyCode);
        if (baseRate == null || freeAbove == null) {
            throw new Error('运费币种汇率配置无效');
        }
        const freeShippingApplied = freeAbove > 0 && physicalSubtotalWithTax >= freeAbove;
        return {
            price: freeShippingApplied ? 0 : baseRate,
            taxRate: args.taxRate,
            priceIncludesTax: args.priceIncludesTax,
            metadata: {
                physicalSubtotalWithTax,
                physicalQuantity: physicalOrderQuantity(order),
                freeShippingThreshold: freeAbove,
                freeShippingApplied,
                estimateMinDays: Math.max(0, args.estimateMinDays),
                estimateMaxDays: Math.max(args.estimateMinDays, args.estimateMaxDays),
            },
        };
    },
});

export const supportedDestinationEligibilityChecker = new ShippingEligibilityChecker({
    code: 'supported-destination-eligibility-checker',
    description: [
        {
            languageCode: LanguageCode.zh_Hans,
            value: '限制配送国家，并排除不支持的邮编前缀',
        },
        {
            languageCode: LanguageCode.en,
            value: 'Restrict delivery countries and block unsupported postal-code prefixes',
        },
    ],
    args: {
        allowedCountryCodes: {
            type: 'string',
            defaultValue: '',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '允许的国家代码' },
                { languageCode: LanguageCode.en, value: 'Allowed country codes' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '使用逗号分隔，例如 MY,SG' },
                { languageCode: LanguageCode.en, value: 'Comma separated, for example MY,SG' },
            ],
        },
        blockedPostalPrefixes: {
            type: 'string',
            defaultValue: '',
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '不配送的邮编前缀' },
                { languageCode: LanguageCode.en, value: 'Blocked postal-code prefixes' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '使用逗号分隔；留空表示不限制' },
                { languageCode: LanguageCode.en, value: 'Comma separated; leave empty for no restriction' },
            ],
        },
    },
    check: (ctx, order, args) => {
        if (physicalOrderQuantity(order) === 0) {
            return false;
        }
        const countryCode = order.shippingAddress?.countryCode?.trim().toUpperCase();
        if (!countryCode) {
            return false;
        }
        const allowedCountries = splitConfigurationList(args.allowedCountryCodes);
        if (allowedCountries.length && !allowedCountries.includes(countryCode)) {
            return false;
        }
        const postalCode = order.shippingAddress?.postalCode?.replace(/\s+/gu, '').toUpperCase() ?? '';
        const blockedPrefixes = splitConfigurationList(args.blockedPostalPrefixes).map(prefix =>
            prefix.replace(/\s+/gu, ''),
        );
        return !blockedPrefixes.some(prefix => postalCode.startsWith(prefix));
    },
});
