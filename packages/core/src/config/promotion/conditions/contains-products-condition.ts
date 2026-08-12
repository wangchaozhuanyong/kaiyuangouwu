import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { idsAreEqual } from '../../../common/utils';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { PromotionCondition } from '../promotion-condition';

export const containsProducts = new PromotionCondition({
    code: 'contains_products',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Buy at least { minimum } of the specified product SKUs',
        },
        { languageCode: LanguageCode.zh_Hans, value: '购买指定商品 SKU 满 { minimum } 件' },
    ],
    args: {
        minimum: {
            type: 'int',
            defaultValue: 1,
            ui: { component: '', min: 1 },
            label: [
                { languageCode: LanguageCode.en, value: 'Minimum quantity' },
                { languageCode: LanguageCode.zh_Hans, value: '最低购买件数' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Required quantity of the selected product SKUs.' },
                { languageCode: LanguageCode.zh_Hans, value: '所选商品 SKU 至少需要购买多少件。' },
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
                    value: 'Select the product SKUs included in this condition.',
                },
                { languageCode: LanguageCode.zh_Hans, value: '选择计入活动门槛的商品 SKU。' },
            ],
        },
    },
    async check(ctx, order, args) {
        const ids = args.productVariantIds;
        if (args.minimum < 1) return false;
        let matches = 0;
        for (const line of order.lines) {
            if (lineContainsIds(ids, line)) {
                matches += line.quantity;
            }
        }
        return args.minimum <= matches;
    },
});

function lineContainsIds(ids: ID[], line: OrderLine): boolean {
    return !!ids.find(id => idsAreEqual(id, line.productVariant.id));
}
