import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
    CatalogFileParserService,
    catalogRowFingerprint,
    catalogSourceKey,
} from './catalog-file-parser.service';

const headers = [
    '名称（必填）',
    '分类（必填）',
    '规格',
    '主单位',
    '库存量',
    '进货价（必填）',
    '销售价（必填）',
    '毛利率',
    '库存上限',
    '库存下限',
    '品牌',
    '生产日期',
    '保质期',
    '商品状态',
    '商品描述',
    '标签',
    '创建日期',
];

describe('CatalogFileParserService', () => {
    const parser = new CatalogFileParserService();

    it('normalizes the 17-column catalog shape while preserving zero and mill precision', () => {
        const buffer = workbookBuffer([
            headers,
            [
                ' SPARK BEER ',
                '酒品',
                '500ml',
                '罐',
                0,
                4.791,
                7,
                0.3156,
                100,
                0,
                '示例品牌',
                new Date('2026-08-01T00:00:00.000Z'),
                365,
                '启用',
                '',
                '啤酒，进口',
                new Date('2026-08-28T00:00:00.000Z'),
            ],
        ]);

        const parsed = parser.parseBuffer(buffer, 'catalog.xlsx');

        expect(parsed.rows).toHaveLength(1);
        expect(parsed.errors).toHaveLength(0);
        expect(parsed.rows[0]).toMatchObject({
            name: 'SPARK BEER',
            category: '酒品',
            specification: '500ml',
            primaryUnit: '罐',
            stockOnHand: 0,
            purchaseCost: 4.791,
            sellingPrice: 7,
            minimumStock: 0,
            shelfLifeDays: 365,
            enabled: true,
            tags: ['啤酒', '进口'],
        });
        expect(parsed.rows[0].manufacturedAt).toContain('2026-08-01');
    });

    it('uses specification and unit in stable row identity', () => {
        const buffer = workbookBuffer([
            headers,
            ['啤酒', '酒品', '500ml*24', '件', 2, 115, 154, '', '', '', '', '', '', '启用', '', '', ''],
            ['啤酒', '酒品', '500ml', '罐', 4, 4.79, 7, '', '', '', '', '', '', '启用', '', '', ''],
        ]);
        const { rows } = parser.parseBuffer(buffer, 'catalog.xlsx');

        expect(catalogSourceKey(rows[0])).not.toBe(catalogSourceKey(rows[1]));
        expect(catalogRowFingerprint(rows[0])).not.toBe(catalogRowFingerprint(rows[1]));
    });

    it('isolates an invalid row and rejects unsupported files before any database work', () => {
        const invalid = workbookBuffer([
            headers,
            ['商品', '零食', '', '包', 1, 2, 'not-a-number', '', '', '', '', '', '', '启用', '', '', ''],
        ]);
        const parsed = parser.parseBuffer(invalid, 'catalog.xlsx');
        expect(parsed.rows).toHaveLength(0);
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.errors[0]).toMatchObject({
            rowNumber: 2,
            message: '第 2 行：销售价不是有效数字',
        });
        expect(() => parser.parseBuffer(invalid, 'catalog.pdf')).toThrow('仅支持');
    });
});

function workbookBuffer(rows: unknown[][]): Buffer {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
