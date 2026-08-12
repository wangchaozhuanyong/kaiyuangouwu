import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionCondition } from '../promotion-condition';

export const minimumOrderAmount = new PromotionCondition({
    description: [
        { languageCode: LanguageCode.en, value: 'Order merchandise subtotal reaches { amount }' },
        { languageCode: LanguageCode.zh_Hans, value: '订单商品小计满 { amount }' },
    ],
    code: 'minimum_order_amount',
    args: {
        amount: {
            type: 'int',
            defaultValue: 100,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Minimum merchandise subtotal' },
                { languageCode: LanguageCode.zh_Hans, value: '最低商品小计' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The order merchandise subtotal must reach this amount.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '订单商品小计达到此金额后满足条件。' },
            ],
        },
        taxInclusive: {
            type: 'boolean',
            defaultValue: false,
            label: [
                { languageCode: LanguageCode.en, value: 'Use tax-inclusive subtotal' },
                { languageCode: LanguageCode.zh_Hans, value: '按含税小计判断' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Enable this to compare the tax-inclusive merchandise subtotal.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '开启后使用含税商品小计判断是否达标。' },
            ],
        },
    },
    check(ctx, order, args) {
        if (args.taxInclusive) {
            return order.subTotalWithTax >= args.amount;
        } else {
            return order.subTotal >= args.amount;
        }
    },
    priorityValue: 10,
});
