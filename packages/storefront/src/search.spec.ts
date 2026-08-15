import { describe, expect, it } from 'vitest';

import { filterProductsByHanTerm, hasHanCharacters } from './search';
import { Product } from './types';

const products = [
    {
        id: 'keyboard',
        name: 'Keyline 75 机械键盘',
        description: '紧凑的 75% 机械键盘',
        collections: [],
        variants: [{ name: '段落轴', sku: 'DEMO-KEYBOARD-75' }],
    },
    {
        id: 'course',
        name: 'FlowNote 数字效率课程',
        description: '包含任务整理与日程规划',
        collections: [],
        variants: [{ name: '在线交付', sku: 'AUDIT-DIGITAL-001' }],
    },
] as unknown as Product[];

describe('Chinese storefront search fallback', () => {
    it('detects Han characters without taking over English queries', () => {
        expect(hasHanCharacters('键盘')).toBe(true);
        expect(hasHanCharacters('keyboard')).toBe(false);
    });

    it('matches Chinese product and description text', () => {
        expect(filterProductsByHanTerm(products, '机械 键盘').map(product => product.id)).toEqual([
            'keyboard',
        ]);
        expect(filterProductsByHanTerm(products, '日程规划').map(product => product.id)).toEqual(['course']);
    });

    it('returns no products for an empty term', () => {
        expect(filterProductsByHanTerm(products, '   ')).toEqual([]);
    });
});
