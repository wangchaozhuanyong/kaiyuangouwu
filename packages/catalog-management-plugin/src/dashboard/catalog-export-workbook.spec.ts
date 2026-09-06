import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { buildCatalogExport } from './catalog-export-workbook';
import { parseCatalogArrayBuffer } from './catalog-local-file';
import { type CatalogExportRowRecord } from './catalog-management.graphql';

describe('browser-local catalog export', () => {
    it('creates the four standard worksheets with typed source and system dates', () => {
        const output = buildCatalogExport([exportRow()], 'xlsx', 's1');
        const workbook = XLSX.read(output.buffer, { type: 'array', cellDates: true });

        expect(workbook.SheetNames).toEqual(['商品与SKU', '库存策略', '批次效期', '字段说明']);
        const productRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['商品与SKU']);
        expect(productRows[0]).toMatchObject({
            名称: '匿名商品',
            一级分类: '匿名分类',
            商品类型: '实物',
            SKU: "'=FORMULA",
            仓库: '主仓',
            库存量: 10,
            进货价: 1.255,
            销售价: 2.5,
            库存上限: 50,
            库存下限: 3,
            商品状态: '启用',
            SKU状态: '禁用',
        });
        expect(workbook.Sheets['商品与SKU'].W2.t).toBe('d');
        expect(workbook.Sheets['商品与SKU'].X2.t).toBe('d');
        expect(productRows[0].供货商).toBe('匿名供货商');
    });

    it('creates UTF-8 CSV locally without exposing workbook internals', () => {
        const output = buildCatalogExport([exportRow()], 'csv', 's1');
        const bytes = new Uint8Array(output.buffer);
        const csv = new TextDecoder().decode(output.buffer);
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(csv).toContain(
            '名称,一级分类,SKU,仓库,库存量,进货价,销售价,毛利率,库存上限,库存下限,商品状态,商品描述,标签',
        );
        expect(csv).toContain('匿名商品');
        expect(csv).toContain('主仓,10,1.255,2.5');
    });

    it('round-trips standard product, stock policy and lot data through the browser parser', async () => {
        const row = exportRow();
        row.sku = '=SKU-ROUNDTRIP';
        row.lots[0].lotCode = '@LOT-ROUNDTRIP-A';
        row.lots[0].quantityOnHand = 4;
        row.lots.push({
            ...row.lots[0],
            id: 'l2',
            lotCode: '-LOT-ROUNDTRIP-B',
            quantityOnHand: 6,
        });
        const output = buildCatalogExport([row], 'xlsx', 's1');

        const parsed = await parseCatalogArrayBuffer(output.buffer, '商品标准报表.xlsx');

        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0]).toMatchObject({
            sku: '=SKU-ROUNDTRIP',
            stockLocationCode: '主仓',
            stockOnHand: 10,
            minimumStock: 3,
            maximumStock: 50,
            lotCode: '@LOT-ROUNDTRIP-A',
            lotQuantity: 4,
            manufacturedAt: '2026-08-01T00:00:00.000Z',
            shelfLifeDays: 365,
            supplier: '匿名供货商',
            variantEnabled: false,
        });
        expect(parsed.rows[1]).toMatchObject({
            sku: '=SKU-ROUNDTRIP',
            stockOnHand: 10,
            lotCode: '-LOT-ROUNDTRIP-B',
            lotQuantity: 6,
        });
        expect(parsed.unknownHeaders).toEqual([]);
    });

    it('keeps existing SKU rows importable when legacy category or cost data is missing', async () => {
        const row = exportRow();
        row.sku = 'SKU-LEGACY-INCOMPLETE';
        row.categories = [];
        row.purchaseCostMicrounits = null;
        const output = buildCatalogExport([row], 'xlsx', 's1');

        const parsed = await parseCatalogArrayBuffer(output.buffer, '历史商品报表.xlsx');

        expect(parsed.errors).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({
            sku: 'SKU-LEGACY-INCOMPLETE',
            category: '',
            purchaseCost: null,
        });
    });

    it('uses maintenance-sheet inventory edits for its warehouse while preserving other warehouse details', async () => {
        const row = exportRow();
        row.stockLevels.push({
            ...row.stockLevels[0],
            stockLocationId: 's2',
            stockLocationName: '副仓',
            stockOnHand: 20,
        });
        const workbook = XLSX.read(buildCatalogExport([row], 'xlsx', 's1').buffer, { type: 'array' });
        XLSX.utils.sheet_add_aoa(workbook.Sheets['商品与SKU'], [[8]], { origin: 'E2' });
        XLSX.utils.sheet_add_aoa(workbook.Sheets['商品与SKU'], [[60, 0]], { origin: 'I2' });

        const parsed = await parseCatalogArrayBuffer(XLSX.write(workbook, { type: 'array' }), '维护.xlsx');

        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0]).toMatchObject({
            stockLocationCode: '主仓',
            stockOnHand: 8,
            minimumStock: 0,
            maximumStock: 60,
            lotQuantity: 10,
        });
        expect(parsed.rows[1]).toMatchObject({
            stockLocationCode: '副仓',
            stockOnHand: 20,
            minimumStock: 3,
            maximumStock: 50,
        });
    });

    it('preserves explicit blanks and zero from the maintenance sheet instead of restoring stale detail values', async () => {
        const row = exportRow();
        row.lots = [];
        const workbook = XLSX.read(buildCatalogExport([row], 'xlsx', 's1').buffer, { type: 'array' });
        XLSX.utils.sheet_add_aoa(workbook.Sheets['商品与SKU'], [[0]], { origin: 'E2' });
        delete workbook.Sheets['商品与SKU'].I2;
        delete workbook.Sheets['商品与SKU'].J2;

        const parsed = await parseCatalogArrayBuffer(XLSX.write(workbook, { type: 'array' }), '空白.xlsx');

        expect(parsed.rows[0]).toMatchObject({ stockOnHand: 0, minimumStock: null, maximumStock: null });
        expect(parsed.rows[0].providedFields).toEqual(
            expect.arrayContaining(['minimumStock', 'maximumStock']),
        );
    });

    it('keeps legacy warehouse expansion when the main sheet has no warehouse or inventory columns', async () => {
        const row = exportRow();
        row.lots = [];
        const workbook = XLSX.read(buildCatalogExport([row], 'xlsx', 's1').buffer, { type: 'array' });
        workbook.Sheets['商品与SKU'] = XLSX.utils.aoa_to_sheet([
            ['名称', '分类', 'SKU', '进货价', '销售价', '商品类型', '导入商店'],
            [row.productName, '匿名分类', row.sku, 1.255, 2.5, '实物', row.channelCode],
        ]);

        const parsed = await parseCatalogArrayBuffer(XLSX.write(workbook, { type: 'array' }), '旧模板.xlsx');

        expect(parsed.rows[0]).toMatchObject({
            stockLocationCode: '主仓',
            stockOnHand: 10,
            minimumStock: 3,
            maximumStock: 50,
        });
    });

    it('retains a main-sheet warehouse missing from the supplemental inventory sheets', async () => {
        const row = exportRow();
        row.lots = [];
        const workbook = XLSX.read(buildCatalogExport([row], 'xlsx', 's1').buffer, { type: 'array' });
        XLSX.utils.sheet_add_aoa(workbook.Sheets['商品与SKU'], [['新仓', 5]], { origin: 'D2' });

        const parsed = await parseCatalogArrayBuffer(
            XLSX.write(workbook, { type: 'array' }),
            '新增仓库.xlsx',
        );

        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0]).toMatchObject({ stockLocationCode: '主仓', stockOnHand: 10 });
        expect(parsed.rows[1]).toMatchObject({ stockLocationCode: '新仓', stockOnHand: 5 });
    });
});

function exportRow(): CatalogExportRowRecord {
    return {
        productId: 'p1',
        channelCode: 'test-store',
        variantId: 'v1',
        productName: '匿名商品',
        fulfillmentType: 'physical',
        description: '仅用于测试',
        categories: ['匿名分类'],
        brand: '测试品牌',
        tags: ['标签A'],
        productEnabled: true,
        variantEnabled: false,
        systemCreatedAt: '2026-08-29T12:00:00.000Z',
        sourceCreatedAt: '2025-01-02T00:00:00.000Z',
        supplierName: '匿名供货商',
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
