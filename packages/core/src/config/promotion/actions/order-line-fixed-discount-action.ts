import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionLineAction } from '../promotion-action';

export const orderLineFixedDiscount = new PromotionLineAction({
    code: 'order_line_fixed_discount',
    args: {
        discount: {
            type: 'int',
            ui: {
                component: 'currency-form-input',
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Discount amount per order line' },
                { languageCode: LanguageCode.zh_Hans, value: '每条订单商品减免金额' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Fixed amount deducted from each order line.' },
                { languageCode: LanguageCode.zh_Hans, value: '从每条符合条件的订单商品中减免的固定金额。' },
            ],
        },
    },
    execute(ctx, orderLine, args) {
        return -args.discount;
    },
    description: [
        { languageCode: LanguageCode.en, value: 'Reduce each qualifying order line by { discount }' },
        { languageCode: LanguageCode.zh_Hans, value: '每条符合条件的订单商品立减 { discount }' },
    ],
});
