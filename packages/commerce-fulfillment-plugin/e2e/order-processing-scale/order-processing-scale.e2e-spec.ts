import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, GlobalFlag, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    DefaultLogger,
    LogLevel,
    mergeConfig,
    Order,
    OrderLine,
    Payment,
    PaymentMethod,
    PaymentMethodService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    Role,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import { buildClientSchema, getIntrospectionQuery, validate, type IntrospectionQuery } from 'graphql';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { EntitySubscriberInterface, Logger as SqlLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../../e2e-common/test-config';
import { GET_SALES_ORDERS } from '../../../next-admin/src/graphql/sales.graphql';
import { StoreProfile } from '../../../store-management-plugin/src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../../../store-management-plugin/src/store-management.plugin';
import { CommerceFulfillmentPlugin } from '../../src/commerce-fulfillment.plugin';
import { CommerceModeService } from '../../src/commerce-mode.service';
import { OFFLINE_MANUAL_CHECKER, OFFLINE_MANUAL_HANDLER } from '../../src/offline-manual-payment';
import { closureDatabase } from '../order-closure-db';

// The existing owned runner supplies a new synthetic database. No providers, SMTP or real writes.
const directory = path.resolve(
    __dirname,
    '../../../../docs/local-validation/experience-offline-20261013/admin',
);
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37397, hostname: '127.0.0.1' },
    dbConnectionOptions: closureDatabase(directory),
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    customFields: {
        Channel: [
            {
                name: 'storefrontNameZh',
                type: 'string',
                length: 32,
                nullable: false,
                public: true,
                defaultValue: '本地订单规模',
            },
            {
                name: 'storefrontNameEn',
                type: 'string',
                length: 32,
                nullable: false,
                public: true,
                defaultValue: 'Local graph scale',
            },
        ],
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
            { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
        ],
    },
    plugins: [
        OperationsDashboardPlugin,
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        StoreDomainPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'local-no-network',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'local-no-network',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({
            testPaymentsEnabled: false,
            evidenceStorage: { rootDirectory: directory, signingSecret: randomUUID() },
        }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
const superadminCredentials = required(config.authOptions.superadminCredentials);
let connection: TransactionalConnection;
let own: RequestContext;
let customer: Customer;
let variants: ProductVariant[];
const method = 'offline-scale-local';
let measuring = false;
let sqlQueries = 0;
const hydratedOrderIds = new Set<string>();
const hydratedLineIds = new Set<string>();
let hydrationEvents = 0;
const sqlErrors: string[] = [];
const ignoredSqlLog = () => undefined;
const logger: SqlLogger = {
    logQuery: () => {
        if (measuring) sqlQueries++;
    },
    logQueryError: () => {
        if (measuring) sqlErrors.push('SQL query failed');
    },
    logQuerySlow: ignoredSqlLog,
    logSchemaBuild: ignoredSqlLog,
    logMigration: ignoredSqlLog,
    log: ignoredSqlLog,
};
const subscriber: EntitySubscriberInterface = {
    afterLoad: entity => {
        if (!measuring) return;
        if (entity instanceof Order) {
            hydratedOrderIds.add(String(entity.id));
            hydrationEvents++;
        }
        if (entity instanceof OrderLine) hydratedLineIds.add(String(entity.id));
    },
};
function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Required integrated benchmark fixture is missing');
    return value;
}

beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [],
            shippingMethods: [],
        },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const user = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: superadminCredentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    const platform = await contexts.create({ apiType: 'admin', user });
    await server.app.get(CommerceModeService).updateActiveMode(platform, 'HYBRID');
    const channel = await server.app.get(ChannelService).create(platform, {
        code: 'graph-scale-local',
        token: 'graph-scale-local',
        defaultLanguageCode: LanguageCode.zh_Hans,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: true,
        defaultTaxZoneId: required(platform.channel.defaultTaxZone).id,
        defaultShippingZoneId: required(platform.channel.defaultShippingZone).id,
        customFields: { commerceMode: 'HYBRID' },
    });
    if (!('id' in channel)) throw new Error(channel.message);
    await connection
        .getRepository(platform, Role)
        .createQueryBuilder()
        .relation(Role, 'channels')
        .of(required(user.roles[0]).id)
        .add(channel.id);
    const scopedUser = await connection.getRepository(platform, User).findOneOrFail({
        where: { id: user.id },
        relations: ['roles', 'roles.channels'],
    });
    own = await contexts.create({ apiType: 'admin', user: scopedUser, channelOrToken: channel.token });
    await connection.getRepository(platform, StoreProfile).save(
        new StoreProfile({
            channelId: own.channelId,
            status: 'ACTIVE',
            isPublished: true,
            descriptionZh: '本地合成订单规模验收',
            descriptionEn: 'Synthetic integrated benchmark',
        }),
    );
    await connection.getRepository(platform, StoreDomain).save(
        new StoreDomain({
            channelId: own.channelId,
            domain: 'graph-scale-local.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: own.channelId,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    const paymentMethod = await server.app.get(PaymentMethodService).create(platform, {
        code: method,
        enabled: true,
        handler: { code: OFFLINE_MANUAL_HANDLER, arguments: [] },
        checker: { code: OFFLINE_MANUAL_CHECKER, arguments: [] },
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: 'Synthetic manual payment',
                description: 'Local fixture only',
            },
        ],
    });
    await server.app
        .get(ChannelService)
        .assignToChannels(platform, PaymentMethod, paymentMethod.id, [own.channelId]);
    await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(own, paymentMethod.id, true);
    customer = await connection
        .getRepository(platform, Customer)
        .findOneOrFail({ where: {}, relations: ['user'] });
    await connection.getRepository(platform, Customer).update(customer.id, {
        firstName: 'Synthetic',
        lastName: 'Graph scale',
        emailAddress: 'graph-scale@example.invalid',
        phoneNumber: '',
    });
    const ids: Array<string | number> = [];
    for (const kind of ['physical', 'digital'] as const) {
        for (let index = 0; index < 20; index++) {
            const product = await server.app.get(ProductService).create(own, {
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: `Synthetic ${kind} ${index}`,
                        slug: `graph-scale-${kind}-${index}`,
                        description: 'Local only',
                    },
                ],
                customFields: { fulfillmentType: kind },
            });
            const created = await server.app.get(ProductVariantService).create(own, [
                {
                    productId: product.id,
                    sku: `GRAPH-${kind}-${index}`,
                    price: 1000,
                    trackInventory: GlobalFlag.FALSE,
                    translations: [
                        { languageCode: LanguageCode.zh_Hans, name: `Synthetic ${kind} ${index}` },
                    ],
                },
            ]);
            ids.push(...created.map(variant => variant.id));
        }
    }
    variants = await connection.getRepository(own, ProductVariant).findByIds(ids);
    if (variants.length !== 40) throw new Error('Expected forty real-schema product variants');
    const positions = new Map(ids.map((id, index) => [String(id), index]));
    variants.sort((a, b) => required(positions.get(String(a.id))) - required(positions.get(String(b.id))));
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(own.channel.token);
    const introspection = await adminClient.query<IntrospectionQuery>(gql(getIntrospectionQuery()));
    const schemaErrors = validate(buildClientSchema(introspection), GET_SALES_ORDERS);
    expect(schemaErrors.map(error => error.message)).toEqual([]);
    connection.rawConnection.logger = logger;
    connection.rawConnection.subscribers.push(subscriber);
}, TEST_SETUP_TIMEOUT_MS);
afterAll(async () => {
    await server.destroy();
});

