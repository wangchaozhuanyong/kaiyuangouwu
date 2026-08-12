import { LanguageCode } from '@vendure/common/lib/generated-types';

import { buyXGetYFreeCondition } from '../conditions/buy-x-get-y-free-condition';
import { PromotionItemAction } from '../promotion-action';

export const buyXGetYFreeAction = new PromotionItemAction({
    code: 'buy_x_get_y_free',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Give the selected items free when the purchase threshold is met',
        },
        { languageCode: LanguageCode.zh_Hans, value: '满足购买门槛后赠送指定商品' },
    ],
    args: {},
    conditions: [buyXGetYFreeCondition],
    execute(ctx, orderLine, args, state) {
        const freeItemsPerLine = state.buy_x_get_y_free.freeItemsPerLine;
        const freeQuantity = freeItemsPerLine[orderLine.id];
        if (freeQuantity) {
            const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
            return -unitPrice * (freeQuantity / orderLine.quantity);
        }
        return 0;
    },
});
