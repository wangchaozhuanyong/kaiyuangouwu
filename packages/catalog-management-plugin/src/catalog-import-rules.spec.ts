import { describe, expect, it } from 'vitest';

import { clearsVariantIdentity, shouldClear } from './catalog-import.service';
import { NormalizedCatalogRow } from './types';

describe('catalog import blank clearing rules', () => {
    it('only clears an explicitly present blank column when the mode is enabled', () => {
        const row = { raw: { description: null, minimumStock: 0 } } as unknown as NormalizedCatalogRow;

        expect(shouldClear(row, 'description', false)).toBe(false);
        expect(shouldClear(row, 'description', true)).toBe(true);
        expect(shouldClear(row, 'brand', true)).toBe(false);
        expect(shouldClear(row, 'minimumStock', true)).toBe(false);
    });

    it('treats whitespace as blank without treating numeric zero as blank', () => {
        const row = { raw: { barcode: '   ', shelfLifeDays: 0 } } as unknown as NormalizedCatalogRow;

        expect(shouldClear(row, 'barcode', true)).toBe(true);
        expect(shouldClear(row, 'shelfLifeDays', true)).toBe(false);
    });

    it('detects when blank clearing changes the SKU matching identity', () => {
        const row = {
            raw: { specification: '', primaryUnit: null },
        } as unknown as NormalizedCatalogRow;

        expect(clearsVariantIdentity(row, false)).toBe(false);
        expect(clearsVariantIdentity(row, true)).toBe(true);
    });
});