async function seedTo(size: number, existing: number) {
    // Direct synthetic fixture inserts avoid running a checkout, fulfillment or email side effect.
    const address = {
        fullName: 'Synthetic recipient',
        streetLine1: 'Local fixture street',
        city: 'Fixture',
        province: 'Fixture',
        postalCode: '00000',
        country: 'United Kingdom',
        countryCode: 'GB',
        phoneNumber: '',
    };
    for (let offset = existing; offset < size; offset += 250) {
        const positions = Array.from({ length: Math.min(250, size - offset) }, (_, index) => offset + index);
        const orders = positions.map(index => ({
            id: 100000 + index,
            salesChannelId: own.channelId,
            code: `GRAPH-SCALE-${index}`,
            state: 'AwaitingManualPayment' as const,
            active: false,
            orderPlacedAt: new Date('2026-01-01T00:00:00Z'),
            customerId: customer.id,
            couponCodes: [],
            shippingAddress: address,
            billingAddress: address,
            currencyCode: CurrencyCode.GBP,
            subTotal: 1000,
            subTotalWithTax: 1000,
            shipping: 0,
            shippingWithTax: 0,
            customFields: {
                customerNote: 'Synthetic scale acceptance',
                deliveryEmail: 'graph-scale@example.invalid',
            },
        }));
        await connection.getRepository(own, Order).insert(orders);
        await connection.getRepository(own, OrderLine).insert(
            positions.map(index => ({
                id: 100000 + index,
                order: { id: 100000 + index },
                productVariantId: variants[index % variants.length].id,
                taxCategoryId: variants[index % variants.length].taxCategoryId,
                quantity: 1,
                orderPlacedQuantity: 1,
                initialListPrice: 1000,
                listPrice: 1000,
                listPriceIncludesTax: true,
                adjustments: [],
                taxLines: [],
                customFields: {
                    fulfillmentTypeSnapshot:
                        index % variants.length < 20 ? ('physical' as const) : ('digital' as const),
                    digitalDeliveryModeSnapshot: 'manual_service' as const,
                },
            })),
        );
        await connection.getRepository(own, Payment).insert(
            positions.map(index => ({
                order: { id: 100000 + index },
                state: 'PendingManual' as const,
                amount: 1000,
                method,
                // TypeORM's recursive insert type cannot represent PaymentMetadata's open JSON
                // fields. This fixed synthetic SQL JSON literal is stored with the real schema.
                metadata: () =>
                    `'${JSON.stringify({ offlineManual: { kind: 'OFFLINE_MANUAL' }, public: { paymentKind: 'OFFLINE_MANUAL' } })}'`,
            })),
        );
    }
}
interface Result {
    activeChannel: { id: string; code: string };
    orders: {
        totalItems: number;
        items: Array<{
            id: string;
            code: string;
            currencyCode: string;
            customer: { id: string; emailAddress: string };
            salesChannel: { id: string };
            lines: Array<{
                id: string;
                quantity: number;
                productVariant: {
                    id: string;
                    sku: string;
                    name: string;
                    product: { id: string; name: string };
                };
            }>;
            payments: Array<{ id: string; state: string; amount: number }>;
            processingSummary: {
                paymentStatus: string;
                needsProcessing: boolean;
                nextAction: { code: string };
                lines: Array<{ orderLineId: string }>;
            };
        }>;
    };
    orderProcessingCounts: {
        pending: number;
        digital: number;
        physical: number;
        exceptions: number;
        afterSales: number;
    };
}

