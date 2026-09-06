import { describe, expect, it } from 'vitest';

import { customerFacingContentRegistry } from './customer-facing-content-registry.js';

const requiredContentTypes = [
    'Product',
    'ProductVariant',
    'ProductOptionGroup',
    'ProductOption',
    'Collection',
    'Facet',
    'FacetValue',
    'Promotion',
    'ShippingMethod',
    'PaymentMethod',
    'Country',
    'Province',
    'StoreProfile',
    'SystemAnnouncement',
    'StorefrontContentBlock',
    'StorefrontContentItem',
    'AutoCardConfig',
    'StorefrontReview',
    'AfterSalesRequest',
    'ReferralPosterTemplate',
    'ImageGenerationConfig',
    'ImageModelConfig',
];

describe('customerFacingContentRegistry', () => {
    it('classifies every known customer-facing managed content type', () => {
        expect(Object.keys(customerFacingContentRegistry).sort()).toEqual(requiredContentTypes.sort());
    });

    it('does not register duplicate or empty field paths', () => {
        for (const definition of Object.values(customerFacingContentRegistry)) {
            const paths = definition.fields.map(field => field.path);
            expect(paths.every(Boolean)).toBe(true);
            expect(new Set(paths).size).toBe(paths.length);
        }
    });

    it('declares Chinese-first authoring for previously bilingual forms', () => {
        const reviewedTypes = Object.entries(customerFacingContentRegistry)
            .filter(
                ([, definition]) =>
                    'authoringPolicy' in definition &&
                    definition.authoringPolicy === 'CHINESE_SOURCE_AUTO_TRANSLATED',
            )
            .map(([type]) => type)
            .sort();

        expect(reviewedTypes).toEqual(
            ['ImageGenerationConfig', 'ImageModelConfig', 'ReferralPosterTemplate'].sort(),
        );
    });
});
