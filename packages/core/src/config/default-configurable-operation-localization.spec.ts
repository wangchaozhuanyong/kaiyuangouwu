import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { defaultCollectionFilters } from './catalog/default-collection-filters';
import { collectionDuplicator } from './entity/entity-duplicators/collection-duplicator';
import { facetDuplicator } from './entity/entity-duplicators/facet-duplicator';
import { productDuplicator } from './entity/entity-duplicators/product-duplicator';
import { promotionDuplicator } from './entity/entity-duplicators/promotion-duplicator';
import { manualFulfillmentHandler } from './fulfillment/manual-fulfillment-handler';
import { dummyPaymentHandler } from './payment/dummy-payment-method-handler';
import { examplePaymentHandler } from './payment/example-payment-method-handler';
import { defaultShippingCalculator } from './shipping-method/default-shipping-calculator';
import { defaultShippingEligibilityChecker } from './shipping-method/default-shipping-eligibility-checker';

const localizedDefinitions = [
    ...defaultCollectionFilters,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    dummyPaymentHandler,
    examplePaymentHandler,
    collectionDuplicator,
    facetDuplicator,
    productDuplicator,
    promotionDuplicator,
];

const expectedLanguages = [LanguageCode.en, LanguageCode.zh_Hans];

describe('default configurable operation localization', () => {
    it('provides English and Simplified Chinese descriptions and argument guidance', () => {
        for (const definition of localizedDefinitions) {
            expect(definition.description.map(description => description.languageCode)).toEqual(
                expect.arrayContaining(expectedLanguages),
            );

            for (const arg of Object.values(definition.args)) {
                expect(arg.label?.map(label => label.languageCode)).toEqual(
                    expect.arrayContaining(expectedLanguages),
                );
                expect(arg.description?.map(description => description.languageCode)).toEqual(
                    expect.arrayContaining(expectedLanguages),
                );

                const options = arg.ui?.options;
                for (const option of options ?? []) {
                    expect(option.label?.map(label => label.languageCode)).toEqual(
                        expect.arrayContaining(expectedLanguages),
                    );
                }
            }
        }
    });
});
