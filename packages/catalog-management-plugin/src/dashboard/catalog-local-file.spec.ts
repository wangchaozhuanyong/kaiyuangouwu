import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
    CATALOG_MAPPING_EXCLUDED,
    parseCatalogArrayBuffer,
    rowsForCatalogTransport,
} from './catalog-local-file';

describe('browser-local catalog parser', () => {
    it('parses UTF-8 Chinese CSV files without requiring a BOM', async () => {
        const csv = ['名称,分类,SKU,进货价,销售价', '匿名商品,匿名分类,UTF8-CSV-001,1.25,2.50'].join('\n');

        const result = await parseCatalogArrayBuffer(
            new TextEncoder().encode(csv).buffer,
            '匿名测试.csv',
            'text/csv',
        );

        expect(result.headers).toEqual(['名称', '分类', 'SKU', '进货价', '销售价']);
        expect(result.errors).toEqual([]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
            name: '匿名商品',
            category: '匿名分类',
            sku: 'UTF8-CSV-001',
            purchaseCost: 1.25,
            sellingPrice: 2.5,
        });
    });

    it('accepts a stable SKU maintenance row with blank values for preserve-on-import', async () => {
        const csv = ['名称,分类,SKU,包装换算,库存量,进货价,销售价', ',,SKU-KEEP-001,,,,'].join('\n');

        const result = await parseCatalogArrayBuffer(
            new TextEncoder().encode(csv).buffer,
            '回导保留原值.csv',
            'text/csv',
        );

        expect(result.errors).toEqual([]);
        expect(result.rows[0]).toMatchObject({
            name: '',
            category: '',
            sku: 'SKU-KEEP-001',
            packageQuantity: null,
            stockOnHand: null,
            purchaseCost: null,
            sellingPrice: null,
        });
    });

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
        expect(result.multiSkuGroups).toBe(0);
        expect(result.exactDuplicateRows).toBe(0);
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

    it('plans legacy same-name differing rows as independent SKUs and marks exact duplicates', async () => {
        const csv = [
            '名称,分类,库存量,进货价,销售价',
            '匿名商品,匿名分类,1,1.00,2.00',
            '匿名商品,匿名分类,2,1.20,2.50',
            '匿名商品,匿名分类,2,1.20,2.50',
        ].join('\n');

        const result = await parseCatalogArrayBuffer(
            new TextEncoder().encode(csv).buffer,
            '同名多SKU.csv',
            'text/csv',
        );

        expect(result.duplicateGroups).toBe(0);
        expect(result.multiSkuGroups).toBe(1);
        expect(result.multiSkuRows).toBe(3);
        expect(result.exactDuplicateRows).toBe(1);
        expect(new Set(result.rows.map(row => row.sourceRecordKey)).size).toBe(3);
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

    it('maps supplier and classifies the 17 removed source columns as explicitly excluded', async () => {
        const excluded = [
            '扩展条码',
            '主编码',
            '批发价',
            '会员价',
            '会员折扣',
            '积分商品',
            '库位',
            '拼音码',
            '货号',
            '自定义1',
            '自定义2',
            '自定义3',
            '重量',
            '是否称重',
            '是否传秤',
            '是否计数商品',
            '称编码',
        ];
        const mapped = [
            '名称',
            '分类',
            '条码',
            '规格',
            '主单位',
            '库存量',
            '进货价',
            '销售价',
            '毛利率',
            '库存上限',
            '库存下限',
            '品牌',
            '供货商',
            '生产日期',
            '保质期',
            '商品状态',
            '商品描述',
            '标签',
            '创建日期',
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                [...mapped, ...excluded],
                [
                    '匿名商品',
                    '匿名分类',
                    '6900000000001',
                    '500ml',
                    '瓶',
                    0,
                    1.25,
                    2.5,
                    '50%',
                    100,
                    0,
                    '匿名品牌',
                    '匿名供货商',
                    null,
                    365,
                    '启用',
                    '',
                    '匿名标签',
                    new Date('2026-08-30T00:00:00Z'),
                    ...excluded.map(() => ''),
                ],
            ]),
            'Sheet1',
        );

        const parsed = await parseCatalogArrayBuffer(toArrayBuffer(workbook), '36列匿名测试.xlsx');

        expect(parsed.headers).toHaveLength(36);
        expect(parsed.mappedHeaders).toBe(19);
        expect(parsed.excludedHeaders).toEqual(excluded);
        expect(parsed.unknownHeaders).toEqual([]);
        expect(parsed.rows[0].supplier).toBe('匿名供货商');
        expect(parsed.fieldMapping['主编码']).toBe(CATALOG_MAPPING_EXCLUDED);
    });

    it('keeps unknown columns unresolved until the user maps or explicitly excludes them', async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ['名称', '分类', '进货价', '销售价', '外部备注'],
                ['匿名商品', '匿名分类', 1, 2, '测试'],
            ]),
            'Sheet1',
        );
        const buffer = toArrayBuffer(workbook);
        const unresolved = await parseCatalogArrayBuffer(buffer, '未知列.xlsx');
        expect(unresolved.unknownHeaders).toEqual(['外部备注']);

        const excluded = await parseCatalogArrayBuffer(buffer, '未知列.xlsx', undefined, {
            ...unresolved.fieldMapping,
            外部备注: CATALOG_MAPPING_EXCLUDED,
        });
        expect(excluded.unknownHeaders).toEqual([]);
        expect(excluded.excludedHeaders).toContain('外部备注');
    });
});

function toArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
    const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true });
    return output instanceof ArrayBuffer ? output : new Uint8Array(output).buffer;
}
