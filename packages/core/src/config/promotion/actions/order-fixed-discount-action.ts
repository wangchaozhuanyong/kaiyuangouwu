import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionOrderAction } from '../promotion-action';

export const orderFixedDiscount = new PromotionOrderAction({
    code: 'order_fixed_discount',
    args: {
        discount: {
            type: 'int',
            ui: {
                component: 'currency-form-input',
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Discount amount' },
                { languageCode: LanguageCode.zh_Hans, value: '减免金额' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Fixed amount deducted from the merchandise subtotal.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '从订单商品小计中减免的固定金额。' },
            ],
        },
    },
    execute(ctx, order, args) {
        const upperBound = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
        return -Math.min(args.discount, upperBound);
    },
    description: [
        { languageCode: LanguageCode.en, value: 'Reduce the merchandise subtotal by { discount }' },
        { languageCode: LanguageCode.zh_Hans, value: '订单商品小计立减 { discount }' },
    ],
});
