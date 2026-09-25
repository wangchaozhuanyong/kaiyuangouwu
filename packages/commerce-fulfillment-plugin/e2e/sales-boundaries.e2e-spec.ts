import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    DefaultLogger,
    Fulfillment,
    FulfillmentService,
    LogLevel,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    Payment,
    ProductService,
    ProductVariantService,
    Refund,
    RequestContext,
    RequestContextService,
    Role,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { AddCouponAppearanceTheme1790208000000 } from '../../dev-server/migrations/1790208000000-add-coupon-appearance-theme';
import { AddReviewAnonymous1790208060000 } from '../../dev-server/migrations/1790208060000-add-review-anonymous';
import { AddNotificationReadState1790208120000 } from '../../dev-server/migrations/1790208120000-add-notification-read-state';
import { AddAfterSalesEvidence1790258400000 } from '../../dev-server/migrations/1790258400000-add-after-sales-evidence';
import { ORDER_OPERATIONS_QUERY } from '../../next-admin/src/graphql/order-operations.graphql';
import {
    GET_AFTER_SALES_REQUESTS,
    GET_SALES_ORDER,
    GET_SALES_ORDERS,
} from '../../next-admin/src/graphql/sales.graphql';
import { AdministratorAccessService } from '../../store-management-plugin/src/administrator-access.service';
import { AdministratorAccessProfile } from '../../store-management-plugin/src/entities/administrator-access-profile.entity';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { StorefrontReviewPlugin } from '../../storefront-review-plugin/src/storefront-review.plugin';
import { StorefrontReviewService } from '../../storefront-review-plugin/src/storefront-review.service';
import { AfterSalesEvidenceService, EVIDENCE_RETENTION_MS } from '../src/after-sales-evidence.service';
import { AfterSalesService } from '../src/after-sales.service';
import { AutoCardCipherService } from '../src/auto-card-cipher.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { DigitalDeliveryTokenService } from '../src/digital-delivery-token.service';
import { DigitalDeliveryService } from '../src/digital-delivery.service';
import { AfterSalesEvent } from '../src/entities/after-sales-event.entity';
import { AfterSalesEvidence } from '../src/entities/after-sales-evidence.entity';
import { AfterSalesRequest } from '../src/entities/after-sales-request.entity';
import { AutoCardConfig } from '../src/entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from '../src/entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from '../src/entities/auto-card-delivery.entity';
import { ManualDigitalDeliveryEvent } from '../src/entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';
import { FulfillmentDeliveryService } from '../src/fulfillment-delivery.service';
import { ManualDigitalDeliveryService } from '../src/manual-digital-delivery.service';
import { OrderOperationsService } from '../src/order-operations.service';

const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37387 },
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    plugins: [
        CatalogManagementPlugin,
        StorefrontCartPlugin,
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
            evidenceStorage: {
                rootDirectory: path.resolve(
                    __dirname,
                    '../../storefront/artifacts/readiness/after-sales-evidence-files',
                ),
                signingSecret: randomUUID(),
            },
        }),
        StorefrontReviewPlugin,
    ],
});
const { server, adminClient } = createTestEnvironment(config);
let connection: TransactionalConnection;
let own: RequestContext;
let foreign: RequestContext;
let platform: RequestContext;
let order: Order;
let line: OrderLine;
let downloads: DigitalDeliveryService;
let evidenceId: string;
let fixtureDirectory: string | undefined;

function required<T>(value: T | null | undefined, label: string): T {
    if (value == null) throw new Error(`Expected ${label}`);
    return value;
}

