import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { idListArg, numberArg, stringArg } from './promotion-operation-args';

describe('promotion operation arguments', () => {
    it('parses persisted Vendure ConfigArg values', () => {
        const operation = {
            code: 'example',
            args: [
                { name: 'discount', value: '2000' },
                { name: 'productVariantIds', value: '["variant-1","variant-2"]' },
                { name: 'variantRules', value: '[{"variantId":"variant-1","percentageOff":20}]' },
            ],
        } satisfies ConfigurableOperation;

        expect(numberArg(operation, 'discount')).toBe(2_000);
        expect(idListArg(operation, 'productVariantIds')).toEqual(['variant-1', 'variant-2']);
        expect(stringArg(operation, 'variantRules')).toContain('"percentageOff":20');
    });

    it('returns safe fallbacks for malformed values', () => {
        const operation = {
            code: 'example',
            args: [
                { name: 'discount', value: 'not-a-number' },
                { name: 'productVariantIds', value: 'not-json' },
            ],
        } satisfies ConfigurableOperation;

        expect(numberArg(operation, 'discount')).toBe(0);
        expect(idListArg(operation, 'productVariantIds')).toEqual([]);
    });
});
