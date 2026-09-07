import { describe, expect, it } from 'vitest';

import { type NormalizedCatalogRow } from '../types';

import {
    catalogAppendRequestBytes,
    createCatalogImportBatches,
    MAX_CATALOG_APPEND_REQUEST_BYTES,
    MAX_CATALOG_APPEND_ROWS,
} from './catalog-import-batches';

describe('catalog import request batching', () => {
    it('keeps every full GraphQL request below 512 KiB and every batch below 500 rows', () => {
        const rows = Array.from({ length: 4_074 }, (_, index) =>
            row(index + 2, `商品-${index}-${'说明'.repeat(30)}`),
        );
        const requestDocument = {
            operationName: 'AppendCatalogImportRows',
            query: `mutation AppendCatalogImportRows($input: AppendCatalogImportRowsInput!) {
                appendCatalogImportRows(input: $input) { id ${'receivedRows '.repeat(100)} }
            }`,
        };

        const batches = createCatalogImportBatches('job-1', rows, requestDocument);

        expect(batches.length).toBeGreaterThan(8);
        expect(batches.flat()).toHaveLength(rows.length);
        for (const batch of batches) {
            expect(batch.length).toBeLessThanOrEqual(MAX_CATALOG_APPEND_ROWS);
            expect(catalogAppendRequestBytes('job-1', batch, requestDocument)).toBeLessThanOrEqual(
                MAX_CATALOG_APPEND_REQUEST_BYTES,
            );
        }
    });

    it('splits a batch by UTF-8 bytes even before reaching 500 rows', () => {
        const rows = Array.from({ length: 500 }, (_, index) => row(index + 2, '测'.repeat(600)));
        const batches = createCatalogImportBatches('job-2', rows);

        expect(batches.length).toBeGreaterThan(1);
        expect(batches[0].length).toBeLessThan(500);
    });
});

function row(rowNumber: number, description: string): NormalizedCatalogRow {
    return {
        rowNumber,
        sourceRecordKey: `record-${rowNumber}`,
        name: `商品-${rowNumber}`,
        category: '分类',
        channelCode: '',
        stockLocationCode: '',
        currencyCode: '',
        specification: '',
        primaryUnit: '',
        purchaseUnit: '',
        packageQuantity: 1,
        stockOnHand: 1,
        purchaseCost: 1,
        sellingPrice: 2,
        reportedMargin: 0.5,
        maximumStock: null,
        minimumStock: null,
        brand: '',
        manufacturedAt: null,
        shelfLifeDays: null,
        enabled: true,
        variantEnabled: true,
        description,
        tags: [],
        sourceCreatedAt: null,
        sku: '',
        barcode: '',
        lotCode: '',
        lotQuantity: null,
        supplier: '',
        providedFields: ['name', 'category', 'purchaseCost', 'sellingPrice'],
    };
}
