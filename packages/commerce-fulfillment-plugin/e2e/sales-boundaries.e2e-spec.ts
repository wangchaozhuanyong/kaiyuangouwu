import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    DefaultLogger,
    LogLevel,
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
    mergeConfig,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { ORDER_OPERATIONS_QUERY } from '../../next-admin/src/graphql/order-operations.graphql';
import { GET_SALES_ORDER, GET_SALES_ORDERS } from '../../next-admin/src/graphql/sales.graphql';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { StorefrontReviewPlugin } from '../../storefront-review-plugin/src/storefront-review.plugin';
import { StorefrontReviewService } from '../../storefront-review-plugin/src/storefront-review.service';
import { AfterSalesService } from '../src/after-sales.service';
import { AutoCardCipherService } from '../src/auto-card-cipher.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { DigitalDeliveryTokenService } from '../src/digital-delivery-token.service';
import { DigitalDeliveryService } from '../src/digital-delivery.service';
import { AfterSalesEvent } from '../src/entities/after-sales-event.entity';
import { AfterSalesRequest } from '../src/entities/after-sales-request.entity';
import { AutoCardConfig } from '../src/entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from '../src/entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from '../src/entities/auto-card-delivery.entity';
import { ManualDigitalDeliveryEvent } from '../src/entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';
import { ManualDigitalDeliveryService } from '../src/manual-digital-delivery.service';
import { OrderOperationsService } from '../src/order-operations.service';

const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37387 },
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new DefaultLogger({ level: LogLevel.Error }),
    plugins: [
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
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
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
    };
    await expect(connection.withTransaction(foreign, ctx => reviews.submit(ctx, input))).rejects.toThrow();
    const review = await connection.withTransaction(own, ctx => reviews.submit(ctx, input));
    expect(review.channelId).toBe(own.channelId);
    expect(await reviews.findMine(foreign)).toEqual([]);
});

it('keeps after-sales requests in the owning store and rejects a wrongly tagged historical child record', async () => {
    const afterSales = server.app.get(AfterSalesService);
    const input = {
        orderId: order.id,
        type: 'REFUND_ONLY' as const,
        reason: 'NOT_AS_DESCRIBED' as const,
        description: 'Synthetic after-sales request without a real refund.',
        items: [{ orderLineId: line.id, quantity: 1 }],
    };
    await expect(connection.withTransaction(foreign, ctx => afterSales.create(ctx, input))).rejects.toThrow();
    const request = await connection.withTransaction(own, ctx => afterSales.create(ctx, input));
    expect(request.channelId).toBe(own.channelId);
    expect(await afterSales.findForCustomer(foreign)).toEqual([]);
    await connection
        .getRepository(own, AfterSalesRequest)
        .update(request.id, { channelId: foreign.channelId });
    expect(await afterSales.findForCustomer(foreign)).toEqual([]);
    expect((await afterSales.findForAdmin(foreign, { search: order.code })).totalItems).toBe(0);
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
