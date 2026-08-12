import { LanguageCode } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';

import { ShippingCalculator } from './shipping-calculator';

export enum TaxSetting {
    include = 'include',
    exclude = 'exclude',
    auto = 'auto',
}

export const defaultShippingCalculator = new ShippingCalculator({
    code: 'default-shipping-calculator',
    description: [
        { languageCode: LanguageCode.en, value: 'Charge a fixed shipping rate' },
        { languageCode: LanguageCode.zh_Hans, value: '按固定金额收取运费' },
    ],
    args: {
        rate: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Shipping charge' },
                { languageCode: LanguageCode.zh_Hans, value: '运费金额' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Fixed shipping charge applied to eligible orders.' },
                { languageCode: LanguageCode.zh_Hans, value: '符合配送条件的订单统一收取此金额。' },
            ],
        },
        includesTax: {
            type: 'string',
            defaultValue: TaxSetting.auto,
            ui: {
                component: 'select-form-input',
                options: [
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Tax included' },
                            { languageCode: LanguageCode.zh_Hans, value: '金额含税' },
                        ],
                        value: TaxSetting.include,
                    },
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Tax excluded' },
                            { languageCode: LanguageCode.zh_Hans, value: '金额未税' },
                        ],
                        value: TaxSetting.exclude,
                    },
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Follow sales channel setting' },
                            { languageCode: LanguageCode.zh_Hans, value: '跟随销售渠道设置' },
                        ],
                        value: TaxSetting.auto,
                    },
                ],
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Tax treatment' },
                { languageCode: LanguageCode.zh_Hans, value: '税费计算方式' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Specify whether the shipping charge already includes tax.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '设置运费金额是否已经包含税费。' },
            ],
        },
        taxRate: {
            type: 'float',
            defaultValue: 0,
            ui: { component: 'number-form-input', suffix: '%', min: 0 },
            label: [
                { languageCode: LanguageCode.en, value: 'Shipping tax rate' },
                { languageCode: LanguageCode.zh_Hans, value: '运费税率' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Tax percentage applied to the shipping charge.' },
                { languageCode: LanguageCode.zh_Hans, value: '应用于运费金额的税率。' },
            ],
        },
    },
    calculate: (ctx, order, args) => {
        return {
            price: args.rate,
            taxRate: args.taxRate,
            priceIncludesTax: getPriceIncludesTax(ctx, args.includesTax as any),
        };
    },
});

function getPriceIncludesTax(ctx: RequestContext, setting: TaxSetting): boolean {
    switch (setting) {
        case TaxSetting.auto:
            return ctx.channel.pricesIncludeTax;
        case TaxSetting.exclude:
            return false;
        case TaxSetting.include:
            return true;
    }
}
