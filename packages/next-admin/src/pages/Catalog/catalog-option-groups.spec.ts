import { describe, expect, it } from 'vitest';

import {
    findUnusedSystemOptionGroupIds,
    isSystemImportOptionGroup,
    splitOptionValues,
    toOptionGroupCode,
} from './catalog-option-groups';

describe('catalog option group visibility', () => {
    it('identifies importer-owned groups without hiding ordinary templates', () => {
        expect(isSystemImportOptionGroup({ code: 'import-sku-5905' })).toBe(true);
        expect(isSystemImportOptionGroup({ code: 'color' })).toBe(false);
    });

    it('only removes importer-owned groups that no existing SKU uses', () => {
        const groups = [
            { id: 'unused-import', code: 'import-sku-5905', options: [{ id: 'unused-option' }] },
            { id: 'used-import', code: 'import-sku-5906', options: [{ id: 'used-option' }] },
            { id: 'ordinary', code: 'color', options: [{ id: 'red' }] },
        ];

        expect(findUnusedSystemOptionGroupIds(groups, [{ optionIds: ['used-option'] }])).toEqual([
            'unused-import',
        ]);
    });

    it('splits option values properly across chinese/english commas and newlines', () => {
        expect(splitOptionValues('单盒, 整条，原箱\n散装')).toEqual(['单盒', '整条', '原箱', '散装']);
        expect(splitOptionValues('单盒, 单盒, 整条')).toEqual(['单盒', '整条']);
    });

    it('generates predictable option group and option codes', () => {
        expect(toOptionGroupCode('售卖包装', 'spec-group')).toMatch(/^spec-group-/);
        expect(toOptionGroupCode('Flavor', 'flavor-group')).toBe('flavor');
    });
});
