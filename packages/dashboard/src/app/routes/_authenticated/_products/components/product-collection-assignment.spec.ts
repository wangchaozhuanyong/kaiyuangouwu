import { describe, expect, it } from 'vitest';

import {
    hasDirectProductAssignment,
    setDirectProductAssignment,
    type CollectionFilterValue,
} from './product-collection-assignment.js';

const productFilter = (productIds: string[], combineWithAnd = true): CollectionFilterValue => ({
    code: 'product-id-filter',
    args: [
        { name: 'productIds', value: JSON.stringify(productIds) },
        { name: 'combineWithAnd', value: String(combineWithAnd) },
    ],
});

const automaticFilter: CollectionFilterValue = {
    code: 'facet-value-filter',
    args: [
        { name: 'facetValueIds', value: '["facet-1"]' },
        { name: 'containsAny', value: 'false' },
        { name: 'combineWithAnd', value: 'true' },
    ],
};

describe('product collection assignment filters', () => {
    it('detects a direct assignment in a manual product filter', () => {
        expect(hasDirectProductAssignment([productFilter(['product-1'])], 'product-1')).toBe(true);
        expect(hasDirectProductAssignment([productFilter(['product-2'])], 'product-1')).toBe(false);
    });

    it('adds to the existing manual filter when it is the only rule', () => {
        expect(setDirectProductAssignment([productFilter(['product-1'])], 'product-2', true)).toEqual([
            {
                code: 'product-id-filter',
                arguments: [
                    { name: 'productIds', value: '["product-1","product-2"]' },
                    { name: 'combineWithAnd', value: 'true' },
                ],
            },
        ]);
    });

    it('adds an OR manual filter without changing automatic rules', () => {
        const result = setDirectProductAssignment([automaticFilter], 'product-1', true);

        expect(result[0]).toEqual({
            code: automaticFilter.code,
            arguments: automaticFilter.args,
        });
        expect(result[1]).toEqual({
            code: 'product-id-filter',
            arguments: [
                { name: 'productIds', value: '["product-1"]' },
                { name: 'combineWithAnd', value: 'false' },
            ],
        });
    });

    it('reuses the direct-assignment OR filter', () => {
        const result = setDirectProductAssignment(
            [automaticFilter, productFilter(['product-1'], false)],
            'product-2',
            true,
        );

        expect(result[1]?.arguments[0]?.value).toBe('["product-1","product-2"]');
        expect(result).toHaveLength(2);
    });

    it('removes only the requested product and preserves the other rules', () => {
        const result = setDirectProductAssignment(
            [automaticFilter, productFilter(['product-1', 'product-2'], false)],
            'product-1',
            false,
        );

        expect(result).toEqual([
            { code: automaticFilter.code, arguments: automaticFilter.args },
            {
                code: 'product-id-filter',
                arguments: [
                    { name: 'productIds', value: '["product-2"]' },
                    { name: 'combineWithAnd', value: 'false' },
                ],
            },
        ]);
    });

    it('removes an empty manual filter while preserving automatic rules', () => {
        expect(
            setDirectProductAssignment(
                [automaticFilter, productFilter(['product-1'], false)],
                'product-1',
                false,
            ),
        ).toEqual([{ code: automaticFilter.code, arguments: automaticFilter.args }]);
    });

    it('preserves an invalid manual filter rather than corrupting it', () => {
        const invalidFilter: CollectionFilterValue = {
            code: 'product-id-filter',
            args: [
                { name: 'productIds', value: 'invalid-json' },
                { name: 'combineWithAnd', value: 'true' },
            ],
        };

        const result = setDirectProductAssignment([invalidFilter], 'product-1', true);
        expect(result[0]).toEqual({ code: invalidFilter.code, arguments: invalidFilter.args });
        expect(result[1]?.code).toBe('product-id-filter');
        expect(result[1]?.arguments[1]?.value).toBe('false');
    });
});