beforeAll(async () => {
    await server.init({
        initialData: { ...initialData, defaultLanguage: LanguageCode.zh_Hans },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const credentials = required(config.authOptions.superadminCredentials, 'superadmin credentials');
    const admin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: credentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    platform = await contexts.create({ apiType: 'admin', user: admin });
    const customer = await connection
        .getRepository(platform, Customer)
        .findOneOrFail({ where: {}, relations: ['user', 'user.roles', 'user.roles.channels'] });
    const channel = await server.app.get(ChannelService).create(platform, {
        code: 'consumer-foreign',
        token: 'consumer-foreign',
        defaultLanguageCode: LanguageCode.zh_Hans,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: true,
    });
    expect('id' in channel).toBe(true);
    own = await contexts.create({
        apiType: 'shop',
        user: customer.user,
        req: { headers: { host: 'synthetic-shop.test' } } as any,
    });
    foreign = await contexts.create({
        apiType: 'shop',
        user: customer.user,
        channelOrToken: 'consumer-foreign',
    });
    await server.app
        .get(ChannelService)
        .assignToChannels(platform, Customer, customer.id, [foreign.channelId]);
    // Direct ChannelService creation does not provision administrator role assignments.
    await connection
        .getRepository(platform, Role)
        .createQueryBuilder()
        .relation(Role, 'channels')
        .of(admin.roles[0].id)
        .add(foreign.channelId);
    const product = await server.app.get(ProductService).create(platform, {
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: '本地隔离测试商品',
                slug: 'synthetic-scope-product',
                description: '仅本地测试',
            },
        ],
    });
    const [variant] = await server.app.get(ProductVariantService).create(platform, [
        {
            productId: product.id,
            sku: 'SYNTHETIC-SCOPE',
            price: 1000,
            stockOnHand: 10,
            translations: [{ languageCode: LanguageCode.zh_Hans, name: '本地测试规格' }],
        },
    ]);
    const orders = server.app.get(OrderService);
    order = await orders.create(own, required(customer.user, 'customer user').id);
    const added = await orders.addItemToOrder(own, order.id, variant.id, 1);
    expect('errorCode' in added).toBe(false);
    line = await connection
        .getRepository(own, OrderLine)
        .findOneOrFail({ where: { order: { id: order.id } }, relations: ['productVariant'] });
    await connection.getRepository(own, OrderLine).update(line.id, {
        customFields: {
            fulfillmentTypeSnapshot: 'digital',
            digitalDeliveryModeSnapshot: 'file_download',
        },
    });
    await connection
        .getRepository(own, Order)
        .update(order.id, { active: false, state: 'PaymentSettled', orderPlacedAt: new Date() });
    await server.app.get(ChannelService).assignToChannels(platform, Order, order.id, [foreign.channelId]);
    await connection.getRepository(own, Payment).save(
        new Payment({
            order,
            state: 'Settled',
            amount: 100000,
            method: 'synthetic-no-charge',
            metadata: {},
        }),
    );
    const fixtures = path.resolve(
        __dirname,
        '../../../reports/platform-store-refactor/phase2/download-fixtures',
    );
    mkdirSync(fixtures, { recursive: true });
    fixtureDirectory = mkdtempSync(path.join(fixtures, 'scope-'));
    mkdirSync(path.join(fixtureDirectory, String(own.channelId)));
    writeFileSync(
        path.join(fixtureDirectory, String(own.channelId), `${line.productVariant.sku}.txt`),
        'synthetic download',
    );
    downloads = new DigitalDeliveryService(
        connection,
        new DigitalDeliveryTokenService({
            rootDirectory: fixtureDirectory,
            signingSecret: randomUUID(),
            linkTtlSeconds: 60,
        }),
    );
}, 120000);

afterAll(async () => {
    await server.destroy();
    if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
});

