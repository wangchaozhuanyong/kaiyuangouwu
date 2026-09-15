import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
    PluginCommonModule,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { CommerceModeService } from '../../commerce-fulfillment-plugin/src/commerce-mode.service';
import { PackagingUnpackEvent } from '../../commerce-fulfillment-plugin/src/entities/packaging-unpack-event.entity';
import { ProductPackagingRule } from '../../commerce-fulfillment-plugin/src/entities/product-packaging-rule.entity';
import { FulfillmentModelService } from '../../commerce-fulfillment-plugin/src/fulfillment-model.service';
import { CatalogImportService } from '../src/catalog-import.service';
import { CatalogManagementPlugin } from '../src/catalog-management.plugin';
import { CatalogOperationsService } from '../src/catalog-operations.service';
import { catalogImportTemplateCsv } from '../src/dashboard/catalog-import-template';
import { parseCatalogArrayBuffer, rowsForCatalogTransport } from '../src/dashboard/catalog-local-file';
import { CatalogImportRow } from '../src/entities/catalog-import-row.entity';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [CommerceModeService, FulfillmentModelService],
    entities: [ProductPackagingRule, PackagingUnpackEvent],
})
class ImportVersionTestPlugin {}
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37382 },
    customFields: {
        Channel: [{ name: 'commerceMode', type: 'string', defaultValue: 'HYBRID' }],
        Product: [{ name: 'fulfillmentType', type: 'string', defaultValue: 'digital' }],
        ProductVariant: [
            { name: 'fulfillmentType', type: 'string', defaultValue: 'digital' },
            { name: 'digitalStockPolicy', type: 'string', defaultValue: 'limited' },
            { name: 'digitalDeliveryMode', type: 'string', defaultValue: 'manual_service' },
        ],
    },
    plugins: [
        CatalogManagementPlugin,
        DefaultJobQueuePlugin,
        ImportVersionTestPlugin,
        DefaultSearchPlugin.init({ bufferUpdates: true }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
let ctx: RequestContext;
let connection: TransactionalConnection;
let imports: CatalogImportService;
let csv: string;

function required<T>(value: T | null | undefined, label: string): T {
    if (value == null) throw new Error(`Expected ${label}`);
    return value;
}

async function preview(price: number) {
    const parsed = await parseCatalogArrayBuffer(
        new TextEncoder().encode(csv.replace('"5"', '"' + price + '"')).buffer,
        'versions.csv',
    );
    expect(parsed.errors).toEqual([]);
    const [location] = await server.app.get(CatalogOperationsService).stockLocations(ctx);
    const job = await imports.beginImport(ctx, {
        context: { channelId: ctx.channelId, stockLocationId: location.id, currencyCode: ctx.currencyCode },
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
        totalRows: parsed.rows.length,
    });
    await imports.appendRows(ctx, { jobId: job.id, rows: rowsForCatalogTransport(parsed.rows) });
    await imports.finalizePreview(ctx, job.id);
    const rows = await imports.findRows(ctx, job.id);
    for (const row of rows.filter(candidate => candidate.action === 'WARNING')) {
        await imports.resolveRow(ctx, { rowId: row.id, resolution: 'APPLY' });
    }
    return job;
}
async function execute(id: string | number) {
    await imports.queueExecution(ctx, id);
    await imports.executeJob(ctx, id, () => undefined);
    return imports.findRows(ctx, id);
}
beforeAll(async () => {
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 0,
    });
    connection = server.app.get(TransactionalConnection);
    await adminClient.asSuperAdmin();
    const credentials = required(config.authOptions.superadminCredentials, 'superadmin credentials');
    const user = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: credentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    ctx = await server.app.get(RequestContextService).create({ apiType: 'admin', user });
    imports = server.app.get(CatalogImportService);
    imports.registerEnqueuer(() => Promise.resolve());
    csv = catalogImportTemplateCsv(ctx.channel.code).split('\r\n').slice(0, 2).join('\r\n');
    const created = await preview(5);
    expect((await execute(created.id)).map(row => row.action)).not.toContain('ERROR');
}, 120000);
afterAll(async () => {
    await server.destroy();
});

