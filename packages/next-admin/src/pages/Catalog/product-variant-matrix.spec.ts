import { describe, expect, it } from 'vitest';

import type { OptionGroupItem, ProductVariantState } from './product-editor-types';
import { applyNewOptionGroupToVariants } from './product-variant-matrix';

const group: OptionGroupItem = {
    id: 'size',
    code: 'size',
    name: '尺寸',
    options: [
        { id: 'small', code: 'small', name: '小' },
        { id: 'large', code: 'large', name: '大' },
    ],
};

const variant = (id: string, optionId: string): ProductVariantState => ({
    id,
    sku: `SKU-${id}`,
    name: id === 'red' ? '红色' : '蓝色',
    price: id === 'red' ? '10' : '20',
    costPrice: '5',
    stockOnHand: 8,
    stockAllocated: 0,
    enabled: true,
    digitalDeliveryMode: 'manual_service',
    digitalStockPolicy: 'limited',
    optionIds: [optionId],
    isNew: false,
});

describe('applyNewOptionGroupToVariants', () => {
    it('expands every existing option combination instead of creating one-option invalid rows', () => {
        const result = applyNewOptionGroupToVariants(
            [variant('red', 'color-red'), variant('blue', 'color-blue')],
            group,
            '衬衫',
        );

        expect(result.map(item => item.optionIds)).toEqual([
            ['color-red', 'small'],
            ['color-red', 'large'],
            ['color-blue', 'small'],
            ['color-blue', 'large'],
        ]);
        expect(result.filter(item => !item.isNew).map(item => item.id)).toEqual(['red', 'blue']);
        expect(result.filter(item => item.isNew).every(item => !item.id && item.sku === '')).toBe(true);
        expect(result.find(item => item.id === 'blue')?.price).toBe('20');
    });

    it('upgrades a single optionless variant while preserving its business fields', () => {
        const base = { ...variant('base', 'unused'), optionIds: [] };
        const result = applyNewOptionGroupToVariants([base], group, '衬衫');

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: 'base', sku: 'SKU-base', price: '20', optionIds: ['small'] });
        expect(result[1]).toMatchObject({ isNew: true, sku: '', optionIds: ['large'] });
    });
});
