import {
    Customer,
    Fulfillment,
    FulfillmentLine,
    Order,
    OrderLine,
    Payment,
    ProductVariant,
    Refund,
    RefundLine,
} from '@vendure/core';
import { createConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import 'reflect-metadata';
import { DataSource, EntitySchema, type EntityTarget } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { CheckoutResourceHold, DigitalOrderReservation } from './entities/digital-product.entity';
import { FulfillmentDeliveryRecord } from './entities/fulfillment-delivery-record.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { OrderProcessingProjection, type ProcessingFileCandidate } from './order-processing-projection';
import {
    matchesProcessingCategory,
    summarizeProcessing,
    type ProcessingCategory,
    type ProcessingSource,
} from './order-processing-summary';

// Minimal SQL schemas isolate the projection from unrelated plugins, while using the exact
// production entity targets, column paths, simple-json storage and single-table line references.
const fields = (names: string[]) =>
    Object.fromEntries(
        names.map(name => [
            name,
            {
                type:
                    name !== 'transactionId' &&
                    /(?:Id|Quantity|quantity|amount|total|shippingWithTax|subTotalWithTax)$/u.test(name)
                        ? Number
                        : /(?:At)$/u.test(name)
                          ? Date
                          : name === 'active'
                            ? Boolean
                            : String,
                nullable: name !== 'id',
                ...(name === 'id' ? { primary: true, type: Number } : {}),
            },
        ]),
    );
const schema = (target: EntityTarget<any>, tableName: string, names: string[], extra: object = {}) => {
    if (typeof target !== 'function') throw new Error('Fixture schemas require an entity constructor');
    return new EntitySchema({
        name: target.name,
        target,
        tableName,
        columns: fields(['id', ...names]),
        ...extra,
    });
};
const snapshot = new EntitySchema({
    name: 'ProjectionLineFields',
    columns: fields(['fulfillmentTypeSnapshot', 'digitalDeliveryModeSnapshot']),
});
const variantFields = new EntitySchema({
    name: 'ProjectionVariantFields',
    columns: fields(['fulfillmentType', 'digitalDeliveryMode']),
});
const schemas = [
    schema(Customer, 'customer', ['emailAddress', 'firstName', 'lastName']),
    schema(
        Order,
        'order',
        [
            'state',
            'active',
            'orderPlacedAt',
            'createdAt',
            'code',
            'salesChannelId',
            'subTotalWithTax',
            'shippingWithTax',
        ],
        {
            relations: {
                customer: { type: 'many-to-one', target: 'Customer', joinColumn: { name: 'customerId' } },
            },
        },
    ),
    schema(OrderLine, 'order_line', ['orderId', 'productVariantId', 'quantity', 'orderPlacedQuantity'], {
        embeddeds: { customFields: { schema: snapshot } },
    }),
    schema(ProductVariant, 'product_variant', ['sku'], {
        embeddeds: { customFields: { schema: variantFields } },
    }),
    schema(Payment, 'payment', ['orderId', 'state', 'amount', 'method', 'transactionId'], {
        columns: {
            ...fields(['id', 'orderId', 'state', 'amount', 'method', 'transactionId']),
            metadata: { type: 'simple-json' },
        },
    }),
    schema(Refund, 'refund', ['paymentId', 'state', 'total'], {
        columns: { ...fields(['id', 'paymentId', 'state', 'total']), metadata: { type: 'simple-json' } },
    }),
    ...[RefundLine, FulfillmentLine].map(target =>
        schema(target, 'order_line_reference', [
            'orderLineId',
            'refundId',
            'fulfillmentId',
            'quantity',
            'discriminator',
        ]),
    ),
    schema(Fulfillment, 'fulfillment', ['state']),
    schema(AutoCardDelivery, 'auto_card_delivery', [
        'orderLineId',
        'orderId',
        'channelId',
        'state',
        'quantity',
    ]),
    schema(AutoCardPoolItem, 'auto_card_pool_item', ['deliveryId', 'state']),
    schema(ManualDigitalDelivery, 'manual_digital_delivery', [
        'orderLineId',
        'orderId',
        'channelId',
        'state',
        'quantity',
        'expectedAt',
        'encryptedPackages',
    ]),
    schema(DigitalOrderReservation, 'digital_order_reservation', [
        'orderLineId',
        'channelId',
        'fileVersionId',
    ]),
    schema(CheckoutResourceHold, 'checkout_resource_hold', ['orderId', 'state']),
    schema(AfterSalesRequest, 'after_sales_request', ['orderId', 'state']),
    schema(FulfillmentDeliveryRecord, 'fulfillment_delivery_record', [
        'orderId',
        'status',
        'nextActionDueAt',
    ]),
];

let db: DataSource;
let queryCount = 0;
const directory = resolve(__dirname, '../../../reports/experience-offline-20261013-projection-recovery');
const canonical = new Map<number, ProcessingSource>();
const readyFiles: ProcessingFileCandidate[] = [];
const ctx = { channelId: 1, channel: { code: 'projection-store-a' }, userHasPermissions: () => true } as any;
const connection = {
    get rawConnection() {
        return db;
    },
    getRepository: (_ctx: unknown, target: EntityTarget<any>) => db.getRepository(target),
} as any;
let sequence = 0;
async function insert(target: EntityTarget<any>, values: object[]) {
    if (values.length) await db.getRepository(target).insert(values);
}
function source(id: number, overrides: Partial<ProcessingSource> = {}): ProcessingSource {
    return {
        id: String(id),
        state: 'PaymentSettled',
        active: false,
        placed: true,
        canManage: true,
        canUpdate: true,
        totalWithTax: 1000,
        payments: [{ id: String(id * 10), state: 'Settled', amount: 1000, method: 'real', refunds: [] }],
        lines: [
            {
                id: String(id),
                productName: 'Fixture',
                sku: `sku-${id}`,
                quantity: 2,
                placedQuantity: 2,
                type: 'digital',
                mode: 'manual_service',
                fulfillments: [],
            },
        ],
        afterSales: [],
        deliveryException: false,
        ...overrides,
    };
}
async function seed(value: ProcessingSource, channelId = 1) {
    const id = Number(value.id);
    await insert(Order, [
        {
            id,
            code: `PROJECTION-${id}`,
            salesChannelId: channelId,
            active: value.active,
            state: value.state,
            orderPlacedAt: value.placed ? new Date('2026-01-01T00:00:00Z') : null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            subTotalWithTax: value.totalWithTax,
            shippingWithTax: 0,
        },
    ]);
    await insert(
        ProductVariant,
        value.lines.map(line => ({
            id: Number(line.id),
            sku: line.sku,
            customFields: { fulfillmentType: 'physical', digitalDeliveryMode: 'auto_card' },
        })),
    );
    await insert(
        OrderLine,
        value.lines.map(line => ({
            id: Number(line.id),
            orderId: id,
            productVariantId: Number(line.id),
            quantity: line.quantity,
            orderPlacedQuantity: line.placedQuantity,
            customFields: { fulfillmentTypeSnapshot: line.type, digitalDeliveryModeSnapshot: line.mode },
        })),
    );
    for (const payment of value.payments) {
        await insert(Payment, [
            {
                id: Number(payment.id),
                orderId: id,
                state: payment.state,
                amount: payment.amount,
                method: payment.method,
                transactionId: `TRANS-${id}`,
                metadata: {
                    public: { testPayment: payment.isTest },
                    manualReview: {
                        required: payment.receivedReview,
                        receivedState: payment.receivedReview ? 'Settled' : undefined,
                    },
                },
            },
        ]);
        for (const refund of payment.refunds) {
            const refundId = ++sequence;
            await insert(Refund, [
                {
                    id: refundId,
                    paymentId: Number(payment.id),
                    state: refund.state,
                    total: refund.total,
                    metadata: refund.metadata ?? {},
                },
            ]);
            await insert(
                RefundLine,
                (refund.lines ?? []).map(line => ({
                    id: ++sequence,
                    refundId,
                    orderLineId: Number(line.orderLineId),
                    quantity: line.quantity,
                    discriminator: 'RefundLine',
                })),
            );
        }
    }
    for (const line of value.lines) {
        for (const fulfillment of line.fulfillments) {
            const fulfillmentId = ++sequence;
            await insert(Fulfillment, [{ id: fulfillmentId, state: fulfillment.state }]);
            await insert(FulfillmentLine, [
                {
                    id: ++sequence,
                    orderLineId: Number(line.id),
                    fulfillmentId,
                    quantity: fulfillment.quantity,
                    discriminator: 'FulfillmentLine',
                },
            ]);
        }
        const task = line.task;
        if (task) {
            const target = line.mode === 'auto_card' ? AutoCardDelivery : ManualDigitalDelivery;
            await insert(target, [
                {
                    id: Number(task.id),
                    orderId: id,
                    orderLineId: Number(line.id),
                    channelId,
                    state: task.state,
                    quantity: task.quantity,
                    ...(target === ManualDigitalDelivery
                        ? {
                              encryptedPackages: line.delivery?.readyQuantity
                                  ? 'opaque-encrypted-payload'
                                  : null,
                              expectedAt: new Date(
                                  task.overdue ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
                              ),
                          }
                        : {}),
                },
            ]);
            if (target === AutoCardDelivery)
                await insert(
                    AutoCardPoolItem,
                    Array.from({ length: line.delivery?.readyQuantity ?? 0 }, () => ({
                        id: ++sequence,
                        deliveryId: Number(task.id),
                        state: 'ASSIGNED',
                    })),
                );
        }
        if (line.fileReady)
            readyFiles.push({ channelId: String(channelId), fileVersionId: null, sku: line.sku });
    }
    if (value.resourceReviewReason)
        await insert(CheckoutResourceHold, [{ id: ++sequence, orderId: id, state: 'REVIEW' }]);
    if (value.deliveryException)
        await insert(FulfillmentDeliveryRecord, [
            {
                id: ++sequence,
                orderId: id,
                status: 'IN_TRANSIT',
                nextActionDueAt: new Date('2020-01-01T00:00:00Z'),
            },
        ]);
    await insert(
        AfterSalesRequest,
        value.afterSales.map(item => ({ id: ++sequence, orderId: id, state: item.state })),
    );
    if (channelId === 1) canonical.set(id, value);
}

beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    let options: any = { type: 'sqljs' };
    if (process.env.DB === 'mysql') {
        if (process.env.ORDER_CLOSURE_MYSQL !== '1' || !process.env.ORDER_CLOSURE_MYSQL_PASSWORD)
            throw new Error('Projection tests require the owned isolated MySQL runner');
        const admin = await createConnection({
            host: '127.0.0.1',
            port: 37406,
            user: 'root',
            password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
        });
        const database = `order_closure_projection_${randomUUID().replace(/-/gu, '')}`;
        await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]);
        await admin.end();
        options = {
            type: 'mysql',
            host: '127.0.0.1',
            port: 37406,
            username: 'root',
            password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
            database,
            timezone: 'Z',
        };
    }
    db = new DataSource({
        ...options,
        entities: schemas,
        synchronize: true,
        logger: {
            logQuery: () => {
                queryCount++;
            },
            logQueryError() {
                return undefined;
            },
            logQuerySlow() {
                return undefined;
            },
            logSchemaBuild() {
                return undefined;
            },
            logMigration() {
                return undefined;
            },
            log() {
                return undefined;
            },
        },
    });
    await db.initialize();
    // Production join/FK indexes, without introducing a production schema migration.
    for (const [target, property] of [
        [OrderLine, 'orderId'],
        [Payment, 'orderId'],
        [Refund, 'paymentId'],
        [RefundLine, 'orderLineId'],
        [RefundLine, 'refundId'],
        [FulfillmentLine, 'fulfillmentId'],
        [ManualDigitalDelivery, 'orderLineId'],
        [AutoCardDelivery, 'orderLineId'],
        [AutoCardPoolItem, 'deliveryId'],
        [AfterSalesRequest, 'orderId'],
        [CheckoutResourceHold, 'orderId'],
        [FulfillmentDeliveryRecord, 'orderId'],
    ] as const) {
        const metadata = db.getMetadata(target);
        const column = metadata.columns.find(item => item.propertyName === property);
        if (!column) throw new Error('Missing fixture index column: ' + property);
        const indexName = db.driver.escape('projection_' + target.name + '_' + property);
        const tableName = db.driver.escape(metadata.tableName);
        const columnName = db.driver.escape(column.databaseName);
        await db.query(`CREATE INDEX ${indexName} ON ${tableName} (${columnName})`);
    }
}, 120000);
afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
});