it('ships a physical order, requires delivery evidence and lets only its customer confirm once', async () => {
    const orders = server.app.get(OrderService);
    const delivery = server.app.get(FulfillmentDeliveryService);
    const fulfillmentService = server.app.get(FulfillmentService);
    const physicalOrder = await orders.create(own, required(own.activeUserId, 'customer user ID'));
    const added = await orders.addItemToOrder(own, physicalOrder.id, line.productVariant.id, 1);
    expect('errorCode' in added).toBe(false);
    const physicalLine = await connection.getRepository(own, OrderLine).findOneOrFail({
        where: { order: { id: physicalOrder.id } },
    });
    await connection.getRepository(own, OrderLine).update(physicalLine.id, {
        customFields: { fulfillmentTypeSnapshot: 'physical' },
    });
    await connection.getRepository(own, Order).update(physicalOrder.id, {
        active: false,
        state: 'PaymentSettled',
        orderPlacedAt: new Date(),
    });
    const fulfillment = await orders.createFulfillment(platform, {
        lines: [{ orderLineId: physicalLine.id, quantity: 1 }],
        handler: {
            code: 'manual-fulfillment',
            arguments: [
                { name: 'method', value: 'Synthetic carrier' },
                { name: 'trackingCode', value: 'SYNTHETIC-TRACK-1' },
            ],
        },
    });
    expect('errorCode' in fulfillment).toBe(false);
    if ('errorCode' in fulfillment) throw new Error(fulfillment.message);
    const shipped = await fulfillmentService.transitionToState(platform, fulfillment.id, 'Shipped');
    expect('fulfillment' in shipped).toBe(true);
    const record = await delivery.findForFulfillment(own, fulfillment.id);
    expect(record).toMatchObject({
        status: 'IN_TRANSIT',
        carrier: 'Synthetic carrier',
        trackingCode: 'SYNTHETIC-TRACK-1',
    });
    const directDelivery = await fulfillmentService.transitionToState(platform, fulfillment.id, 'Delivered');
    expect('transitionError' in directDelivery).toBe(true);
    const client = new SimpleGraphQLClient(config, 'http://127.0.0.1:37387/shop-api');
    const customer = await connection.getRepository(own, Customer).findOneOrFail({
        where: { id: physicalOrder.customerId },
    });
    await client.asUserWithCredentials(customer.emailAddress, 'test');
    const confirmation = gql`
        mutation ConfirmReceipt($input: ConfirmFulfillmentDeliveryInput!) {
            confirmMyFulfillmentDelivery(input: $input) {
                status
                proofReference
                events {
                    id
                }
            }
        }
    `;
    const fulfillmentId = config.entityOptions.entityIdStrategy.encodeId(fulfillment.id);
    const input = { fulfillmentId, idempotencyKey: `customer-delivered-${fulfillmentId}` };
    const anonymous = new SimpleGraphQLClient(config, 'http://127.0.0.1:37387/shop-api');
    await expect(anonymous.query(confirmation, { input })).rejects.toThrow();
    client.setChannelToken(foreign.channel.token);
    await expect(client.query(confirmation, { input })).rejects.toThrow();
    client.setChannelToken(own.channel.token);
    const confirmed = (await client.query(confirmation, { input })).confirmMyFulfillmentDelivery;
    expect(confirmed).toMatchObject({ status: 'DELIVERED', proofReference: 'CUSTOMER_CONFIRMED' });
    const retry = (await client.query(confirmation, { input })).confirmMyFulfillmentDelivery;
    expect(retry.events.map((event: { id: string }) => event.id)).toEqual(
        confirmed.events.map((event: { id: string }) => event.id),
    );
    const orderResult = await client.query(
        gql`
            query ConfirmedOrder($id: ID!) {
                order(id: $id) {
                    fulfillments {
                        state
                        deliveryEvidence {
                            status
                            proofReference
                        }
                    }
                }
            }
        `,
        { id: config.entityOptions.entityIdStrategy.encodeId(physicalOrder.id) },
    );
    expect(orderResult.order.fulfillments).toContainEqual({
        state: 'Delivered',
        deliveryEvidence: { status: 'DELIVERED', proofReference: 'CUSTOMER_CONFIRMED' },
    });
    const finalRecord = await delivery.findForFulfillment(own, fulfillment.id);
    expect(finalRecord?.events.filter(event => event.idempotencyKey === input.idempotencyKey)).toHaveLength(
        1,
    );
    expect(
        (await connection.getRepository(own, Fulfillment).findOne({ where: { id: fulfillment.id } }))?.state,
    ).toBe('Delivered');
});

it('applies the four additive launch migrations idempotently against the running test schema', async () => {
    const runner = connection.rawConnection.createQueryRunner();
    const migrations = [
        new AddCouponAppearanceTheme1790208000000(),
        new AddReviewAnonymous1790208060000(),
        new AddNotificationReadState1790208120000(),
        new AddAfterSalesEvidence1790258400000(),
    ];
    try {
        // The disposable server starts synchronized to the current entities.
        // Remove only these empty/new structures, then exercise the upgrade path.
        for (const migration of [...migrations].reverse()) await migration.down(runner);
        for (const migration of migrations) {
            await migration.up(runner);
            await migration.up(runner);
        }
        expect((await runner.getTable('after_sales_evidence'))?.foreignKeys).toHaveLength(4);
        expect(
            (await runner.getTable('store_coupon_campaign_config'))?.findColumnByName('appearanceTheme'),
        ).toBeDefined();
        expect((await runner.getTable('storefront_review'))?.findColumnByName('anonymous')).toBeDefined();
        const notificationTable = await runner.getTable('store_notification_read');
        expect(notificationTable?.indices.some(index => index.isUnique)).toBe(true);
    } finally {
        await runner.release();
    }
});

