import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CatalogExportRowRecord } from './catalog-management.graphql';

import { buildCatalogExport } from './catalog-export-workbook';
import { parseCatalogArrayBuffer } from './catalog-local-file';

describe('browser-local catalog export', () => {
    it('creates the four standard worksheets with typed source and system dates', () => {
        const output = buildCatalogExport([exportRow()], 'xlsx');
        const workbook = XLSX.read(output.buffer, { type: 'array', cellDates: true });

        expect(workbook.SheetNames).toEqual(['商品与SKU', '库存策略', '批次效期', '字段说明']);
        const productRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['商品与SKU']);
        expect(productRows[0]).toMatchObject({
            '名称（必填）': '匿名商品',
            '分类（必填）': '匿名分类',
            SKU: "'=FORMULA",
            '进货价（必填）': 1.255,
            '销售价（必填）': 2.5,
        });
        expect(workbook.Sheets['商品与SKU'].S2.t).toBe('d');
        expect(workbook.Sheets['商品与SKU'].T2.t).toBe('d');
    });

    it('creates UTF-8 CSV locally without exposing workbook internals', () => {
        const output = buildCatalogExport([exportRow()], 'csv');
        const bytes = new Uint8Array(output.buffer);
        const csv = new TextDecoder().decode(output.buffer);
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(csv).toContain('名称（必填）');
        expect(csv).toContain('匿名商品');
    });

    it('round-trips standard product, stock policy and lot data through the browser parser', async () => {
        const row = exportRow();
        row.sku = 'SKU-ROUNDTRIP';
        row.lots[0].lotCode = 'LOT-ROUNDTRIP';
        row.lots[0].quantityOnHand = 4;
        const output = buildCatalogExport([row], 'xlsx');

        const parsed = await parseCatalogArrayBuffer(output.buffer, '商品标准报表.xlsx');

        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]).toMatchObject({
            sku: 'SKU-ROUNDTRIP',
            stockLocationCode: '主仓',
            stockOnHand: 10,
            minimumStock: 3,
            maximumStock: 50,
            lotCode: 'LOT-ROUNDTRIP',
            lotQuantity: 4,
            manufacturedAt: '2026-08-01T00:00:00.000Z',
            shelfLifeDays: 365,
        });
    });
});

function exportRow(): CatalogExportRowRecord {
    return {
        productId: 'p1',
        variantId: 'v1',
        productName: '匿名商品',
        description: '仅用于测试',
        categories: ['匿名分类'],
        brand: '测试品牌',
        tags: ['标签A'],
        productEnabled: true,
        variantEnabled: true,
        systemCreatedAt: '2026-08-29T12:00:00.000Z',
        sourceCreatedAt: '2025-01-02T00:00:00.000Z',
        sku: '=FORMULA',
        barcode: '0012345',
        specification: '500ml',
        saleUnit: '瓶',
        purchaseUnit: '箱',
        packageQuantity: 12,
        shelfLifeDays: 365,
        sellingPrice: 250,
        purchaseCostMicrounits: 1255,
        margin: 0.498,
        currencyCode: 'CNY',
        stockLevels: [
            {
                stockLocationId: 's1',
                stockLocationName: '主仓',
                stockOnHand: 10,
                stockAllocated: 2,
                stockAvailable: 8,
                minimumStock: 3,
                maximumStock: 50,
            },
        ],
        lots: [
            {
                id: 'l1',
                stockLocationId: 's1',
                stockLocationName: '主仓',
                lotCode: '@LOT-1',
                manufacturedAt: '2026-08-01T00:00:00.000Z',
                expiresAt: '2027-08-01T00:00:00.000Z',
                quantityOnHand: 10,
                purchaseCostMicrounits: 1255,
                currencyCode: 'CNY',
                state: 'ACTIVE',
            },
        ],
    };
}