describe('actual SQL order classification', () => {
    it('matches canonical summaries, including split refunds, pending manual payments, notifications, files and logistics', async () => {
        const fixtures: ProcessingSource[] = [];
        const add = (overrides: Partial<ProcessingSource> = {}) => {
            const value = source(fixtures.length + 1, overrides);
            fixtures.push(value);
            return value;
        };
        add();
        for (const state of [
            'SENT',
            'EMAIL_FAILED',
            'SENDING',
            'MANUAL_REVIEW',
            'DRAFT',
            'WAITING_PROCESSING',
        ]) {
            const value = add();
            const line = value.lines[0];
            const readyQuantity = ['SENT', 'EMAIL_FAILED', 'SENDING', 'MANUAL_REVIEW'].includes(state)
                ? 2
                : 0;
            line.task = {
                id: String(Number(line.id) + 1000),
                state,
                quantity: 2,
                overdue: state === 'DRAFT',
            };
            line.delivery = {
                readyQuantity,
                notificationStatus:
                    state === 'EMAIL_FAILED' || state === 'MANUAL_REVIEW'
                        ? 'FAILED'
                        : state === 'SENT'
                          ? 'SENT'
                          : state === 'SENDING'
                            ? 'QUEUED'
                            : 'NONE',
            };
        }
        for (const ready of [false, true]) {
            const value = add();
            const line = value.lines[0];
            line.mode = 'file_download';
            line.fileReady = ready;
            line.delivery = { readyQuantity: ready ? 2 : 0, notificationStatus: 'NONE' };
        }
        for (const [state, readyQuantity] of [
            ['WAITING_STOCK', 0],
            ['EMAIL_FAILED', 1],
            ['SENT', 2],
        ] as const) {
            const value = add();
            const line = value.lines[0];
            line.mode = 'auto_card';
            line.task = { id: String(Number(line.id) + 1000), state, quantity: 2 };
            line.delivery = {
                readyQuantity,
                notificationStatus: state === 'EMAIL_FAILED' ? 'FAILED' : state === 'SENT' ? 'SENT' : 'NONE',
            };
        }
        for (const state of ['Created', 'Shipped', 'Delivered']) {
            const value = add();
            const line = value.lines[0];
            line.type = 'physical';
            line.fulfillments = [{ state, quantity: 2 }];
        }
        const transitException = add({ deliveryException: true });
        transitException.lines[0].type = 'physical';
        transitException.lines[0].fulfillments = [{ state: 'Shipped', quantity: 2 }];
        add({ resourceReviewReason: 'Review' });
        add({ state: 'Modifying' });
        add({ state: 'Cancelled' });
        add({ active: true, state: 'Draft', placed: false, payments: [] });
        add({
            state: 'AwaitingManualPayment',
            totalWithTax: 0,
            payments: [
                {
                    id: '2000',
                    state: 'PendingManual',
                    amount: 0,
                    method: 'offline',
                    kind: 'OFFLINE_MANUAL',
                    refunds: [],
                },
            ],
        });
        add({
            state: 'AwaitingManualPayment',
            payments: [{ id: '2010', state: 'PendingManual', amount: 1000, method: 'offline', refunds: [] }],
        });
        add({
            payments: [
                {
                    id: '2020',
                    state: 'Error',
                    amount: 1000,
                    method: 'offline',
                    receivedReview: true,
                    refunds: [],
                },
            ],
        });
        add({
            payments: [
                {
                    id: '2030',
                    state: 'Settled',
                    amount: 1000,
                    method: 'controlled-test-payment-fixture',
                    refunds: [],
                },
            ],
        });
        add({
            payments: [
                { id: '2040', state: 'Settled', amount: 1000, method: 'real', isTest: true, refunds: [] },
            ],
        });
        const authorization = add({
            payments: [{ id: '2050', state: 'Authorized', amount: 1000, method: 'real', refunds: [] }],
        });
        authorization.lines[0].type = 'physical';
        authorization.lines[0].fulfillments = [{ state: 'Shipped', quantity: 2 }];
        add({
            totalWithTax: 0,
            payments: [{ id: '2060', state: 'Settled', amount: 0, method: 'real', refunds: [] }],
        });
        const split = add();
        split.payments[0].refunds = [
            {
                state: 'Failed',
                total: 250,
                metadata: { refundRequest: { quantityGroup: { key: 'same-unit' } } },
                lines: [{ orderLineId: split.lines[0].id, quantity: 1 }],
            },
        ];
        split.payments.push({
            id: '2070',
            state: 'Settled',
            amount: 500,
            method: 'real',
            refunds: [
                {
                    state: 'Pending',
                    total: 250,
                    metadata: { refundRequest: { quantityGroup: { key: 'same-unit' } } },
                    lines: [],
                },
            ],
        });
        const afterSales = add({ afterSales: [{ id: '3000', state: 'APPROVED' }] });
        const fullRefund = add({ state: 'Cancelled' });
        fullRefund.payments[0].refunds = [
            { state: 'Settled', total: 1000, lines: [{ orderLineId: fullRefund.lines[0].id, quantity: 2 }] },
        ];
        add({
            payments: [
                {
                    id: '4000',
                    state: 'Settled',
                    amount: 1000,
                    method: 'Controlled-test-payment-fixture',
                    refunds: [],
                },
            ],
        });
        const distinctGroups = add();
        distinctGroups.lines[0].type = 'physical';
        distinctGroups.lines[0].fulfillments = [{ state: 'Shipped', quantity: 1 }];
        distinctGroups.payments[0].refunds = [
            {
                state: 'Failed',
                total: 250,
                metadata: { refundRequest: { quantityGroup: { key: 'case-sensitive' } } },
                lines: [{ orderLineId: distinctGroups.lines[0].id, quantity: 1 }],
            },
        ];
        distinctGroups.payments.push({
            id: '4010',
            state: 'Settled',
            amount: 500,
            method: 'real',
            refunds: [
                {
                    state: 'Pending',
                    total: 250,
                    metadata: { refundRequest: { quantityGroup: { key: 'CASE-SENSITIVE' } } },
                    lines: [],
                },
            ],
        });
        const refundedReview = add({
            payments: [
                {
                    id: '4020',
                    state: 'Settled',
                    amount: 1000,
                    method: 'offline',
                    receivedReview: true,
                    refunds: [],
                },
            ],
        });
        refundedReview.lines[0].type = 'physical';
        refundedReview.lines[0].fulfillments = [{ state: 'Shipped', quantity: 2 }];
        for (const fixture of fixtures) await seed(fixture);
        await seed(source(999), 2);
        const projection = new OrderProcessingProjection(connection, ctx, {});
        expect(await projection.fileCandidates()).toHaveLength(2);
        projection.prepare(readyFiles);
        const categories: ProcessingCategory[] = [
            'ALL',
            'PENDING',
            'DIGITAL',
            'PHYSICAL',
            'EXCEPTIONS',
            'AFTER_SALES',
            'DRAFT',
            'IN_TRANSIT',
            'DELIVERED',
            'CANCELLED',
            'TO_SETTLE',
            'LEGACY_TEST',
        ];
        for (const category of categories) {
            const expected = fixtures
                .filter(value =>
                    matchesProcessingCategory(summarizeProcessing(value), category, value.active),
                )
                .sort((a, b) => Number(b.placed) - Number(a.placed) || Number(b.id) - Number(a.id))
                .map(value => value.id);
            const page = await projection.page(category, 0, 100);
            expect(page.ids.map(String), category).toEqual(expected);
            expect(page.totalItems, category).toBe(expected.length);
        }
        const counts = await projection.counts();
        for (const [key, category] of Object.entries({
            pending: 'PENDING',
            digital: 'DIGITAL',
            physical: 'PHYSICAL',
            exceptions: 'EXCEPTIONS',
            afterSales: 'AFTER_SALES',
        } as const)) {
            expect(counts[key as keyof typeof counts]).toBe(
                fixtures.filter(value =>
                    matchesProcessingCategory(summarizeProcessing(value), category, value.active),
                ).length,
            );
        }
        expect(summarizeProcessing(afterSales).needsProcessing).toBe(true);
        expect(await projection.page('ALL', 1000, 20)).toEqual({ ids: [], totalItems: fixtures.length });
    }, 30000);

    it('applies SQL search and derived money/quantity sorting before pagination', async () => {
        const byMoney = new OrderProcessingProjection(connection, ctx, {
            term: 'TRANS-27',
            sortBy: 'totalWithTax',
            sortOrder: 'ASC',
        });
        byMoney.prepare(readyFiles);
        const page = await byMoney.page('ALL', 0, 20);
        expect(page.ids.map(String)).toEqual(['27']);
        expect(page.totalItems).toBe(1);
        const scope = new OrderProcessingProjection(connection, { ...ctx, channelId: 2 }, {});
        scope.prepare([]);
        expect((await scope.page('ALL', 0, 20)).ids.map(String)).toEqual(['999']);
    });

    it('keeps query counts constant for 1,000 / 10,000 orders and pages twenty IDs without hydrating history', async () => {
        const evidence: object[] = [];
        const initialSize = canonical.size;
        const initialPhysical = [...canonical.values()].filter(value =>
            matchesProcessingCategory(summarizeProcessing(value), 'PHYSICAL', value.active),
        ).length;
        for (const size of [1000, 10000]) {
            const existing = canonical.size;
            for (let offset = existing; offset < size; offset += 250) {
                const rows = Array.from({ length: Math.min(250, size - offset) }, (_, index) => ({
                    id: 10000 + offset + index,
                    state: 'PaymentSettled',
                    active: false,
                    salesChannelId: 1,
                    code: `SCALE-${offset + index}`,
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    orderPlacedAt: new Date('2026-01-01T00:00:00Z'),
                    subTotalWithTax: 1000,
                    shippingWithTax: 0,
                }));
                await insert(Order, rows);
                await insert(
                    ProductVariant,
                    rows.map(row => ({
                        id: row.id,
                        sku: `sku-${row.id}`,
                        customFields: { fulfillmentType: 'physical' },
                    })),
                );
                await insert(
                    OrderLine,
                    rows.map(row => ({
                        id: row.id,
                        orderId: row.id,
                        productVariantId: row.id,
                        quantity: 1,
                        orderPlacedQuantity: 1,
                        customFields: { fulfillmentTypeSnapshot: 'physical' },
                    })),
                );
                await insert(
                    Payment,
                    rows.map(row => ({
                        id: row.id,
                        orderId: row.id,
                        state: 'Settled',
                        amount: 1000,
                        method: 'real',
                        metadata: {},
                    })),
                );
                rows.forEach(row => canonical.set(row.id, source(row.id)));
            }
            const timings: number[] = [];
            const queries: number[] = [];
            const stages: object[] = [];
            for (let sample = 0; sample < 10; sample++) {
                const startCount = queryCount;
                const cpuStart = process.cpuUsage();
                const start = performance.now();
                const projection = new OrderProcessingProjection(connection, ctx, {});
                const files = await projection.fileCandidates();
                const filesReady = performance.now();
                projection.prepare(
                    readyFiles.filter(file =>
                        files.some(
                            candidate => candidate.channelId === file.channelId && candidate.sku === file.sku,
                        ),
                    ),
                );
                const prepared = performance.now();
                const page = await projection.page('PENDING', 0, 20);
                const pageReady = performance.now();
                const counts = await projection.counts();
                const countsReady = performance.now();
                expect(page.ids).toHaveLength(20);
                expect(counts.physical).toBe(size - initialSize + initialPhysical);
                queries.push(queryCount - startCount);
                const end = performance.now();
                timings.push(end - start);
                const cpu = process.cpuUsage(cpuStart);
                stages.push({
                    fileCandidatesMilliseconds: filesReady - start,
                    prepareMilliseconds: prepared - filesReady,
                    pageMilliseconds: pageReady - prepared,
                    countsMilliseconds: countsReady - pageReady,
                    assertionsMilliseconds: end - countsReady,
                    processCpuMilliseconds: (cpu.user + cpu.system) / 1000,
                });
            }
            expect(new Set(queries)).toEqual(new Set([3]));
            const sorted = [...timings].sort((a, b) => a - b);
            const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
            evidence.push({
                orders: size,
                pageSize: 20,
                sqlQueriesForFileReadinessPageAndCounts: queries[0],
                p95Milliseconds: Number(p95.toFixed(2)),
                samples: timings.map(value => Number(value.toFixed(2))),
                stages,
                nodeVersion: process.version,
                ci: Boolean(process.env.CI),
                database: db.options.type,
                fullOrderHydration: 0,
            });
            // Persist every sample, including a failing cold/outlier request, before enforcing the budget.
            writeFileSync(
                resolve(directory, `order-projection-scale-${db.options.type}.json`),
                JSON.stringify(
                    {
                        at: new Date().toISOString(),
                        scope: 'isolated actual SQL; synthetic lifecycle fixtures; page graph hydration checked separately',
                        measurements: evidence,
                    },
                    null,
                    2,
                ),
            );
            // A regression must remain visible; the accepted target applies to the complete request.
            expect(p95).toBeLessThan(800);
        }
    }, 120000);
});