it('initializes one administrator profile under concurrent first access', async () => {
    const profiles = connection.getRepository(platform, AdministratorAccessProfile);
    const platformUserId = required(platform.activeUserId, 'platform user ID');
    expect(await profiles.count({ where: { userId: platformUserId } })).toBe(0);
    const access = server.app.get(AdministratorAccessService);
    const find = access.findByUserId.bind(access);
    let release!: () => void;
    let missingReads = 0;
    const allReadMissing = new Promise<void>(resolve => {
        release = resolve;
    });
    const concurrentRead = vi
        .spyOn(access, 'findByUserId')
        .mockImplementation(async (ctx, userId, afterInsert) => {
            const result = await find(ctx, userId, afterInsert);
            if (!afterInsert && !result) {
                if (++missingReads === 8) release();
                await allReadMissing;
            }
            return result;
        });
    let results: AdministratorAccessProfile[];
    try {
        results = await Promise.all(
            Array.from({ length: 8 }, () =>
                connection.rawConnection.options.type === 'sqljs'
                    ? access.current(platform)
                    : connection.withTransaction(platform, ctx => access.current(ctx)),
            ),
        );
    } finally {
        concurrentRead.mockRestore();
    }
    expect(new Set(results.map(profile => String(profile.id))).size).toBe(1);
    expect(results.every(profile => profile.authority === 'OWNER' && profile.status === 'ACTIVE')).toBe(true);
    expect(await profiles.count({ where: { userId: platformUserId } })).toBe(1);
});

it('rejects signed download issuance in an associated foreign store and revokes unresolved-owner links', async () => {
    const [delivery] = await downloads.deliveriesForOrder(own, String(order.id));
    expect(delivery.status).toBe('READY');
    const downloadUrl = required(delivery.downloadUrl, 'digital delivery download URL');
    const token = required(downloadUrl.split('/').at(-1), 'digital delivery token');
    expect(await downloads.authorizeDownload(token, 'synthetic-shop.test')).toBeDefined();
    await expect(downloads.deliveriesForOrder(foreign, String(order.id))).rejects.toThrow();
    await connection.getRepository(own, Order).update(order.id, { salesChannelId: null });
    try {
        expect(await downloads.authorizeDownload(token, 'synthetic-shop.test')).toBeUndefined();
        await expect(downloads.deliveriesForOrder(own, String(order.id))).rejects.toThrow();
    } finally {
        await connection.getRepository(own, Order).update(order.id, { salesChannelId: own.channelId });
    }
});

it('uses SQL sale ownership for review candidates and refuses same-member foreign submissions', async () => {
    const reviews = server.app.get(StorefrontReviewService);
    expect((await reviews.findCandidates(own)).map(item => item.orderLineId)).toContain(line.id);
    expect(await reviews.findCandidates(foreign)).toEqual([]);
    const input = {
        orderLineId: line.id,
        rating: 5,
        title: 'Synthetic review',
        body: 'This is a local synthetic review for store isolation.',
        anonymous: true,
    };
    await expect(connection.withTransaction(foreign, ctx => reviews.submit(ctx, input))).rejects.toThrow();
    const review = await connection.withTransaction(own, ctx => reviews.submit(ctx, input));
    expect(review.channelId).toBe(own.channelId);
    expect(await reviews.findMine(foreign)).toEqual([]);
    const beforeApproval = await reviews.findApprovedForProduct(own, review.productId);
    expect(beforeApproval.items).toEqual([]);
    await connection.withTransaction(platform, ctx =>
        reviews.moderate(ctx, { id: review.id, state: 'APPROVED', response: 'Local review approved' }),
    );
    const publicClient = new SimpleGraphQLClient(config, 'http://127.0.0.1:37387/shop-api');
    const publicQuery = gql`
        query ($productId: ID!) {
            storefrontProductReviews(productId: $productId) {
                items {
                    anonymous
                    customerName
                    merchantResponse
                }
            }
        }
    `;
    const variables = { productId: String(review.productId) };
    const publicResult = await publicClient.query(publicQuery, variables);
    expect(publicResult.storefrontProductReviews.items).toEqual([
        { anonymous: true, customerName: '匿名用户', merchantResponse: 'Local review approved' },
    ]);
    const englishClient = new SimpleGraphQLClient(config, 'http://127.0.0.1:37387/shop-api?languageCode=en');
    const englishResult = await englishClient.query(publicQuery, variables);
    expect(englishResult.storefrontProductReviews.items).toEqual([
        { anonymous: true, customerName: 'Anonymous customer', merchantResponse: null },
    ]);
    const otherStoreReviews = await reviews.findApprovedForProduct(foreign, review.productId);
    expect(otherStoreReviews.items).toEqual([]);
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(own.channel.token);
    const adminResult = await adminClient.query(gql`
        query {
            storefrontReviews {
                items {
                    anonymous
                    customerName
                    customerId
                }
            }
        }
    `);
    const customer = await connection
        .getRepository(own, Customer)
        .findOneOrFail({ where: { id: order.customerId } });
    // Preserve the existing masked display label and exact owner ID for staff;
    // ReadCatalog does not confer permission to disclose full customer profiles.
    expect(adminResult.storefrontReviews.items[0].customerName).not.toBe('匿名用户');
    expect(adminResult.storefrontReviews.items[0].customerId).toBe(
        config.entityOptions.entityIdStrategy.encodeId(customer.id),
    );
});

