import { describe, expect, it } from 'vitest';

import { catalogSourceKey } from './catalog-file-parser.service';
import {
    assignCatalogSourceRecordKeys,
    catalogCreateNewSourceRecordKey,
    resolveImportExecutionVariantId,
} from './catalog-row-identity';
import { type NormalizedCatalogRow } from './types';

describe('catalog import stable identity', () => {
    it('never reuses a cached or targeted SKU for CREATE_NEW', () => {
        expect(resolveImportExecutionVariantId('CREATE_NEW', 'target-1', 'cached-1')).toBeNull();
        expect(resolveImportExecutionVariantId('UPDATE_EXISTING', 'target-1', 'cached-1')).toBe('target-1');
        expect(resolveImportExecutionVariantId(null, null, 'cached-1')).toBe('cached-1');
        expect(resolveImportExecutionVariantId('APPLY', null, 'cached-1', true)).toBeNull();
    });

    it('gives every legacy row its own deterministic source binding key', () => {
        const assigned = assignCatalogSourceRecordKeys([row(2, 1, 2), row(3, 2, 3), row(4, 2, 3)]);

        expect(new Set(assigned.map(item => item.sourceRecordKey)).size).toBe(3);
        expect(new Set(assigned.map(catalogSourceKey)).size).toBe(3);
        expect(assignCatalogSourceRecordKeys([row(2, 1, 2), row(3, 2, 3)]).map(catalogSourceKey)).toEqual(
            assigned.slice(0, 2).map(catalogSourceKey),
        );
    });

    it('gives CREATE_NEW conflict rows independent and repeatable source record keys', () => {
        const first = catalogCreateNewSourceRecordKey('sku\u001fshared', 2);
        const second = catalogCreateNewSourceRecordKey('sku\u001fshared', 3);

        expect(first).not.toBe(second);
        expect(catalogCreateNewSourceRecordKey(first, 2)).toBe(first);
        expect(catalogSourceKey({ ...row(2, 1, 2), sourceRecordKey: first })).not.toBe(
            catalogSourceKey({ ...row(3, 2, 3), sourceRecordKey: second }),
        );
    });
});

function row(rowNumber: number, stockOnHand: number, sellingPrice: number): NormalizedCatalogRow {
    return {
        rowNumber,
        name: '同名商品',
        category: '同一分类',
        channelCode: '',
        stockLocationCode: '',
        currencyCode: '',
        specification: '',
        primaryUnit: '',
        purchaseUnit: '',
        packageQuantity: 1,
        stockOnHand,
        purchaseCost: 1,
        sellingPrice,
        reportedMargin: null,
        maximumStock: null,
        minimumStock: null,
        brand: '',
        manufacturedAt: null,
        shelfLifeDays: null,
        enabled: true,
        variantEnabled: true,
        description: '',
        tags: [],
        sourceCreatedAt: null,
        sku: '',
        barcode: '',
        lotCode: '',
        lotQuantity: null,
        supplier: '',
        providedFields: ['name', 'category', 'stockOnHand', 'purchaseCost', 'sellingPrice'],
    };
}
