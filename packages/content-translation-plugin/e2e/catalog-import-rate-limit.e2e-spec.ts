import {
    Collection,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    LanguageCode,
    mergeConfig,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextService,
    StockLevel,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { CatalogImportService } from '../../catalog-management-plugin/src/catalog-import.service';
import { CatalogManagementPlugin } from '../../catalog-management-plugin/src/catalog-management.plugin';
import { CatalogOperationsService } from '../../catalog-management-plugin/src/catalog-operations.service';
import {
    parseCatalogArrayBuffer,
    rowsForCatalogTransport,
} from '../../catalog-management-plugin/src/dashboard/catalog-local-file';
import { ContentTranslationRetryService } from '../src/content-translation-retry.service';
import { ContentTranslationPlugin } from '../src/content-translation.plugin';
import { ContentTranslationState } from '../src/entities/content-translation-state.entity';
import { NativeContentTranslationService } from '../src/native-content-translation.service';
import { GoogleCloudTranslationProvider } from '../src/providers/google-cloud-translation.provider';
import { type ContentTranslationProvider } from '../src/types';

const directory = mkdtempSync(join(tmpdir(), 'catalog-translation-'));
let ready = false;
let activeProvider: ContentTranslationProvider = {
    name: 'fixture',
    isConfigured: () => ready,
    translate: request =>
        Promise.resolve({
            provider: 'fixture',
            translations: request.segments.map(segment => ({
                key: segment.key,
                text: `Fixture ${segment.key}`,
            })),
        }),
};
const provider: ContentTranslationProvider = {
    name: 'import-regression',
    isConfigured: () => activeProvider.isConfigured(),
    translate: request => activeProvider.translate(request),
};
const config = mergeConfig(testConfig, {
    apiOptions: { port: 3298 },
    customFields: {
        Channel: [{ name: 'commerceMode', type: 'string', defaultValue: 'HYBRID' }],
        Product: [{ name: 'fulfillmentType', type: 'string', defaultValue: 'digital' }],
    },
    plugins: [
        CatalogManagementPlugin,
        DefaultJobQueuePlugin,
        DefaultSearchPlugin.init({ bufferUpdates: true }),
        ContentTranslationPlugin.init({ provider }),
    ],
});
const { server } = createTestEnvironment(config);
let ctx: RequestContext;
let imports: CatalogImportService;
let connection: TransactionalConnection;
let fetchMock: MockInstance<typeof fetch>;

async function preview(count: number, prefix: string) {
    const csv = [
        '名称,商品类型,一级分类,二级分类,SKU,销售价,进货价,库存量,导入商店',
        ...Array.from(
            { length: count },
            (_, index) =>
                `测试文具${prefix}${index},实物,测试文具,笔记本,${prefix}-${index},12,6,10,${ctx.channel.code}`,
        ),
    ].join('\n');
    const parsed = await parseCatalogArrayBuffer(new TextEncoder().encode(csv).buffer, `${prefix}.csv`);
    expect(parsed.errors).toEqual([]);
    const [warehouse] = await server.app.get(CatalogOperationsService).stockLocations(ctx);
    const job = await imports.beginImport(ctx, {
        context: { channelId: ctx.channelId, stockLocationId: warehouse.id, currencyCode: ctx.currencyCode },
        source: {
            filename: parsed.filename,
            byteSize: parsed.byteSize,
            mimetype: 'text/csv',
            fileHash: parsed.fileHash,
            sheetName: parsed.sheetName,
            detectedHeaders: parsed.headers,
            fieldMapping: parsed.fieldMapping,
            parserVersion: 'catalog-browser-v3',
        },
        totalRows: count,
    });
    await imports.appendRows(ctx, { jobId: job.id, rows: rowsForCatalogTransport(parsed.rows) });
    await imports.finalizePreview(ctx, job.id);
    const warnings = (await imports.findRows(ctx, job.id)).filter(row => row.action === 'WARNING');
    for (const row of warnings) expect(row.message).toBe('分类不存在，确认后将创建新分类');
    if (warnings.length)
        await imports.resolveRows(ctx, { rowIds: warnings.map(row => row.id), resolution: 'APPLY' });
    expect(
        (await imports.findRows(ctx, job.id))
            .filter(row => row.action !== 'CREATE')
            .slice(0, 3)
            .map(row => ({ action: row.action, message: row.message })),
    ).toEqual([]);
    return job;
}

describe('catalog import survives Google rate limits with a real isolated database', () => {
    beforeAll(async () => {
        registerInitializer('sqljs', new SqljsInitializer(directory));
        await server.init({
            initialData: {
                ...initialData,
                defaultLanguage: LanguageCode.zh_Hans,
                collections: [],
                paymentMethods: [],
            },
            customerCount: 0,
        });
        ctx = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', languageCode: LanguageCode.zh_Hans });
        connection = server.app.get(TransactionalConnection);
        imports = server.app.get(CatalogImportService);
        imports.registerEnqueuer(() => Promise.resolve());
        ready = true;
        await server.app.get(NativeContentTranslationService).repairHistoricalTranslations();
        // Initial country translations are unrelated to this import regression.
        await connection.rawConnection.getRepository(ContentTranslationState).clear();
        activeProvider = new GoogleCloudTranslationProvider({ apiKey: 'test-only-placeholder' });
        fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        error: {
                            message: 'User Rate Limit Exceeded',
                            errors: [{ reason: 'userRateLimitExceeded' }],
                        },
                    }),
                    { status: 403, headers: { 'content-type': 'application/json' } },
                ),
            ),
        );
    }, 120_000);
    afterAll(async () => {
        vi.restoreAllMocks();
        await server.destroy();
        rmSync(directory, { recursive: true, force: true });
    });

    it('retries an existing failed import without changing its SKU or duplicating records', async () => {
        const job = await preview(1, 'RETRY');
        const native = server.app.get(NativeContentTranslationService);
        const oldBehavior = vi
            .spyOn(native, 'translateEntity')
            .mockRejectedValue(new Error('User Rate Limit Exceeded'));
        try {
            await imports.queueExecution(ctx, job.id);
            await imports.executeJob(ctx, job.id, () => undefined);
        } finally {
            oldBehavior.mockRestore();
        }
        expect((await imports.findJob(ctx, job.id)).state).toBe('COMPLETED_WITH_ERRORS');
        const [failed] = await imports.findRows(ctx, job.id);
        expect(failed).toMatchObject({ action: 'ERROR', appliedAt: null });
        expect(await connection.rawConnection.getRepository(ProductVariant).countBy({ sku: 'RETRY-0' })).toBe(
            0,
        );

        await imports.resolveRow(ctx, { rowId: failed.id, resolution: 'APPLY' });
        await imports.queueExecution(ctx, job.id);
        await imports.executeJob(ctx, job.id, () => undefined);
        expect((await imports.findJob(ctx, job.id)).state).toBe('COMPLETED');
        expect(await connection.rawConnection.getRepository(ProductVariant).countBy({ sku: 'RETRY-0' })).toBe(
            1,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    }, 120_000);

    it('persists 362 rows without provider requests and fills English after background recovery', async () => {
        const before = await connection.rawConnection.getRepository(ProductVariant).count();
        const job = await preview(362, 'BATCH');
        await imports.queueExecution(ctx, job.id);
        await imports.executeJob(ctx, job.id, () => undefined);
        expect((await imports.findJob(ctx, job.id)).state).toBe('COMPLETED');
        const rows = await imports.findRows(ctx, job.id);
        expect(rows).toHaveLength(362);
        expect(rows.every(row => row.appliedAt && row.action === 'CREATE')).toBe(true);
        expect(await connection.rawConnection.getRepository(ProductVariant).count()).toBe(before + 362);
        expect(fetchMock).not.toHaveBeenCalled();
        const variant = await connection.rawConnection.getRepository(ProductVariant).findOneOrFail({
            where: { sku: 'BATCH-0' },
            relations: ['productVariantPrices', 'translations'],
        });
        expect(variant.productVariantPrices[0].price).toBe(1200);
        expect(
            (
                await connection.rawConnection
                    .getRepository(StockLevel)
                    .findOneByOrFail({ productVariantId: variant.id })
            ).stockOnHand,
        ).toBe(10);
        const product = await connection.rawConnection.getRepository(Product).findOneOrFail({
            where: { id: variant.productId },
            relations: ['translations'],
        });
        expect(product.translations.find(row => row.languageCode === LanguageCode.zh_Hans)?.name).toBe(
            '测试文具BATCH0',
        );
        expect(product.translations.find(row => row.languageCode === LanguageCode.en)?.name).toBe('');
        const states = connection.rawConnection.getRepository(ContentTranslationState);
        expect(
            await states.findOneByOrFail({
                entityType: 'Product',
                entityId: String(product.id),
                fieldPath: 'name',
            }),
        ).toMatchObject({ status: 'PENDING', locked: false });
        const collections = await connection.rawConnection
            .getRepository(Collection)
            .find({ relations: ['translations', 'parent'] });
        const child = collections.find(item => item.translations.some(row => row.name === '笔记本'));
        expect(child?.parentId).toBe(
            collections.find(item => item.translations.some(row => row.name === '测试文具'))?.id,
        );

        // Only the worker contacts Google; its failure must not affect the completed import.
        const deferred = await server.app.get(ContentTranslationRetryService).retryPending();
        expect(deferred.deferred).toBeGreaterThan(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Simulate the provider's cooldown elapsing without delaying the real database or job queue.
        const recoveredAt = Date.now() + 60_001;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveredAt);
        fetchMock.mockImplementation((_url, options) => {
            if (typeof options?.body !== 'string') throw new Error('Expected a JSON translation request');
            const request = JSON.parse(options.body) as { q: string[] };
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        data: {
                            translations: request.q.map(() => ({ translatedText: 'Recovered stationery' })),
                        },
                    }),
                    { status: 200 },
                ),
            );
        });
        try {
            let translated = 0;
            // Unattempted rows run before previously throttled rows; advance the shared request interval
            // between bounded sweeps instead of assuming this product belongs to the first batch.
            for (let sweep = 0; sweep < 60; sweep++) {
                clock.mockReturnValue(recoveredAt + sweep * 1001);
                const result = await server.app.get(ContentTranslationRetryService).retryPending();
                translated += result.translated;
                expect(result.scanned).toBeLessThanOrEqual(100);
                const state = await states.findOneByOrFail({
                    entityType: 'Product',
                    entityId: String(product.id),
                    fieldPath: 'name',
                });
                if (state.status === 'AUTO_TRANSLATED') break;
            }
            expect(translated).toBeGreaterThan(0);
        } finally {
            clock.mockRestore();
        }
        const refreshed = await connection.rawConnection.getRepository(Product).findOneOrFail({
            where: { id: product.id },
            relations: ['translations'],
        });
        expect(refreshed.translations.find(row => row.languageCode === LanguageCode.en)?.name).toBe(
            'Recovered stationery',
        );
        expect(refreshed.translations.find(row => row.languageCode === LanguageCode.zh_Hans)?.name).toBe(
            '测试文具BATCH0',
        );
    }, 120_000);
});