it('persists notification read state across two real sessions without reading another store or a future event', async () => {
    const url = 'http://127.0.0.1:37387/shop-api';
    const first = new SimpleGraphQLClient(config, url);
    const second = new SimpleGraphQLClient(config, url);
    const customer = await connection
        .getRepository(own, Customer)
        .findOneOrFail({ where: { id: order.customerId } });
    await first.asUserWithCredentials(customer.emailAddress, 'test');
    await second.asUserWithCredentials(customer.emailAddress, 'test');
    const current = await connection.getRepository(own, Order).findOneByOrFail({ id: order.id });
    const reference = { kind: 'ORDER', sourceId: String(order.id), version: current.updatedAt.toISOString() };
    const variables = { references: [reference] };
    const read = gql`
        query ($references: [StoreNotificationReferenceInput!]!) {
            myStoreNotificationReadKeys(references: $references)
        }
    `;
    const mark = gql`
        mutation ($references: [StoreNotificationReferenceInput!]!) {
            markMyStoreNotificationsRead(references: $references)
        }
    `;
    expect((await second.query(read, variables)).myStoreNotificationReadKeys).toEqual([]);
    const marked = (await first.query(mark, variables)).markMyStoreNotificationsRead;
    expect(marked).toHaveLength(1);
    expect((await first.query(mark, variables)).markMyStoreNotificationsRead).toEqual(marked);
    expect((await second.query(read, variables)).myStoreNotificationReadKeys).toEqual(marked);
    second.setChannelToken(foreign.channel.token);
    await expect(second.query(read, variables)).rejects.toThrow('not currently authorized');
    await expect(second.query(mark, variables)).rejects.toThrow('not currently authorized');
    expect(
        (
            await first.query(mark, {
                references: [{ ...reference, version: new Date(Date.now() + 86_400_000).toISOString() }],
            })
        ).markMyStoreNotificationsRead,
    ).toEqual([]);
});

