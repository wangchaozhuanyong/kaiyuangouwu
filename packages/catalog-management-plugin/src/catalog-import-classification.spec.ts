import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { type RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { CatalogFileParserService, catalogProductKey } from './catalog-file-parser.service';
import {
    catalogCollectionPath,
    catalogImportTypeError,
    preferredCatalogCategoryPath,
} from './catalog-import-classification';
import { sanitizeCatalogRow, validateImportSource } from './catalog-import-helpers';
import { CatalogImportService } from './catalog-import.service';
import { buildCatalogExport } from './dashboard/catalog-export-workbook';
import { catalogImportTemplateCsv } from './dashboard/catalog-import-template';
import { parseCatalogArrayBuffer } from './dashboard/catalog-local-file';
import { type CatalogExportRowRecord } from './dashboard/catalog-management.graphql';
import { type BeginCatalogImportInput, type NormalizedCatalogRow } from './types';

const encode = (csv: string) => new TextEncoder().encode(csv).buffer;

describe('catalog import type and hierarchy', () => {
    it('downloads explicit physical and digital examples and an empty second level', async () => {
        const csv = catalogImportTemplateCsv('test-store');
        const local = await parseCatalogArrayBuffer(encode(csv), 'template.csv');
        const server = new CatalogFileParserService().parseBuffer(
            Buffer.from('\uFEFF' + csv),
            'template.csv',
        );
        expect(local.errors).toEqual([]);
        expect(server.errors).toEqual([]);
        const fields = (row: NormalizedCatalogRow) => [
            row.fulfillmentType,
            row.category,
            row.secondaryCategory,
        ];
        expect(local.rows.map(fields)).toEqual([
            ['physical', '食品饮料', '饮料'],
            ['digital', '数字服务', ''],
        ]);
        expect(server.rows.map(fields)).toEqual(local.rows.map(fields));
        for (const row of local.rows) expect(fields(sanitizeCatalogRow(row, 2))).toEqual(fields(row));
        expect(() =>
            validateImportSource({
                source: {
                    byteSize: encode(csv).byteLength,
                    filename: 'template.csv',
                    fileHash: 'a'.repeat(64),
                    parserVersion: 'catalog-browser-v3',
                    detectedHeaders: local.headers,
                    fieldMapping: local.fieldMapping,
                },
                totalRows: 2,
            } as BeginCatalogImportInput),
        ).not.toThrow();
    });

    it('allows field-scoped SKU maintenance while rejecting an explicitly invalid type', async () => {
        const maintenance = await parseCatalogArrayBuffer(
            encode('导入商店,SKU,商品描述\ntest-store,SKU-1,更新后的描述'),
            'maintenance.csv',
        );
        const serverMaintenance = new CatalogFileParserService().parseBuffer(
            Buffer.from('导入商店,SKU,商品描述\ntest-store,SKU-1,更新后的描述'),
            'maintenance.csv',
        );
        expect(maintenance.errors).toEqual([]);
        expect(serverMaintenance.errors).toEqual([]);
        expect(maintenance.rows[0]).toMatchObject({
            sku: 'SKU-1',
            description: '更新后的描述',
            category: '',
            fulfillmentType: undefined,
            providedFields: ['channelCode', 'sku', 'description'],
        });
        expect(serverMaintenance.rows[0]).toMatchObject({
            sku: 'SKU-1',
            category: '',
            fulfillmentType: undefined,
        });
        const invalid = await parseCatalogArrayBuffer(
            encode('名称,商品类型,一级分类,进货价,销售价,导入商店\n商品,未知,食品,1,2,test-store'),
            'invalid.csv',
        );
        expect(invalid.rows).toHaveLength(0);
        expect(invalid.errors[0].message).toContain('虚拟货品');
    });

    it('rejects a child without its parent', async () => {
        const result = await parseCatalogArrayBuffer(
            encode('名称,商品类型,一级分类,二级分类,进货价,销售价,导入商店\n商品,实物,,饮料,1,2,test-store'),
            'invalid.csv',
        );
        expect(result.errors[0].message).toContain('必须填写一级分类');
    });

    it('separates same-name products in different types and child categories', () => {
        const row = {
            name: '商品',
            category: '食品',
            secondaryCategory: '',
            fulfillmentType: 'physical' as const,
        };
        expect(catalogProductKey(row)).not.toBe(catalogProductKey({ ...row, secondaryCategory: '饮料' }));
        expect(catalogProductKey(row)).not.toBe(catalogProductKey({ ...row, fulfillmentType: 'digital' }));
    });

    it('blocks incompatible explicit types and preserves an omitted maintenance type', () => {
        const ctx = (commerceMode: string) =>
            ({ channel: { customFields: { commerceMode } } }) as unknown as RequestContext;
        const row = { rowNumber: 2, fulfillmentType: 'physical' } as NormalizedCatalogRow;
        expect(catalogImportTypeError(ctx('DIGITAL_ONLY'), row)).toContain('不能导入实物');
        expect(catalogImportTypeError(ctx('HYBRID'), row)).toBeNull();
        expect(
            catalogImportTypeError(ctx('PHYSICAL_ONLY'), { ...row, fulfillmentType: 'digital' }),
        ).toContain('不能导入虚拟');
        expect(catalogImportTypeError(ctx('HYBRID'), { ...row, fulfillmentType: undefined })).toBeNull();
    });

    it('plans type correction and removes a blank child without enabling general blank clearing', async () => {
        const parsed = await parseCatalogArrayBuffer(
            encode(catalogImportTemplateCsv('test-store')),
            'template.csv',
        );
        const service = new CatalogImportService(
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
            undefined as never,
        );
        const changes = Reflect.get(service, 'diffRow').call(
            service,
            { ...parsed.rows[0], secondaryCategory: '' },
            {
                productFulfillmentType: 'digital',
                productImportCategory: '食品饮料 > 饮料',
            },
            CurrencyCode.CNY,
            false,
        );
        expect(changes.category).toEqual({ from: '食品饮料 > 饮料', to: '食品饮料' });
        expect(changes.fulfillmentType).toEqual({ from: 'digital', to: 'physical' });
    });

    it('exports the authoritative hierarchy ahead of sorted display memberships', async () => {
        const row = {
            productName: '商品',
            channelCode: 'test-store',
            sku: 'SKU-1',
            fulfillmentType: 'physical',
            importCategory: '饮料',
            categories: ['促销', '食品', '食品 > 饮料'],
            sellingPrice: 200,
            purchaseCostMicrounits: 1000,
            tags: [],
            stockLevels: [],
            lots: [],
            barcode: '',
            description: '',
            productEnabled: true,
            variantEnabled: true,
            packageQuantity: 1,
            currencyCode: 'CNY',
        } as unknown as CatalogExportRowRecord;
        for (const format of ['csv', 'xlsx'] as const) {
            const result = await parseCatalogArrayBuffer(
                buildCatalogExport([row], format).buffer,
                `export.${format}`,
            );
            expect(result.errors).toEqual([]);
            expect(result.rows[0]).toMatchObject({
                fulfillmentType: 'physical',
                category: '食品',
                secondaryCategory: '饮料',
            });
        }
    });

    it('derives a child path from the real collection parent and ignores a flattened marker', () => {
        const child = {
            translations: [{ languageCode: 'zh_Hans', name: '泰山' }],
            parent: {
                isRoot: false,
                translations: [{ languageCode: 'zh_Hans', name: '正品烟草' }],
            },
        };
        const path = catalogCollectionPath(child, 'zh_Hans');
        expect(path).toBe('正品烟草 > 泰山');
        expect(preferredCatalogCategoryPath('泰山', ['泰山', '促销 > 本周推荐', '正品烟草', path])).toBe(
            path,
        );
    });
});
