import { expect, it } from 'vitest';

import { nextCatalogPageParam, validateCatalogPage } from './catalog-pagination';
import { ProductSearchPage } from './types';

it('never returns the same offset for an empty page with a stale total', () => {
    const page = { items: [], totalItems: 10 };
    expect(nextCatalogPageParam(page, [], 0)).toBeUndefined();
    expect(() => validateCatalogPage(page, 0, new Set(), 'retry')).toThrow('retry');
});
it('rejects repeated pages but permits a background refresh of the first page', () => {
    const page = { items: [{ id: '1' }], totalItems: 3 } as ProductSearchPage;
    expect(() => validateCatalogPage(page, 1, new Set(['1']), 'retry')).toThrow('retry');
    expect(validateCatalogPage(page, 0, new Set(), 'retry')).toBe(page);
    expect(nextCatalogPageParam(page, [], 1)).toBe(2);
});
