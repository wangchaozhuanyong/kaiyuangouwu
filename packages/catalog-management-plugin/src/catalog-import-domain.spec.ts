import { Product, ProductVariant, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { parseCatalogFulfillmentType } from './catalog-import-classification';
import { CatalogImportPreview } from './catalog-import-preview';
import { NormalizedCatalogRow } from './types';

// These checks run before the preview can read stock or plan any writes.
function preview(type: 'digital' | 'physical') {
    const variant = new ProductVariant({ id: 'v1', productId: 'p1', sku: 'EXISTING' });
    const product = Object.assign(new Product({ id: 'p1', variants: [variant] }), {
        customFields: { fulfillmentType: type },
    });
    const index = {
        products: [{ product, productKeyNames: new Set<string>(), categories: new Set<string>() }],
        categoryPaths: new Set<string>(),
        childCategoryParents: new Map<string, Set<string>>(),
    };
    return (row: Partial<NormalizedCatalogRow>) =>
        new CatalogImportPreview(undefined as never, undefined as never).planRow(
            { channel: { customFields: { commerceMode: 'HYBRID' } } } as unknown as RequestContext,
            { rowNumber: 2, sku: 'EXISTING', providedFields: [], ...row } as NormalizedCatalogRow,
            {} as never,
            index,
        );
}
describe('import existing product domain boundary', () => {
    it('uses the existing digital type when a maintenance file omits type', async () => {
        const result = await preview('digital')({ packageQuantity: 12 });
        expect(result.action).toBe('ERROR');
        expect(result.message).toContain('packageQuantity');
    });
    it('uses the existing physical type and rejects digital settings', async () => {
        const result = await preview('physical')({
            digitalStockPolicy: 'limited',
            digitalAvailableQuantity: 2,
        });
        expect(result.action).toBe('ERROR');
        expect(result.message).toContain('实物商品不能');
    });
    it('marks an explicit cross-type SKU match as a conflict', async () => {
        const result = await preview('digital')({ fulfillmentType: 'physical' });
        expect(result.action).toBe('CONFLICT');
        expect(result.message).toContain('复制基础资料');
    });
    it('accepts the digital label shown in the editor', () => {
        expect(parseCatalogFulfillmentType('数字商品', 2)).toBe('digital');
    });
});
