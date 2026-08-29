import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { parseCatalogArrayBuffer, rowsForCatalogTransport } from './catalog-local-file';

describe('browser-local catalog parser', () => {
    it('parses typed Chinese rows, detects warnings and conflicting duplicates without networking', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                [
                    '名称（必填）',
                    '分类（必填）',
                    'SKU',
                    '销售单位',
                    '采购单位',
                    '包装换算',
                    '库存量',
                    '进货价（必填）',
                    '销售价（必填）',
                    '毛利率',
                    '创建日期',
                ],
                [
                    '测试商品',
                    '测试分类',
                    'SKU-001',
                    '瓶',
                    '箱',
                    12,
                    -2,
                    8.125,
                    7,
                    '20%',
                    new Date('2025-01-02T00:00:00Z'),
                ],
                [
                    '测试商品',
                    '测试分类',
                    'SKU-001',
                    '瓶',
                    '箱',
                    12,
                    3,
                    8.125,
                    9,
                    0.1,
                    new Date('2025-01-02T00:00:00Z'),
                ],
            ]),
            '商品与SKU',
        );
        const result = await parseCatalogArrayBuffer(toArrayBuffer(workbook), '匿名测试.xlsx');

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.rows).toHaveLength(2);
        expect(result.errors).toEqual([]);
        expect(result.duplicateGroups).toBe(1);
        expect(result.duplicateRows).toBe(2);
        expect(result.warningRows).toBe(1);
        expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(result.rows[0]).toMatchObject({
            primaryUnit: '瓶',
            purchaseUnit: '箱',
            packageQuantity: 12,
            stockOnHand: -2,
            sourceCreatedAt: '2025-01-02T00:00:00.000Z',
        });
        vi.unstubAllGlobals();
    });

    it('removes raw cell values from every network payload row', async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ['名称', '分类', '进货价', '销售价', 'SKU'],
                ['=HYPERLINK("https://invalid.example")', '匿名分类', 1.25, 2.5, '@SKU'],
            ]),
            'Sheet1',
        );
        const parsed = await parseCatalogArrayBuffer(toArrayBuffer(workbook), '匿名测试.numbers');
        const transport = rowsForCatalogTransport(parsed.rows);

        expect(parsed.rows[0].raw).toBeDefined();
        expect(transport[0]).not.toHaveProperty('raw');
        expect(JSON.stringify(transport)).not.toContain('raw');
    });

    it('re-parses corrected field mappings locally before transport', async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ['Product', 'Group', 'Buy', 'Sell'],
                ['匿名商品', '匿名分类', 1.25, 2.5],
            ]),
            'Sheet1',
        );
        const buffer = toArrayBuffer(workbook);

        await expect(parseCatalogArrayBuffer(buffer, '匿名测试.xlsx')).rejects.toThrow('缺少必填列');
        const parsed = await parseCatalogArrayBuffer(buffer, '匿名测试.xlsx', undefined, {
            Product: 'name',
            Group: 'category',
            Buy: 'purchaseCost',
            Sell: 'sellingPrice',
        });

        expect(parsed.errors).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({
            name: '匿名商品',
            category: '匿名分类',
            purchaseCost: 1.25,
            sellingPrice: 2.5,
        });
    });
});

function toArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
    const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true });
    return output instanceof ArrayBuffer ? output : new Uint8Array(output).buffer;
}
