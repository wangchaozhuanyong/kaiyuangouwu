import {
    CatalogSyncRule,
    ConfigService,
    CurrencyCode,
    Order,
    OrderLine,
    Payment,
    ProductVariant,
    ProductVariantPrice,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { expect, it } from 'vitest';

import { CatalogSyncQueueService } from '../../catalog-management-plugin/src/catalog-sync-queue.service';
import { CatalogSyncService } from '../../catalog-management-plugin/src/catalog-sync.service';
import { DigitalDeliveryService } from '../../commerce-fulfillment-plugin/src/digital-delivery.service';
import { DigitalFileService } from '../../commerce-fulfillment-plugin/src/digital-file.service';
import { DigitalProductService } from '../../commerce-fulfillment-plugin/src/digital-product.service';
import { CatalogSyncSourceService } from '../src/catalog-sync-source.service';

import { requireSyntheticFixture } from './catalog-sync-fixture-links';

interface Fixture {
    server: { app: { get<T>(token: new (...args: any[]) => T): T } };
    connection: TransactionalConnection;
    platform: RequestContext;
    a: RequestContext;
    b: RequestContext;
    rule: CatalogSyncRule;
    sync: CatalogSyncService;
    sources: CatalogSyncSourceService;
    drain: () => Promise<void>;
    makeProduct: (name: string) => Promise<{ id: string; variantId: string }>;
    products: Array<{ id: string; variantId: string }>;
}

const evidence = path.resolve(__dirname, '../../../docs/local-validation/catalog-continuous-sync-20261015');
const closeout = process.env.CATALOG_SYNC_CLOSEOUT === '1';

function download(url: URL, host: string) {
    return new Promise<{ status: number | undefined; body: string; cacheControl: string | undefined }>(
        (resolve, reject) => {
            const req = request(url, { headers: { host } }, response => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode,
                        body: Buffer.concat(chunks).toString(),
                        cacheControl: response.headers['cache-control'],
                    }),
                );
                response.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        },
    );
}

