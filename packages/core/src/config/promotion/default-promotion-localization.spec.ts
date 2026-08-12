import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { buyXGetYFreeAction } from './actions/buy-x-get-y-free-action';
import { discountOnItemWithFacets } from './actions/facet-values-percentage-discount-action';
import { freeShipping } from './actions/free-shipping-action';
import { orderFixedDiscount } from './actions/order-fixed-discount-action';
import { orderLineFixedDiscount } from './actions/order-line-fixed-discount-action';
import { orderPercentageDiscount } from './actions/order-percentage-discount-action';
import { productsPercentageDiscount } from './actions/product-percentage-discount-action';
import { buyXGetYFreeCondition } from './conditions/buy-x-get-y-free-condition';
import { containsProducts } from './conditions/contains-products-condition';
import { customerGroup } from './conditions/customer-group-condition';
import { hasFacetValues } from './conditions/has-facet-values-condition';
import { minimumOrderAmount } from './conditions/min-order-amount-condition';

const defaultPromotionDefinitions = [
    minimumOrderAmount,
    hasFacetValues,
    containsProducts,
    customerGroup,
    buyXGetYFreeCondition,
    buyXGetYFreeAction,
    discountOnItemWithFacets,
    freeShipping,
    orderFixedDiscount,
    orderLineFixedDiscount,
    orderPercentageDiscount,
    productsPercentageDiscount,
];

describe('default promotion localization', () => {
    it('provides English and Simplified Chinese descriptions and argument guidance', () => {
        for (const definition of defaultPromotionDefinitions) {
            const descriptionLanguages = definition.description.map(description => description.languageCode);
            expect(descriptionLanguages).toEqual(
                expect.arrayContaining([LanguageCode.en, LanguageCode.zh_Hans]),
            );

            for (const arg of Object.values(definition.args)) {
                const labelLanguages = arg.label?.map(label => label.languageCode);
                const argDescriptionLanguages = arg.description?.map(
                    description => description.languageCode,
                );
                expect(labelLanguages).toEqual(
                    expect.arrayContaining([LanguageCode.en, LanguageCode.zh_Hans]),
                );
                expect(argDescriptionLanguages).toEqual(
                    expect.arrayContaining([LanguageCode.en, LanguageCode.zh_Hans]),
                );
            }
        }
    });
});