it('preserves fractional preview versions and allows an ordinary unchanged-source update', async () => {
    const variant = await connection
        .getRepository(ctx, ProductVariant)
        .findOneByOrFail({ sku: 'EXAMPLE-PHYSICAL-001' });
    // Use a deterministic non-zero fractional value so the old datetime(0) schema cannot pass.
    await connection
        .getRepository(ctx, Product)
        .update(variant.productId, { updatedAt: new Date('2026-09-14T01:02:03.123Z') });
    await connection
        .getRepository(ctx, ProductVariant)
        .update(variant.id, { updatedAt: new Date('2026-09-14T01:02:03.456Z') });
    const job = await preview(6);
    const [row] = await imports.findRows(ctx, job.id);
    expect(row.expectedProductUpdatedAt?.getUTCMilliseconds()).toBe(123);
    expect(row.expectedVariantUpdatedAt?.getUTCMilliseconds()).toBe(456);
    expect(row.beforeSnapshot?.previewTimestampPrecision).toBe(6);
    expect((await execute(job.id))[0].action).not.toBe('ERROR');
    expect((await imports.findJob(ctx, job.id)).state).toBe('COMPLETED');
});

it('rejects a product changed after preview and keeps the later change', async () => {
    const job = await preview(7);
    const [row] = await imports.findRows(ctx, job.id);
    const targetProductId = required(row.targetProductId, 'target product id');
    const later = new Date(
        required(row.expectedProductUpdatedAt, 'expected product timestamp').getTime() + 10,
    );
    await connection
        .getRepository(ctx, Product)
        .update(targetProductId, { enabled: false, updatedAt: later });
    const [result] = await execute(job.id);
    expect(result.action).toBe('ERROR');
    expect(result.message).toContain('预览后被修改');
    expect(
        (await connection.getRepository(ctx, Product).findOneByOrFail({ id: targetProductId })).enabled,
    ).toBe(false);
});

it('rejects old previews with unrecoverable timestamp precision before any catalog write', async () => {
    const job = await preview(8);
    const [row] = await imports.findRows(ctx, job.id);
    const targetVariantId = required(row.targetVariantId, 'target variant id');
    const before = await connection
        .getRepository(ctx, ProductVariant)
        .findOneByOrFail({ id: targetVariantId });
    const legacySnapshot = { ...row.beforeSnapshot };
    delete legacySnapshot.previewTimestampPrecision;
    await connection.getRepository(ctx, CatalogImportRow).update(row.id, { beforeSnapshot: legacySnapshot });
    const [result] = await execute(job.id);
    expect(result.action).toBe('ERROR');
    expect(result.message).toContain('旧版本生成');
    expect(
        await connection.getRepository(ctx, ProductVariant).findOneByOrFail({ id: targetVariantId }),
    ).toEqual(before);
});

it('refreshes versions on explicit SKU selection but still rejects a later SKU change', async () => {
    const job = await preview(9);
    const [row] = await imports.findRows(ctx, job.id);
    await connection.getRepository(ctx, CatalogImportRow).update(row.id, { action: 'ERROR' });
    const resolved = await imports.resolveRow(ctx, {
        rowId: row.id,
        resolution: 'UPDATE_EXISTING',
        targetVariantId: String(row.targetVariantId),
    });
    expect(resolved.expectedProductUpdatedAt).toBeInstanceOf(Date);
    expect(resolved.beforeSnapshot?.previewTimestampPrecision).toBe(6);
    const targetVariantId = required(row.targetVariantId, 'target variant id');
    await connection.getRepository(ctx, ProductVariant).update(targetVariantId, {
        updatedAt: new Date(
            required(resolved.expectedVariantUpdatedAt, 'resolved variant timestamp').getTime() + 10,
        ),
    });
    const [result] = await execute(job.id);
    expect(result.action).toBe('ERROR');
    expect(result.message).toContain('SKU 在预览后被修改');
    // Explicitly review the target again; unchanged versions then execute successfully.
    await imports.resolveRow(ctx, {
        rowId: row.id,
        resolution: 'UPDATE_EXISTING',
        targetVariantId: String(row.targetVariantId),
    });
    expect((await execute(job.id))[0].action).not.toBe('ERROR');
});
