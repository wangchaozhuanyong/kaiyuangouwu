import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionOrderAction } from '../promotion-action';

export const orderPercentageDiscount = new PromotionOrderAction({
    code: 'order_percentage_discount',
    args: {
        discount: {
            type: 'float',
            ui: {
                component: 'number-form-input',
                suffix: '%',
                min: 0,
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Discount percentage' },
                { languageCode: LanguageCode.zh_Hans, value: '减免比例' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Percentage deducted from the merchandise subtotal.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '从订单商品小计中按此比例减免。' },
            ],
        },
    },
    execute(ctx, order, args) {
        const orderTotal = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
        return -orderTotal * (args.discount / 100);
    },
    description: [
        { languageCode: LanguageCode.en, value: 'Reduce the merchandise subtotal by { discount }%' },
        { languageCode: LanguageCode.zh_Hans, value: '订单商品小计减免 { discount }%' },
    ],
});
