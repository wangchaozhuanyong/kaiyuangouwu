import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { idsAreEqual } from '../../../common/utils';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { PromotionItemAction } from '../promotion-action';

export const productsPercentageDiscount = new PromotionItemAction({
    code: 'products_percentage_discount',
    description: [
        { languageCode: LanguageCode.en, value: 'Reduce the specified product SKUs by { discount }%' },
        { languageCode: LanguageCode.zh_Hans, value: '指定商品 SKU 减免 { discount }%' },
    ],
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
                    value: 'Percentage deducted from each selected product SKU.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '每件所选商品 SKU 按此比例减免。' },
            ],
        },
        productVariantIds: {
            type: 'ID',
            list: true,
            ui: { component: 'product-selector-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Product SKUs' },
                { languageCode: LanguageCode.zh_Hans, value: '商品 SKU' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Select the product SKUs that receive the discount.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择享受此项优惠的商品 SKU。' },
            ],
        },
    },
    execute(ctx, orderLine, args) {
        if (lineContainsIds(args.productVariantIds, orderLine)) {
            const unitPrice = ctx.channel.pricesIncludeTax ? orderLine.unitPriceWithTax : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});

function lineContainsIds(ids: ID[], line: OrderLine): boolean {
    return !!ids.find(id => idsAreEqual(id, line.productVariant.id));
}