export function registerCatalogSyncCloseoutAcceptance(fixture: () => Fixture) {
    it.runIf(closeout)(
        'uploads a private source file and downloads the frozen version only through the buyer host',
        async () => {
            const f = fixture();
            const fileService = f.server.app.get(DigitalFileService);
            const digital = f.server.app.get(DigitalProductService);
            const item = await f.makeProduct('private-file-closeout');
            const upload = (name: string, content: string) =>
                fileService.upload(
                    f.a,
                    Promise.resolve({
                        filename: name,
                        createReadStream: () => Readable.from([Buffer.from(content)]),
                    }),
                );
            const original = await upload('original.txt', 'synthetic source version one');
            await f.connection.withTransaction(f.a, tx =>
                digital.update(tx, {
                    productVariantId: Number(item.variantId),
                    deliveryMode: 'file_download',
                    stockPolicy: 'unlimited',
                    fileVersionId: original.id,
                }),
            );
            await f.drain();
            const variant = await f.connection.rawConnection.getRepository(ProductVariant).findOneOrFail({
                where: { id: Number(item.variantId) },
                relations: ['product'],
            });
            const order = await f.connection.rawConnection.getRepository(Order).save(
                new Order({
                    code: 'SYNC-PRIVATE-FILE',
                    active: true,
                    state: 'AddingItems',
                    currencyCode: CurrencyCode.MYR,
                    channels: [f.b.channel],
                    salesChannelId: f.b.channelId,
                    couponCodes: [],
                    subTotal: 600,
                    subTotalWithTax: 600,
                    shippingAddress: {},
                    billingAddress: {},
                }),
            );
            const line = await f.connection.rawConnection.getRepository(OrderLine).save(
                new OrderLine({
                    order,
                    productVariant: variant,
                    quantity: 1,
                    listPrice: 600,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [],
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'file_download',
                    },
                }),
            );
            order.lines = [line];
            await f.connection.withTransaction(f.b, async tx => {
                await f.sources.snapshotOrder(tx, order);
                await digital.reserveOrder(tx, order);
            });
            const buyerHost = 'buyer-store.example.test';
            const buyer = new RequestContext({
                apiType: 'shop',
                channel: f.b.channel,
                currencyCode: f.b.currencyCode,
                isAuthorized: true,
                authorizedAsOwnerOnly: true,
                req: { headers: { host: buyerHost } } as never,
            });
            const deliveries = f.server.app.get(DigitalDeliveryService);
            expect((await deliveries.deliveriesForOrder(buyer, String(order.id)))[0].status).toBe(
                'PAYMENT_REQUIRED',
            );
            await f.connection.rawConnection
                .getRepository(Order)
                .update(order.id, { state: 'PaymentSettled', active: false, orderPlacedAt: new Date() });
            await f.connection.rawConnection.getRepository(Payment).save(
                new Payment({
                    order,
                    method: 'synthetic-local-receipt',
                    amount: 600,
                    state: 'Settled',
                    metadata: {},
                }),
            );
            await f.connection.withTransaction(f.b, tx => digital.consumeLine(tx, line.id));
            const replacement = await upload('replacement.txt', 'synthetic source version two');
            await f.connection.withTransaction(f.a, tx =>
                digital.update(tx, {
                    productVariantId: variant.id,
                    deliveryMode: 'file_download',
                    stockPolicy: 'unlimited',
                    fileVersionId: replacement.id,
                }),
            );
            const [delivery] = await deliveries.deliveriesForOrder(buyer, String(order.id));
            expect(delivery.status).toBe('READY');
            const url = new URL(
                requireSyntheticFixture(delivery.downloadUrl),
                `http://127.0.0.1:${process.env.CATALOG_SYNC_TEST_PORT ?? '3477'}`,
            );
            const correct = await download(url, buyerHost);
            expect(correct.status).toBe(200);
            expect(correct.body).toBe('synthetic source version one');
            expect(correct.cacheControl).toContain('private, no-store');
            expect((await download(url, 'source-store.example.test')).status).toBe(404);
            expect(await fileService.resource(f.b.channelId, original.id)).toBeUndefined();
            await expect(
                f.connection.withTransaction(f.b, tx =>
                    digital.update(tx, {
                        productVariantId: variant.id,
                        deliveryMode: 'file_download',
                        fileVersionId: original.id,
                    }),
                ),
            ).rejects.toThrow('来源店铺');
            const disk = requireSyntheticFixture(await fileService.resource(f.a.channelId, original.id));
            expect(await readFile(disk.path, 'utf8')).toBe('synthetic source version one');
            await writeFile(
                path.join(evidence, `private-file-${f.connection.rawConnection.options.type}.json`),
                JSON.stringify(
                    {
                        synthetic: true,
                        uploadService: true,
                        buyerHttpStatus: correct.status,
                        frozenOriginalContent: true,
                        wrongHostStatus: 404,
                        targetPrivateLibraryDenied: true,
                    },
                    null,
                    2,
                ),
            );
        },
        120_000,
    );

    it.runIf(closeout && process.env.PLATFORM_GOVERNANCE_MYSQL === '1')(
        'recovers after SIGKILL of a lease-holding isolated process and the real sixty-second lease expiry',
        async () => {
            const f = fixture();
            await f.drain();
            const rules = f.connection.rawConnection.getRepository(CatalogSyncRule);
            const deadline = Date.now() + 60_000;
            while ((await rules.findOneByOrFail({ id: f.rule.id })).leaseToken) {
                if (Date.now() > deadline) throw new Error('Worker lease was not released');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const child = spawn(
                process.execPath,
                [
                    path.join(__dirname, 'catalog-sync-crash-worker.mjs'),
                    requireSyntheticFixture(process.env.CATALOG_SYNC_CRASH_CASE),
                    requireSyntheticFixture(process.env.CATALOG_SYNC_CRASH_DATABASE),
                    String(f.rule.id),
                    String(f.products[99].id),
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            let childFailure = '';
            child.stderr.on('data', (chunk: Buffer) => {
                childFailure += chunk.toString();
            });
            try {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(
                        () => reject(new Error('Synthetic crash process did not acquire its lease')),
                        30_000,
                    );
                    child.stdout.on('data', (chunk: Buffer) => {
                        if (chunk.toString().includes('SYNTHETIC_LEASE_READY')) {
                            clearTimeout(timeout);
                            resolve();
                        }
                    });
                    child.once('error', error => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                    child.once('exit', () => {
                        clearTimeout(timeout);
                        reject(
                            new Error(
                                `Synthetic crash process exited before lease readiness: ${childFailure}`,
                            ),
                        );
                    });
                });
                const crashedLease = await rules.findOneByOrFail({ id: f.rule.id });
                const exited = once(child, 'exit');
                child.kill('SIGKILL');
                const [, signal] = await exited;
                expect(signal).toBe('SIGKILL');
                await f.connection.rawConnection.getRepository(ProductVariantPrice).update(
                    {
                        channelId: f.a.channelId,
                        variant: { id: f.products[0].variantId },
                        currencyCode: CurrencyCode.CNY,
                    },
                    { price: 1600 },
                );
                const queue = f.server.app.get(CatalogSyncQueueService) as unknown as {
                    process(id: string | number): Promise<void>;
                };
                await queue.process(f.rule.id);
                expect((await rules.findOneByOrFail({ id: f.rule.id })).leaseToken).toBe(
                    crashedLease.leaseToken,
                );
                while (Date.now() <= requireSyntheticFixture(crashedLease.leaseUntil).getTime() + 100)
                    await new Promise(resolve => setTimeout(resolve, 200));
                await f.drain();
                const price = await f.connection.rawConnection
                    .getRepository(ProductVariantPrice)
                    .findOneByOrFail({
                        channelId: f.b.channelId,
                        variant: { id: f.products[0].variantId },
                        currencyCode: CurrencyCode.MYR,
                    });
                expect(price.price).toBe(960);
                await writeFile(
                    path.join(evidence, 'sigkill-recovery-mysql.json'),
                    JSON.stringify(
                        {
                            synthetic: true,
                            scope: 'isolated fault-injection process holding a native-format rule lease',
                            signal,
                            leaseMilliseconds: 60_000,
                            nativeWorkerRecovered: true,
                            firstPagePriceRecovered: true,
                        },
                        null,
                        2,
                    ),
                );
            } finally {
                if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
            }
        },
        180_000,
    );

    it.runIf(closeout)(
        'observes the real five-minute scheduler recovering an omitted event without manual enqueue',
        async () => {
            const f = fixture();
            await f.drain();
            const rules = f.connection.rawConnection.getRepository(CatalogSyncRule);
            const deadline = Date.now() + 60_000;
            while ((await rules.findOneByOrFail({ id: f.rule.id })).leaseToken) {
                if (Date.now() > deadline) throw new Error('Worker lease was not released');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const started = Date.now();
            await f.connection.rawConnection.getRepository(ProductVariantPrice).update(
                {
                    channelId: f.a.channelId,
                    variant: { id: f.products[0].variantId },
                    currencyCode: CurrencyCode.CNY,
                },
                { price: 1700 },
            );
            const scheduler = f.server.app.get(ConfigService).schedulerOptions.schedulerStrategy;
            while (Date.now() - started < 330_000) {
                const report = await scheduler.getTask('reconcile-catalog-continuous-sync');
                const price = await f.connection.rawConnection
                    .getRepository(ProductVariantPrice)
                    .findOneByOrFail({
                        channelId: f.b.channelId,
                        variant: { id: f.products[0].variantId },
                        currencyCode: CurrencyCode.MYR,
                    });
                if (
                    report?.lastExecutedAt &&
                    new Date(report.lastExecutedAt).getTime() >= started &&
                    price.price === 1020
                ) {
                    await writeFile(
                        path.join(
                            evidence,
                            `scheduled-reconciliation-${f.connection.rawConnection.options.type}.json`,
                        ),
                        JSON.stringify(
                            {
                                synthetic: true,
                                manualEnqueue: false,
                                scheduleMinutes: 5,
                                observedMilliseconds: Date.now() - started,
                                scheduledAt: report.lastExecutedAt,
                                correctedTargetPrice: price.price,
                            },
                            null,
                            2,
                        ),
                    );
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            throw new Error('Native five-minute scheduler did not reconcile the deliberately omitted event');
        },
        360_000,
    );
}
