import { type RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { CatalogFileParserService } from './catalog-file-parser.service';
import { sanitizeCatalogRow } from './catalog-import-helpers';
import { catalogImportStoreError } from './catalog-import-store';
import { CatalogImportWriter } from './catalog-import-writer';
import { catalogImportTemplateCsv } from './dashboard/catalog-import-template';
import { parseCatalogArrayBuffer } from './dashboard/catalog-local-file';

const encode = (csv: string) => new TextEncoder().encode(csv).buffer;
const context = { channelId: '2', channel: { code: 'store-a' } } as RequestContext;

describe('explicit import store', () => {
    it('prefills every template row with the selected store and accepts the legacy store header', async () => {
        for (const header of ['导入商店', '门店', '门店编码']) {
            const csv = catalogImportTemplateCsv('store-a').replace('导入商店', header);
            const local = await parseCatalogArrayBuffer(encode(csv), 'template.csv');
            const server = new CatalogFileParserService().parseBuffer(Buffer.from(csv), 'template.csv');
            expect(local.errors).toEqual([]);
            expect(server.errors).toEqual([]);
            for (const row of [...local.rows, ...server.rows]) {
                expect(row.channelCode).toBe('store-a');
                expect(catalogImportStoreError(row, context)).toBeNull();
                expect(sanitizeCatalogRow(row, 2).channelCode).toBe('store-a');
            }
        }
    });

    it('rejects a missing column and empty cells instead of inferring the current store', async () => {
        const csv = '名称,商品类型,一级分类,进货价,销售价\n商品,实物,食品,1,2';
        await expect(parseCatalogArrayBuffer(encode(csv), 'old.csv')).rejects.toThrow('导入商店');
        expect(() => new CatalogFileParserService().parseBuffer(Buffer.from(csv), 'old.csv')).toThrow(
            '导入商店',
        );
        const empty = catalogImportTemplateCsv('');
        const local = await parseCatalogArrayBuffer(encode(empty), 'empty.csv');
        expect(local.rows).toHaveLength(0);
        expect(local.errors).toHaveLength(2);
        const server = new CatalogFileParserService().parseBuffer(Buffer.from(empty), 'empty.csv');
        expect(server.rows).toHaveLength(0);
        expect(server.errors).toHaveLength(2);
    });

    it('uses exact store identifiers and cannot bypass the scope with a warning confirmation', async () => {
        for (const channelCode of ['', 'store-b', 'STORE-A', '美宜佳']) {
            const row = { rowNumber: 2, channelCode };
            expect(catalogImportStoreError(row, context)).toBeTruthy();
            const writer = Object.create(CatalogImportWriter.prototype) as CatalogImportWriter;
            await expect(
                Reflect.get(writer, 'applyRow').call(
                    writer,
                    context,
                    {},
                    {
                        normalizedData: row,
                        resolution: 'APPLY',
                    },
                    new Map(),
                    new Map(),
                    [],
                    new Set(),
                ),
            ).rejects.toThrow('导入商店');
        }
        expect(catalogImportStoreError({ rowNumber: 2, channelCode: '2' }, context)).toBeNull();
    });

    it('rejects a forged transport row without a store', async () => {
        const parsed = await parseCatalogArrayBuffer(encode(catalogImportTemplateCsv('store-a')), 'test.csv');
        expect(() => sanitizeCatalogRow({ ...parsed.rows[0], channelCode: '' }, 2)).toThrow('导入商店');
    });
});