it('accepts authenticated multipart evidence over HTTP and serves only the signed private image', async () => {
    const customer = await connection
        .getRepository(own, Customer)
        .findOneOrFail({ where: { id: order.customerId } });
    const base = 'http://127.0.0.1:37387';
    const login = await fetch(`${base}/shop-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'mutation($username: String!, $password: String!) { login(username: $username, password: $password) { __typename } }',
            variables: { username: customer.emailAddress, password: 'test' },
        }),
    });
    expect((await login.json()).data.login.__typename).toBe('CurrentUser');
    const token = required(login.headers.get('vendure-auth-token'), 'local test session');
    const query =
        'mutation($orderId: ID!, $file: Upload!) { uploadAfterSalesEvidence(orderId: $orderId, file: $file) { id previewUrl available } }';
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#abcdef' } })
        .png()
        .toBuffer();
    const form = () => {
        const body = new FormData();
        body.set(
            'operations',
            JSON.stringify({ query, variables: { orderId: String(order.id), file: null } }),
        );
        body.set('map', JSON.stringify({ 0: ['variables.file'] }));
        body.set('0', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'synthetic.png');
        return body;
    };
    const anonymous = await fetch(`${base}/shop-api`, {
        method: 'POST',
        headers: { 'Apollo-Require-Preflight': 'true' },
        body: form(),
    });
    expect((await anonymous.json()).errors?.length).toBeGreaterThan(0);
    const result = await fetch(`${base}/shop-api`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Apollo-Require-Preflight': 'true' },
        body: form(),
    });
    const payload = await result.json();
    expect(payload.errors).toBeUndefined();
    const image = payload.data.uploadAfterSalesEvidence;
    expect(image.available).toBe(true);
    const preview = new URL(image.previewUrl, base);
    expect(preview.origin).toBe(base);
    const download = await fetch(preview);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toContain('no-store');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await fetch(`${preview}x`)).status).toBe(404);
    const removed = await fetch(`${base}/shop-api`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: 'mutation($id: ID!) { removeMyAfterSalesEvidenceDraft(id: $id) }',
            variables: { id: image.id },
        }),
    });
    expect((await removed.json()).data.removeMyAfterSalesEvidenceDraft).toBe(true);
    expect((await fetch(preview)).status).toBe(404);
});

it('uploads private evidence only for the owner and binds short links to the shop host', async () => {
    const evidence = server.app.get(AfterSalesEvidenceService);
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffeecc' } })
        .png()
        .toBuffer();
    const file = () =>
        Promise.resolve({
            filename: 'receipt.png',
            mimetype: 'image/png',
            createReadStream: () => Readable.from(bytes),
        });
    await expect(evidence.upload(foreign, order.id, file())).rejects.toThrow('无权访问');
    const uploaded = await evidence.upload(own, order.id, file());
    evidenceId = String(uploaded.id);
    const token = required(
        required(uploaded.previewUrl, 'evidence preview').split('/').at(-1),
        'evidence token',
    );
    const authorized = await evidence.authorize(token, 'synthetic-shop.test');
    expect(authorized).toBeDefined();
    expect((await evidence.read(required(authorized, 'authorized evidence'))).length).toBeGreaterThan(0);
    expect(await evidence.authorize(token, 'foreign-shop.test')).toBeUndefined();
    expect(await evidence.authorize(`${token}x`, 'synthetic-shop.test')).toBeUndefined();
    expect((await evidence.drafts(own, order.id)).map(item => String(item.id))).toContain(evidenceId);
});

it('keeps after-sales requests in the owning store and rejects a wrongly tagged historical child record', async () => {
    const afterSales = server.app.get(AfterSalesService);
    const input = {
        orderId: order.id,
        type: 'REFUND_ONLY' as const,
        reason: 'NOT_AS_DESCRIBED' as const,
        description: 'Synthetic after-sales request without a real refund.',
        items: [{ orderLineId: line.id, quantity: 1 }],
        evidenceIds: [evidenceId],
    };
    await expect(connection.withTransaction(foreign, ctx => afterSales.create(ctx, input))).rejects.toThrow();
    const request = await connection.withTransaction(own, ctx => afterSales.create(ctx, input));
    expect(request.channelId).toBe(own.channelId);
    const evidence = server.app.get(AfterSalesEvidenceService);
    expect((await evidence.forRequest(own, request.id)).map(item => String(item.id))).toEqual([evidenceId]);
    expect(await evidence.drafts(own, order.id)).toEqual([]);
    await expect(evidence.removeDraft(own, evidenceId)).rejects.toThrow('已提交');
    await expect(evidence.forRequest(foreign, request.id)).rejects.toThrow('无权访问');
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(own.channel.token);
    const adminRows = await adminClient.query(GET_AFTER_SALES_REQUESTS, { options: { search: order.code } });
    const adminRequest = adminRows.afterSalesRequests.items.find((item: any) => item.code === request.code);
    expect(adminRows.afterSalesRequests.totalItems).toBe(1);
    expect(adminRequest).toBeDefined();
    expect(adminRequest.evidence).toHaveLength(1);
    expect(adminRequest.evidence[0].available).toBe(true);
    expect(adminRequest.evidence[0].previewUrl).toContain('/after-sales/evidence/');
    const unauthorizedAdmin = await server.app
        .get(RequestContextService)
        .create({ apiType: 'admin', channelOrToken: own.channel });
    await expect(evidence.forRequest(unauthorizedAdmin, request.id)).rejects.toThrow('无权查看');
    expect(await afterSales.findForCustomer(foreign)).toEqual([]);
    await connection
        .getRepository(own, AfterSalesRequest)
        .update(request.id, { channelId: foreign.channelId });
    expect(await afterSales.findForCustomer(foreign)).toEqual([]);
    expect((await afterSales.findForAdmin(foreign, { search: order.code })).totalItems).toBe(0);
});

it('retains open-case evidence, expires it 180 days after closure and retries failed storage deletion', async () => {
    const evidence = server.app.get(AfterSalesEvidenceService);
    const repository = connection.getRepository(own, AfterSalesEvidence);
    const row = await repository.findOneOrFail({ where: { id: evidenceId } });
    const requests = connection.getRepository(own, AfterSalesRequest);
    const now = Date.now();
    await repository.update(row.id, { createdAt: new Date(now - EVIDENCE_RETENTION_MS * 2) });
    expect(await evidence.purgeExpired()).toBe(0);
    await requests.update(required(row.requestId, 'after-sales request ID'), {
        state: 'COMPLETED',
        completedAt: new Date(now - EVIDENCE_RETENTION_MS + 86_400_000),
    });
    expect(await evidence.purgeExpired()).toBe(0);
    await requests.update(required(row.requestId, 'after-sales request ID'), {
        completedAt: new Date(now - EVIDENCE_RETENTION_MS - 86_400_000),
    });
    const storage = (evidence as any).storage;
    const remove = vi
        .spyOn(storage, 'remove')
        .mockRejectedValueOnce(new Error('temporary local storage failure'));
    expect(await evidence.purgeExpired()).toBe(0);
    expect((await repository.findOneByOrFail({ id: row.id })).deletedAt).toBeInstanceOf(Date);
    expect((await repository.findOneByOrFail({ id: row.id })).storageDeletedAt).toBeNull();
    expect(await evidence.purgeExpired()).toBe(1);
    expect((await repository.findOneByOrFail({ id: row.id })).storageDeletedAt).toBeInstanceOf(Date);
    expect(await evidence.purgeExpired()).toBe(0);
    remove.mockRestore();
});

it('enforces the six-image draft quota concurrently and removes only expired unsubmitted drafts', async () => {
    const evidence = server.app.get(AfterSalesEvidenceService);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ccbbff' } })
        .png()
        .toBuffer();
    const upload = () =>
        evidence.upload(
            own,
            order.id,
            Promise.resolve({
                filename: 'quota.png',
                mimetype: 'image/png',
                createReadStream: () => Readable.from(bytes),
            }),
        );
    // Keep decoder admission below its own resource limit, then race for the final slot.
    for (let index = 0; index < 5; index++) await upload();
    const results = await Promise.allSettled([upload(), upload()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find(result => result.status === 'rejected');
    expect(rejection?.status === 'rejected' && rejection.reason.message).toContain('6 张');
    const drafts = await evidence.drafts(own, order.id);
    expect(drafts).toHaveLength(6);
    const repo = connection.getRepository(own, AfterSalesEvidence);
    await repo.update(drafts[0].id, { createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const oldToken = required(
        required(drafts[0].previewUrl, 'draft preview').split('/').at(-1),
        'draft token',
    );
    expect(await evidence.authorize(oldToken, 'synthetic-shop.test')).toBeUndefined();
    const replacement = await upload();
    expect(await evidence.purgeExpired()).toBe(1);
    expect(await evidence.drafts(own, order.id)).toHaveLength(6);
    for (const draft of [...drafts.slice(1), replacement]) await evidence.removeDraft(own, draft.id);
    expect(await evidence.drafts(own, order.id)).toEqual([]);
});

it('counts physical fulfillment once in the owning store and platform, never via management membership', async () => {
    await connection
        .getRepository(own, OrderLine)
        .update(line.id, { customFields: { fulfillmentTypeSnapshot: 'physical' } });
    const operations = server.app.get(OrderOperationsService);
    expect(await operations.countPhysicalFulfillmentTodos(own)).toBe(1);
    expect(await operations.countPhysicalFulfillmentTodos(foreign)).toBe(0);
    expect(await operations.countPhysicalFulfillmentTodos(platform)).toBe(1);
});

it('returns the persisted owner and active channel to the actual Admin order documents', async () => {
    await adminClient.asSuperAdmin();
    const list = await adminClient.query(GET_SALES_ORDERS, { options: { take: 10 } });
    const apiOrder = list.orders.items.find((item: any) => item.code === order.code);
    expect(apiOrder.salesChannel.id).toBe(list.activeChannel.id);
    const detail = await adminClient.query(GET_SALES_ORDER, { id: apiOrder.id });
    expect(detail.order.salesChannel.id).toBe(list.activeChannel.id);
    const operations = await adminClient.query(ORDER_OPERATIONS_QUERY, { id: apiOrder.id });
    expect(operations.order.salesChannel.id).toBe(list.activeChannel.id);
    adminClient.setChannelToken(foreign.channel.token);
    const foreignDetail = await adminClient.query(GET_SALES_ORDER, { id: apiOrder.id });
    expect(foreignDetail.order).toBeNull();
});

it('retains newly appended delivery and after-sales events when an older parent snapshot is saved', async () => {
    const base = {
        channelId: own.channelId,
        orderId: order.id,
        orderLineId: line.id,
        recipientEmail: 'synthetic@example.test',
        languageCode: 'zh_Hans',
        productName: 'Synthetic',
        sku: line.productVariant.sku,
        quantity: 1,
    };
    const manualRepo = connection.getRepository(own, ManualDigitalDelivery);
    const manual = await manualRepo.save(
        new ManualDigitalDelivery({
            ...base,
            state: 'DRAFT',
            expectedAt: new Date(),
            attachmentAssetIdsJson: '[]',
        }),
    );
    const autoConfig = await connection.getRepository(own, AutoCardConfig).save(
        new AutoCardConfig({
            channelId: own.channelId,
            productVariantId: line.productVariant.id,
            formatName: 'Synthetic',
            fieldsJson: '[]',
            instructions: '',
        }),
    );
    const autoRepo = connection.getRepository(own, AutoCardDelivery);
    const automatic = await autoRepo.save(
        new AutoCardDelivery({
            ...base,
            configId: autoConfig.id,
            state: 'WAITING_STOCK',
            schemaSnapshot: '[]',
            instructionsSnapshot: '',
        }),
    );
    const request = await connection
        .getRepository(own, AfterSalesRequest)
        .findOneOrFail({ where: { orderId: order.id } });
    for (const [parentEntity, parentId, eventEntity, parentKey, eventFields] of [
        [
            ManualDigitalDelivery,
            manual.id,
            ManualDigitalDeliveryEvent,
            'deliveryId',
            { type: 'DRAFT_SAVED', actorType: 'SYSTEM', note: 'Synthetic append' },
        ],
        [
            AutoCardDelivery,
            automatic.id,
            AutoCardDeliveryEvent,
            'deliveryId',
            { type: 'WAITING_STOCK', actorType: 'SYSTEM', note: 'Synthetic append' },
        ],
        [
            AfterSalesRequest,
            request.id,
            AfterSalesEvent,
            'requestId',
            { state: 'PENDING', actorType: 'SYSTEM', actorLabel: 'Synthetic', note: 'Synthetic append' },
        ],
    ] as const) {
        const parents = connection.getRepository(own, parentEntity);
        const events = connection.getRepository(own, eventEntity);
        const stale = await parents.findOneOrFail({ where: { id: parentId }, relations: { events: true } });
        const appended = await events.save(events.create({ ...eventFields, [parentKey]: parentId }));
        await parents.save(stale);
        const persisted = await events.findOneOrFail({ where: { id: appended.id } });
        expect(String(persisted[parentKey])).toBe(String(parentId));
        const reloaded = await parents.findOneOrFail({
            where: { id: parentId },
            relations: { events: true },
        });
        expect(reloaded.events.map((event: any) => String(event.id))).toContain(String(appended.id));
    }
});

it('rechecks persisted full refunds before publishing, retrying and preparing queued manual delivery', async () => {
    const deliveries = connection.getRepository(own, ManualDigitalDelivery);
    const delivery = await deliveries.findOneOrFail({ where: { orderLineId: line.id } });
    const payment = await connection
        .getRepository(own, Payment)
        .findOneOrFail({ where: { order: { id: order.id } } });
    const refund = await connection.getRepository(own, Refund).save(
        new Refund({
            payment,
            state: 'Pending',
            total: payment.amount,
            items: payment.amount,
            shipping: 0,
            adjustment: 0,
            method: 'synthetic-no-refund',
            reason: 'Local entitlement verification',
            metadata: {},
        }),
    );
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new ManualDigitalDeliveryService(
        connection,
        server.app.get(AutoCardCipherService),
        eventBus as any,
        server.app.get(OrderService),
        server.app.get(RequestContextService),
    );
    const input = { id: delivery.id, packages: [{ note: 'Synthetic package' }] };
    await expect(service.publish(own, input)).rejects.toThrow('全额退款');
    await deliveries.update(delivery.id, { state: 'EMAIL_FAILED' });
    await expect(service.retry(own, delivery.id)).rejects.toThrow('全额退款');
    await deliveries.update(delivery.id, { state: 'SENDING' });
    await expect(service.queuedEmailPayload(own, delivery.id)).rejects.toThrow('全额退款');
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect((await deliveries.findOneOrFail({ where: { id: delivery.id } })).encryptedPackages).toBeNull();
    // A failed refund releases the payment entitlement, including partially delivered mixed orders.
    await connection.getRepository(own, Refund).update(refund.id, { state: 'Failed' });
    await connection.getRepository(own, Order).update(order.id, { state: 'PartiallyDelivered' });
    await deliveries.update(delivery.id, { state: 'DRAFT' });
    await expect(service.publish(own, input)).resolves.toMatchObject({ state: 'SENDING' });
    expect(eventBus.publish).toHaveBeenCalled();
});
