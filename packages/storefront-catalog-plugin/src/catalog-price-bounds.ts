import { RequestContext, UserInputError } from '@vendure/core';
import { convertDefaultCurrencyPriceForRequest } from '@vendure/store-management-plugin/currency-conversion';

// SearchIndexItem prices are signed SQL integers. Convert the comparison boundaries
// with the actual price strategy so markup and CENT/TENTH/WHOLE rounding stay identical.
const MAX_INDEX_PRICE = 2_147_483_647;

export function catalogPriceBounds(ctx: RequestContext, min?: number, max?: number) {
    const convert = (price: number) => {
        const value = convertDefaultCurrencyPriceForRequest(ctx, price);
        if (value == null) throw new UserInputError('当前店铺汇率尚未配置，暂时无法按所选币种筛选');
        return value;
    };
    const lowerBound = (target: number) => {
        let low = 0;
        let high = MAX_INDEX_PRICE + 1;
        while (low < high) {
            const middle = low + Math.floor((high - low) / 2);
            if (convert(middle) < target) low = middle + 1;
            else high = middle;
        }
        return low;
    };
    return {
        min: min == null ? undefined : lowerBound(min),
        max: max == null ? undefined : lowerBound(max + 1) - 1,
    };
}