async function measuredRead(size: number, skip: number) {
    sqlQueries = 0;
    hydrationEvents = 0;
    hydratedOrderIds.clear();
    hydratedLineIds.clear();
    measuring = true;
    const started = performance.now();
    let result: Result;
    try {
        result = await adminClient.query<Result>(GET_SALES_ORDERS, {
            options: { category: 'PENDING', skip, take: 20 },
        });
    } finally {
        measuring = false;
    }
    const duration = performance.now() - started;
    expect(result.orders.totalItems).toBe(size);
    expect(result.orders.items).toHaveLength(20);
    expect(result.orderProcessingCounts.pending).toBe(size);
    const physical = Math.floor(size / 40) * 20 + Math.min(20, size % 40);
    expect(result.orderProcessingCounts.physical).toBe(physical);
    expect(result.orderProcessingCounts.digital).toBe(size - physical);
    expect(result.orderProcessingCounts.exceptions).toBe(0);
    for (const order of result.orders.items) {
        expect(order.customer.emailAddress).toBe('graph-scale@example.invalid');
        expect(order.salesChannel.id).toBe(result.activeChannel.id);
        expect(order.lines).toHaveLength(1);
        expect(order.lines[0].productVariant.product.name).toBeTruthy();
        expect(order.lines[0].productVariant.name).toBeTruthy();
        expect(order.payments).toHaveLength(1);
        expect(order.payments[0]).toMatchObject({ state: 'PendingManual', amount: 1000 });
        expect(order.processingSummary).toMatchObject({
            paymentStatus: 'PENDING_MANUAL',
            needsProcessing: true,
            nextAction: { code: 'CONFIRM_OFFLINE_PAYMENT' },
        });
        expect(order.processingSummary.lines).toHaveLength(1);
    }
    expect(hydratedOrderIds.size).toBe(20);
    expect(hydratedLineIds.size).toBe(20);
    expect(sqlErrors).toEqual([]);
    return {
        durationMilliseconds: Number(duration.toFixed(2)),
        sqlQueries,
        hydratedOrders: hydratedOrderIds.size,
        hydratedLines: hydratedLineIds.size,
        orderHydrationEvents: hydrationEvents,
    };
}

describe('real-schema integrated order processing HTTP performance', () => {
    it('keeps complete twenty-order pages below 800ms p95 with 1,000 and 10,000 stored orders', async () => {
        const measurements: object[] = [];
        let existing = 0;
        let smallerMaxQueries = 0;
        for (const size of [1000, 10000]) {
            await seedTo(size, existing);
            existing = size;
            const cold = await measuredRead(size, 0);
            const samples: Array<Awaited<ReturnType<typeof measuredRead>>> = [];
            for (let sample = 0; sample < 20; sample++)
                samples.push(await measuredRead(size, (sample % 5) * 20));
            const sorted = samples.map(sample => sample.durationMilliseconds).sort((a, b) => a - b);
            const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
            const maxQueries = Math.max(...samples.map(sample => sample.sqlQueries));
            measurements.push({
                orders: size,
                pageSize: 20,
                cold,
                p95Milliseconds: p95,
                sqlQueryRange: [Math.min(...samples.map(sample => sample.sqlQueries)), maxQueries],
                samples,
                completeOrdersPerSample: 20,
                actualCurrentAdminDocument: 'GET_SALES_ORDERS',
                database: connection.rawConnection.options.type,
                runtime: {
                    node: process.version,
                    cpuModel: cpus()[0]?.model,
                    logicalCpuCount: cpus().length,
                    memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
                    loadAverages: loadavg(),
                },
            });
            writeFileSync(
                path.join(directory, 'order-api-integrated-mysql.json'),
                JSON.stringify(
                    {
                        at: new Date().toISOString(),
                        scope:
                            'actual owned MySQL, Vendure schema/DI and Admin HTTP GraphQL; synthetic awaiting-manual orders; ' +
                            'full current storefront-admin order document; no external payments or email',
                        measurements,
                    },
                    null,
                    2,
                ),
            );
            expect(p95).toBeLessThanOrEqual(800);
            if (size === 1000) smallerMaxQueries = maxQueries;
            else expect(maxQueries).toBeLessThanOrEqual(smallerMaxQueries + 2);
        }
    }, 120000);
});
