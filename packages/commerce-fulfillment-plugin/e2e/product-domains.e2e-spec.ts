import {
    CatalogManagementPlugin,
    CatalogOperationsService,
    InventoryLot,
} from '@vendure/catalog-management-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Channel,
    ChannelService,
    CurrencyCode,
    CustomerService,
    DefaultLogger,
    FulfillmentLine,
    ID,
    LanguageCode,
    LogLevel,
    Order,
    OrderLine,
    OrderService,
    PaymentMethod,
    PaymentMethodHandler,
    PaymentMethodService,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    Refund,
    RefundLine,
    RequestContext,
    RequestContextService,
    Role,
    ShippingMethod,
    StockLevel,
    StockLocationService,
    StockMovement,
    StockMovementService,
    TransactionalConnection,
    User,
    isGraphQlErrorResult,
    manualFulfillmentHandler,
    mergeConfig,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, testConfig } from '@vendure/testing';
import { gql } from 'graphql-tag';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, Table } from 'typeorm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { singleStageRefundablePaymentMethod } from '../../core/e2e/fixtures/test-payment-methods';
import { AddDigitalProductDomains1791086400000 } from '../../dev-server/migrations/1791086400000-add-digital-product-domains';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import { AutoCardService } from '../src/auto-card.service';
import { CheckoutResourcesService } from '../src/checkout-resources.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { fulfillDigitalOrder } from '../src/commerce-order-process';
import { DigitalDeliveryTokenService } from '../src/digital-delivery-token.service';
import { DigitalDeliveryService } from '../src/digital-delivery.service';
import { DigitalFileService } from '../src/digital-file.service';
import { DigitalProductService } from '../src/digital-product.service';
import { DigitalReceiptShopResolver } from '../src/digital-receipt.resolver';
import { AfterSalesItem } from '../src/entities/after-sales-item.entity';
import { AfterSalesRequest } from '../src/entities/after-sales-request.entity';
import { AutoCardDelivery } from '../src/entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from '../src/entities/auto-card-pool-item.entity';
import {
    CheckoutResourceHold,
    DigitalOrderReservation,
    DigitalVariantConfig,
} from '../src/entities/digital-product.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';
import { PackagingUnpackEvent } from '../src/entities/packaging-unpack-event.entity';
import { ManualDigitalDeliveryService } from '../src/manual-digital-delivery.service';
import { OrderConfirmationTokenService } from '../src/order-confirmation-token.service';
import { PhysicalReturnService } from '../src/physical-return.service';
import { ProductPackagingService } from '../src/product-packaging.service';

import { closureDatabase } from './order-closure-db';
const output = path.resolve(__dirname, '../../../tmp/digital-product-domains-20261004');
mkdirSync(output, { recursive: true });
const mysql = process.env.DB === 'mysql';
const database = closureDatabase(path.join(output, 'database', randomUUID()));
const controlledResult = new PaymentMethodHandler({
    code: 'isolated-controlled-result',
    args: {},
    description: [{ languageCode: LanguageCode.en, value: 'Isolated error simulation' }],
    createPayment: (_ctx, _order, amount, _args, metadata) => {
        if (metadata.outcome === 'declined')
            return { state: 'Declined', amount, errorMessage: 'Isolated explicit decline' };
        throw new Error('Isolated unknown payment result');
    },
    settlePayment: () => ({ success: true }),
});
const config = mergeConfig(testConfig, {
    dbConnectionOptions: database,
    apiOptions: { port: 37409 },
    authOptions: { requireVerification: false },
    logger: new DefaultLogger({ level: LogLevel.Error }),
    paymentOptions: { paymentMethodHandlers: [singleStageRefundablePaymentMethod, controlledResult] },
    plugins: [
        OperationsDashboardPlugin,
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        StoreDomainPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'isolated-no-network',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'isolated-no-network',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
let connection: TransactionalConnection;
let ctx: RequestContext;
let channel: Channel;
let products: DigitalProductService;
let digitalId: string;
let physicalId: string;
let paymentCode: string;
beforeAll(async () => {
    expect(
        Reflect.getMetadata(
            '__permissions__',
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Read resolver decorator metadata without invoking the method.
            DigitalReceiptShopResolver.prototype.myDigitalDeliveryContents,
        ),
    ).toEqual(['Public']);
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            paymentMethods: [],
        },
        customerCount: 0,
    });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const admin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: requireFixture(config.authOptions.superadminCredentials).identifier },
        relations: ['roles', 'roles.channels'],
    });
    const root = await contexts.create({ apiType: 'admin', user: admin });
    const created = await server.app.get(ChannelService).create(root, {
        code: 'independent-domains',
        token: 'independent-domains',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: false,
        defaultTaxZoneId: requireFixture(root.channel.defaultTaxZone).id,
        defaultShippingZoneId: requireFixture(root.channel.defaultShippingZone).id,
        customFields: { commerceMode: 'HYBRID' },
    });
    if (!('id' in created)) throw new Error('Fixture channel failed');
    channel = created;
    await connection.getRepository(root, StoreProfile).save(
        new StoreProfile({
            channelId: channel.id,
            status: 'ACTIVE',
            descriptionZh: '隔离测试店铺',
            descriptionEn: 'Isolated test store',
        }),
    );
    await connection.getRepository(root, StoreDomain).save(
        new StoreDomain({
            channelId: channel.id,
            domain: 'independent-domains.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: channel.id,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    await connection
        .getRepository(root, Role)
        .createQueryBuilder()
        .relation(Role, 'channels')
        .of(admin.roles[0].id)
        .add(channel.id);
    const currentAdmin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { id: admin.id },
        relations: ['roles', 'roles.channels'],
    });
    ctx = await contexts.create({
        apiType: 'admin',
        user: currentAdmin,
        channelOrToken: channel,
        req: { headers: { host: 'isolated.test' } } as any,
    });
    products = server.app.get(DigitalProductService);
    mkdirSync(path.join(output, 'private-files'), { recursive: true });
    const tokens = server.app.get(DigitalDeliveryTokenService);
    Object.defineProperty(tokens, 'rootDirectory', { value: path.join(output, 'private-files') });
    Object.defineProperty(tokens, 'signingSecret', { value: randomUUID() });
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(channel.token);
    shopClient.setChannelToken(channel.token);
    let configured = (await connection.getRepository(root, PaymentMethod).find()).find(
        method => method.handler.code === singleStageRefundablePaymentMethod.code,
    );
    configured ??= await server.app.get(PaymentMethodService).create(root, {
        code: singleStageRefundablePaymentMethod.code,
        enabled: true,
        handler: { code: singleStageRefundablePaymentMethod.code, arguments: [] },
        translations: [
            { languageCode: LanguageCode.zh_Hans, name: '隔离验收支付' },
            { languageCode: LanguageCode.en, name: 'Synthetic domain payment' },
        ],
    });
    paymentCode = configured.code;
    await server.app.get(PaymentMethodService).create(root, {
        code: controlledResult.code,
        enabled: true,
        handler: { code: controlledResult.code, arguments: [] },
        translations: [{ languageCode: LanguageCode.zh_Hans, name: '隔离异常支付' }],
    });
    const warehouse = await server.app
        .get(StockLocationService)
        .create(ctx, { name: 'Isolated physical warehouse' });
    for (const method of await connection.getRepository(root, PaymentMethod).find())
        await server.app.get(ChannelService).assignToChannels(root, PaymentMethod, method.id, [channel.id]);
    for (const method of await connection.getRepository(root, ShippingMethod).find())
        await server.app.get(ChannelService).assignToChannels(root, ShippingMethod, method.id, [channel.id]);
    for (const method of await connection.getRepository(root, PaymentMethod).find())
        await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(ctx, method.id, true);
    for (const type of ['digital', 'physical'] as const) {
        const product = await server.app.get(ProductService).create(ctx, {
            customFields: { fulfillmentType: type },
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: type === 'digital' ? '测试数字商品' : '测试实物商品',
                    slug: `isolated-${type}`,
                    description: '隔离验收样本',
                },
                {
                    languageCode: LanguageCode.en,
                    name: `Isolated ${type}`,
                    slug: `isolated-${type}`,
                    description: 'Fixture',
                },
            ],
        });
        const [variant] = await server.app.get(ProductVariantService).create(ctx, [
            {
                productId: product.id,
                sku: `ISOLATED-${type}`,
                price: 1000,
                ...(type === 'physical'
                    ? { stockLevels: [{ stockLocationId: warehouse.id, stockOnHand: 1 }] }
                    : {}),
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: type === 'digital' ? '测试数字规格' : '测试实物规格',
                    },
                    { languageCode: LanguageCode.en, name: `Isolated ${type}` },
                ],
            },
        ]);
        if (type === 'digital') digitalId = String(variant.id);
        else physicalId = String(variant.id);
    }
}, 120000);
afterAll(async () => {
    await server.destroy();
});
it('creates independent digital configuration and never seeds a warehouse row', async () => {
    const configScoped = await products.config(ctx, digitalId);
    expect(configScoped?.stockPolicy).toBe('unlimited');
    expect(
        await connection.getRepository(ctx, StockLevel).count({ where: { productVariantId: digitalId } }),
    ).toBe(0);
    const product = await connection.getEntityOrThrow(ctx, ProductVariant, digitalId);
    const response = await adminClient.query(
        gql`
            query ($id: ID!) {
                digitalProductWorkspace(productId: $id) {
                    variants {
                        id
                        stockPolicy
                        migrationRequired
                    }
                }
            }
        `,
        { id: String(product.productId) },
    );
    expect(response.digitalProductWorkspace.variants[0]).toMatchObject({
        stockPolicy: 'unlimited',
        migrationRequired: false,
    });
});
it('blocks direct physical writes for digital variants and preserves physical inventory', async () => {
    const locations = await server.app.get(CatalogOperationsService).stockLocations(ctx);
    const location = locations[0]?.id;
    if (!location) throw new Error('Expected fixture warehouse');
    await expect(
        server.app
            .get(StockMovementService)
            .adjustProductVariantStock(ctx, digitalId, [{ stockLocationId: location, stockOnHand: 4 }]),
    ).rejects.toThrow('不使用仓库');
    await expect(
        server.app.get(CatalogOperationsService).updateVariant(ctx, {
            productVariantId: digitalId,
            stockLocationId: location,
            currencyCode: CurrencyCode.GBP,
            packageQuantity: 12,
        }),
    ).rejects.toThrow('仅适用于实物');
    expect(
        await connection.getRepository(ctx, StockLevel).count({ where: { productVariantId: digitalId } }),
    ).toBe(0);
    expect(
        await server.app
            .get(ProductVariantService)
            .getSaleableStockLevel(ctx, await connection.getEntityOrThrow(ctx, ProductVariant, physicalId)),
    ).toBe(1);
});
it('reserves the last quota once, rejects a second order and releases cancellation only once', async () => {
    await connection.withTransaction(ctx, tx =>
        products.update(tx, {
            productVariantId: digitalId,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            availableQuantity: 1,
            expectedAvailableQuantity: 0,
        }),
    );
    const variant = await connection.getEntityOrThrow(ctx, ProductVariant, digitalId);
    const order = await server.app.get(OrderService).create(ctx);
    const line = await connection.getRepository(ctx, OrderLine).save(
        new OrderLine({
            order,
            productVariant: variant,
            quantity: 1,
            listPrice: 1000,
            listPriceIncludesTax: false,
            taxLines: [],
            adjustments: [],
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
        }),
    );
    order.lines = [line];
    await connection.withTransaction(ctx, tx => products.reserveOrder(tx, order));
    await connection.withTransaction(ctx, tx => products.reserveOrder(tx, order));
    expect((await products.config(ctx, digitalId))?.availableQuantity).toBe(0);
    expect(
        await connection
            .getRepository(ctx, DigitalOrderReservation)
            .count({ where: { orderLineId: line.id } }),
    ).toBe(1);
    const second = await server.app.get(OrderService).create(ctx);
    const secondLine = await connection.getRepository(ctx, OrderLine).save(
        new OrderLine({
            order: second,
            productVariant: variant,
            quantity: 1,
            listPrice: 1000,
            listPriceIncludesTax: false,
            taxLines: [],
            adjustments: [],
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'manual_service',
            },
        }),
    );
    second.lines = [secondLine];
    await expect(connection.withTransaction(ctx, tx => products.reserveOrder(tx, second))).rejects.toThrow(
        '可售份数不足',
    );
    await connection.withTransaction(ctx, tx => products.releaseLine(tx, line.id));
    await connection.withTransaction(ctx, tx => products.releaseLine(tx, line.id));
    expect((await products.config(ctx, digitalId))?.availableQuantity).toBe(1);
    expect(
        await connection
            .getRepository(ctx, StockMovement)
            .count({ where: { productVariant: { id: digitalId } } }),
    ).toBe(0);
});
it('rejects stale quota edits and owns private file versions by store', async () => {
    await expect(
        connection.withTransaction(ctx, tx =>
            products.update(tx, {
                productVariantId: digitalId,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
                availableQuantity: 5,
                expectedAvailableQuantity: -1,
            }),
        ),
    ).rejects.toThrow('已变化');
    const file = await server.app.get(DigitalFileService).upload(
        ctx,
        Promise.resolve({
            filename: 'fixture.txt',
            createReadStream: () => Readable.from(['synthetic private file']),
        }),
    );
    await connection.withTransaction(ctx, tx =>
        products.update(tx, {
            productVariantId: digitalId,
            deliveryMode: 'file_download',
            stockPolicy: 'unlimited',
            fileVersionId: file.id,
        }),
    );
    expect(await server.app.get(DigitalFileService).resource('999999', file.id)).toBeUndefined();
    const variant = await connection.getEntityOrThrow(ctx, ProductVariant, digitalId);
    expect((await products.workspace(ctx, variant.productId)).variants[0].fileVersion?.fileName).toBe(
        'fixture.txt',
    );
});
async function syntheticDigital(mode: 'auto_card' | 'manual_service' | 'file_download', quantity?: number) {
    const suffix = randomUUID();
    const product = await server.app.get(ProductService).create(ctx, {
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: '数字验收商品',
                slug: `domain-${suffix}`,
                description: '隔离样本',
            },
        ],
        customFields: { fulfillmentType: 'digital' },
    });
    const [variant] = await server.app.get(ProductVariantService).create(ctx, [
        {
            productId: product.id,
            sku: `DOMAIN-${suffix}`,
            price: 1000,
            translations: [{ languageCode: LanguageCode.zh_Hans, name: '数字验收规格' }],
        },
    ]);
    const file =
        mode === 'file_download'
            ? await server.app.get(DigitalFileService).upload(
                  ctx,
                  Promise.resolve({
                      filename: 'purchased.txt',
                      createReadStream: () => Readable.from(['purchased synthetic version']),
                  }),
              )
            : undefined;
    const saved = await adminClient.query(
        gql`
            mutation ($input: UpdateDigitalVariantConfigInput!) {
                updateDigitalVariantConfig(input: $input) {
                    id
                    deliveryMode
                    stockPolicy
                    availableQuantity
                }
            }
        `,
        {
            input: {
                productVariantId: String(variant.id),
                deliveryMode: mode,
                stockPolicy:
                    mode === 'auto_card' ? 'pool_derived' : quantity === undefined ? 'unlimited' : 'limited',
                ...(quantity !== undefined && mode !== 'auto_card'
                    ? { availableQuantity: quantity, expectedAvailableQuantity: 0 }
                    : {}),
                ...(file ? { fileVersionId: String(file.id) } : {}),
            },
        },
    );
    expect(saved.updateDigitalVariantConfig.deliveryMode).toBe(mode);
    if (mode === 'auto_card') {
        const cards = server.app.get(AutoCardService);
        await connection.withTransaction(ctx, tx =>
            cards.updateConfig(tx, {
                productVariantId: variant.id,
                enabled: true,
                formatName: '验收卡密',
                delimiter: '|',
                fields: [{ key: 'code', label: '卡密', labelEn: 'Code', secret: true }],
                instructionsZh: '请在订单页领取',
                instructionsEn: 'Claim in your order',
                lowStockThreshold: 1,
            }),
        );
        await connection.withTransaction(ctx, tx =>
            cards.importPoolItems(tx, {
                productVariantId: variant.id,
                rawText: quantity === 1 ? 'synthetic-last-card' : 'synthetic-card-one\nsynthetic-card-two',
            }),
        );
    }
    return variant;
}
async function preparedPurchase(variant: ProductVariant, quantity = 1, mixed = false, physicalOnly = false) {
    const orders = server.app.get(OrderService);
    const order = await orders.create(ctx);
    const customer = await server.app.get(CustomerService).create(ctx, {
        emailAddress: `synthetic-${randomUUID()}@example.test`,
        firstName: 'Synthetic',
        lastName: 'Buyer',
    });
    if (isGraphQlErrorResult(customer)) throw new Error(customer.message);
    await orders.addCustomerToOrder(ctx, order, customer);
    const added = await orders.addItemToOrder(ctx, order.id, variant.id, quantity);
    if (isGraphQlErrorResult(added)) throw new Error(added.message);
    await connection
        .getRepository(ctx, Order)
        .update(order.id, { customFields: { deliveryEmail: customer.emailAddress } });
    if (mixed || physicalOnly) {
        if (mixed) {
            const physical = await orders.addItemToOrder(ctx, order.id, physicalId, 1);
            if (isGraphQlErrorResult(physical)) throw new Error(physical.message);
        }
        await orders.setShippingAddress(ctx, order.id, {
            fullName: 'Synthetic Buyer',
            streetLine1: 'Local test road 1',
            city: 'London',
            province: 'London',
            postalCode: 'SW1A 1AA',
            countryCode: 'GB',
            phoneNumber: '0000000000',
        });
        const methods = await orders.getEligibleShippingMethods(ctx, order.id);
        const result = await orders.setShippingMethod(ctx, order.id, [methods[0].id]);
        if (isGraphQlErrorResult(result)) throw new Error(result.message);
    }
    return order;
}
async function paidPurchase(variant: ProductVariant, quantity = 1, mixed = false, physicalOnly = false) {
    const orders = server.app.get(OrderService);
    const order = await preparedPurchase(variant, quantity, mixed, physicalOnly);
    const arranging = await connection.withTransaction(ctx, tx =>
        orders.transitionToState(tx, order.id, 'ArrangingPayment'),
    );
    if (isGraphQlErrorResult(arranging))
        throw new Error((arranging as any).transitionError || arranging.message);
    const paid = await connection.withTransaction(ctx, tx =>
        orders.addPaymentToOrder(tx, order.id, { method: paymentCode, metadata: {} }),
    );
    if (isGraphQlErrorResult(paid))
        throw new Error((paid as any).paymentErrorMessage || (paid as any).transitionError || paid.message);
    const current = await orders.findOne(ctx, order.id, [
        'payments',
        'payments.refunds',
        'payments.refunds.lines',
        'lines',
        'lines.productVariant',
        'fulfillments',
        'fulfillments.lines',
    ]);
    if (!current) throw new Error('Missing synthetic order');
    const proof = server.app.get(OrderConfirmationTokenService).createForDigitalReceipt(ctx, current);
    return {
        order: current,
        proof: proof.token,
        line: requireFixture(
            current.lines.find(line => String(line.productVariantId) === String(variant.id)),
        ),
    };
}
const claim = gql`
    mutation ($orderId: ID!, $orderLineId: ID!, $confirmationToken: String) {
        claimDigitalDelivery(
            orderId: $orderId
            orderLineId: $orderLineId
            confirmationToken: $confirmationToken
        ) {
            state
            readyQuantity
            claimedQuantity
            downloadUrl
            packages {
                number
                fields {
                    label
                    value
                }
                attachments {
                    name
                    downloadUrl
                }
            }
        }
    }
`;
const status = gql`
    query ($orderId: ID!, $confirmationToken: String) {
        myDigitalDeliveryContents(orderId: $orderId, confirmationToken: $confirmationToken) {
            state
            readyQuantity
            eligibleQuantity
            packages {
                number
                fields {
                    value
                }
            }
        }
    }
`;
function receiptArguments(fixture: Awaited<ReturnType<typeof paidPurchase>>) {
    return {
        orderId: String(fixture.order.id),
        orderLineId: String(fixture.line.id),
        confirmationToken: fixture.proof,
    };
}
it('completes manual purchase, explicit publish and claim even when notification fails', async () => {
    const variant = await syntheticDigital('manual_service', 1);
    const fixture = await paidPurchase(variant);
    const task = await connection
        .getRepository(ctx, ManualDigitalDelivery)
        .findOneOrFail({ where: { orderLineId: fixture.line.id } });
    expect(
        (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents[0],
    ).toMatchObject({ state: 'WAITING', packages: [] });
    await connection.withTransaction(ctx, tx =>
        server.app.get(ManualDigitalDeliveryService).publish(tx, {
            id: task.id,
            packages: [{ fields: [{ key: 'account', label: '账号', value: 'synthetic-account' }] }],
        }),
    );
    await connection.getRepository(ctx, ManualDigitalDelivery).update(task.id, { state: 'EMAIL_FAILED' });
    const content = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
    expect(content.packages[0].fields[0].value).toBe('synthetic-account');
    expect(content.claimedQuantity).toBe(1);
    expect(((await server.app.get(ManualDigitalDeliveryService).one(ctx, task.id)) as any).packages).toEqual(
        [],
    );
    const auditBefore = await connection
        .getRepository(ctx, FulfillmentLine)
        .count({ where: { orderLineId: fixture.line.id } });
    await connection.withTransaction(ctx, tx => fulfillDigitalOrder(tx, fixture.order.id));
    expect(
        await connection
            .getRepository(ctx, FulfillmentLine)
            .count({ where: { orderLineId: fixture.line.id } }),
    ).toBe(auditBefore);
    expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(0);
});
it('claims assigned original cards after notification failure and never recycles consumed cards', async () => {
    const variant = await syntheticDigital('auto_card');
    const fixture = await paidPurchase(variant);
    const delivery = await connection
        .getRepository(ctx, AutoCardDelivery)
        .findOneOrFail({ where: { orderLineId: fixture.line.id } });
    await connection.getRepository(ctx, AutoCardDelivery).update(delivery.id, { state: 'MANUAL_REVIEW' });
    const first = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
    const second = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
    expect(first.packages).toEqual(second.packages);
    expect(
        await connection
            .getRepository(ctx, AutoCardPoolItem)
            .count({ where: { deliveryId: delivery.id, state: 'ASSIGNED' } }),
    ).toBe(1);
    await connection.withTransaction(ctx, tx => products.releaseLine(tx, fixture.line.id));
    expect(
        await connection
            .getRepository(ctx, AutoCardPoolItem)
            .count({ where: { deliveryId: delivery.id, state: 'ASSIGNED' } }),
    ).toBe(1);
    expect(
        await connection
            .getRepository(ctx, StockMovement)
            .count({ where: { productVariant: { id: variant.id } } }),
    ).toBe(0);
});
it('binds historical private file versions and pauses only the refunded quantity', async () => {
    const variant = await syntheticDigital('file_download', 2);
    const fixture = await paidPurchase(variant, 2);
    const original = requireFixture(await products.reservation(ctx, fixture.line.id)).fileVersionId;
    const file = await server.app.get(DigitalFileService).upload(
        ctx,
        Promise.resolve({
            filename: 'new-version.txt',
            createReadStream: () => Readable.from(['later synthetic version']),
        }),
    );
    await connection.withTransaction(ctx, tx =>
        products.update(tx, {
            productVariantId: variant.id,
            deliveryMode: 'file_download',
            stockPolicy: 'limited',
            fileVersionId: file.id,
        }),
    );
    const content = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
    const token = decodeURIComponent(content.downloadUrl.split('/').pop());
    const tokens = server.app.get(DigitalDeliveryTokenService);
    const payload = requireFixture(tokens.verifyToken(token));
    expect(payload.fileVersionId).toBe(String(original));
    const refund = await connection.getRepository(ctx, Refund).save(
        new Refund({
            payment: fixture.order.payments[0],
            state: 'Pending',
            items: 1000,
            shipping: 0,
            adjustment: 0,
            total: 1000,
            method: singleStageRefundablePaymentMethod.code,
            reason: 'Synthetic partial refund',
            metadata: {},
        }),
    );
    await connection
        .getRepository(ctx, RefundLine)
        .save(new RefundLine({ refund, orderLine: fixture.line, quantity: 1 }));
    expect(
        (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents[0]
            .eligibleQuantity,
    ).toBe(1);
    await connection.getRepository(ctx, Refund).update(refund.id, { state: 'Failed' });
    expect(
        (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents[0]
            .eligibleQuantity,
    ).toBe(2);
    await connection.getRepository(ctx, Refund).update(refund.id, { state: 'Settled' });
    expect(
        (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents[0]
            .eligibleQuantity,
    ).toBe(1);
    await connection.getRepository(ctx, RefundLine).update({ refundId: refund.id }, { quantity: 2 });
    expect(
        await server.app.get(DigitalDeliveryService).authorizeDownload(token, payload.host),
    ).toBeUndefined();
});
it('combines one payment with separate digital delivery and physical reservation', async () => {
    const variant = await syntheticDigital('file_download');
    const fixture = await paidPurchase(variant, 1, true);
    expect(fixture.order.payments).toHaveLength(1);
    expect(fixture.order.shippingWithTax).toBeGreaterThan(0);
    expect(fixture.order.state).toBe('PartiallyDelivered');
    const physicalLine = requireFixture(
        fixture.order.lines.find(line => String(line.productVariantId) === physicalId),
    );
    expect(await server.app.get(CheckoutResourcesService).outstandingAllocation(ctx, physicalLine.id)).toBe(
        1,
    );
    expect(
        (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents,
    ).toHaveLength(1);
});
it.runIf(mysql)(
    'serializes the last card, digital quota and physical item across simultaneous checkouts',
    async () => {
        for (const mode of ['manual_service', 'auto_card', 'physical'] as const) {
            let variant: ProductVariant;
            if (mode !== 'physical') variant = await syntheticDigital(mode, 1);
            else {
                const warehouse = (await server.app.get(CatalogOperationsService).stockLocations(ctx))[0];
                const product = await server.app.get(ProductService).create(ctx, {
                    customFields: { fulfillmentType: 'physical' },
                    translations: [
                        {
                            languageCode: LanguageCode.zh_Hans,
                            name: '并发实物',
                            slug: `physical-${randomUUID()}`,
                            description: '隔离样本',
                        },
                    ],
                });
                [variant] = await server.app.get(ProductVariantService).create(ctx, [
                    {
                        productId: product.id,
                        sku: `LAST-${randomUUID()}`,
                        price: 1000,
                        stockLevels: [{ stockLocationId: warehouse.id, stockOnHand: 1 }],
                        translations: [{ languageCode: LanguageCode.zh_Hans, name: '最后一件' }],
                    },
                ]);
            }
            const orders = [
                await preparedPurchase(variant, 1, false, mode === 'physical'),
                await preparedPurchase(variant, 1, false, mode === 'physical'),
            ];
            const outcomes = await Promise.allSettled(
                orders.map(order =>
                    connection.withTransaction(ctx, tx =>
                        server.app.get(OrderService).transitionToState(tx, order.id, 'ArrangingPayment'),
                    ),
                ),
            );
            const successes = outcomes.filter(
                outcome => outcome.status === 'fulfilled' && !isGraphQlErrorResult(outcome.value),
            );
            expect(successes, mode).toHaveLength(1);
            if (mode === 'physical')
                expect(
                    (
                        await connection
                            .getRepository(ctx, StockLevel)
                            .findOneOrFail({ where: { productVariantId: variant.id } })
                    ).stockAllocated,
                ).toBe(1);
            else {
                expect(
                    await connection.getRepository(ctx, DigitalOrderReservation).count({
                        where: {
                            configId: requireFixture(await products.config(ctx, variant.id)).id,
                            state: 'HELD',
                        },
                    }),
                ).toBe(1);
                if (mode === 'auto_card')
                    expect(
                        await connection.getRepository(ctx, AutoCardPoolItem).count({
                            where: { config: { productVariantId: variant.id }, state: 'RESERVED' },
                        }),
                    ).toBe(1);
                else expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(0);
            }
        }
    },
    60000,
);
it('rejects missing and tampered receipt proofs before returning any content', async () => {
    const fixture = await paidPurchase(await syntheticDigital('manual_service'));
    await expect(shopClient.query(status, { orderId: String(fixture.order.id) })).rejects.toThrow('无权查看');
    await expect(
        shopClient.query(claim, {
            ...receiptArguments(fixture),
            confirmationToken: fixture.proof + 'tampered',
        }),
    ).rejects.toThrow('无权查看');
});
it('refunds each digital delivery mode through the real refund operation without replenishing consumed resources', async () => {
    for (const mode of ['auto_card', 'manual_service', 'file_download'] as const) {
        const variant = await syntheticDigital(mode, 1);
        const fixture = await paidPurchase(variant);
        if (mode === 'auto_card') {
            const items = await connection
                .getRepository(ctx, AutoCardPoolItem)
                .find({ where: { config: { productVariantId: variant.id } } });
            expect(
                items.map(item => item.state),
                JSON.stringify({
                    orderState: fixture.order.state,
                    hold: (await server.app.get(CheckoutResourcesService).hold(ctx, fixture.order.id))
                        ?.reviewReason,
                }),
            ).toEqual(['ASSIGNED']);
        }
        if (mode === 'manual_service') {
            const task = await connection
                .getRepository(ctx, ManualDigitalDelivery)
                .findOneOrFail({ where: { orderLineId: fixture.line.id } });
            await connection.withTransaction(ctx, tx =>
                server.app
                    .get(ManualDigitalDeliveryService)
                    .publish(tx, { id: task.id, packages: [{ note: 'Synthetic finished content' }] }),
            );
        }
        const refund = await server.app.get(OrderService).refundOrder(ctx, {
            paymentId: fixture.order.payments[0].id,
            lines: [{ orderLineId: fixture.line.id, quantity: 1 }],
            shipping: 0,
            adjustment: 0,
            reason: 'Isolated acceptance refund',
        });
        if (isGraphQlErrorResult(refund)) throw new Error(refund.message);
        expect(refund.state).toBe('Settled');
        expect(
            (await shopClient.query(status, receiptArguments(fixture))).myDigitalDeliveryContents[0].state,
        ).toBe('UNAVAILABLE');
        await expect(shopClient.query(claim, receiptArguments(fixture))).rejects.toThrow('停止交付');
        if (mode !== 'auto_card') expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(0);
        else
            expect(
                await connection
                    .getRepository(ctx, AutoCardPoolItem)
                    .count({ where: { config: { productVariantId: variant.id }, state: 'ASSIGNED' } }),
            ).toBe(1);
        expect(
            await connection
                .getRepository(ctx, StockMovement)
                .count({ where: { productVariant: { id: variant.id } } }),
        ).toBe(0);
    }
});
it('migrates legacy remaining quantities once while preserving the historical warehouse row', async () => {
    const variant = await syntheticDigital('manual_service');
    const original = requireFixture(await products.config(ctx, variant.id));
    await connection
        .getRepository(ctx, DigitalVariantConfig)
        .update(original.id, { migrationState: 'PREPARED' });
    await connection.getRepository(ctx, ProductVariant).update(variant.id, {
        customFields: { digitalDeliveryMode: 'manual_service', digitalStockPolicy: 'limited' },
    });
    const warehouse = (await server.app.get(CatalogOperationsService).stockLocations(ctx))[0];
    const legacy = await connection.getRepository(ctx, StockLevel).save(
        new StockLevel({
            productVariantId: variant.id,
            stockLocationId: warehouse.id,
            stockOnHand: 7,
            stockAllocated: 0,
        }),
    );
    expect((await products.migrationPreview(ctx, variant.id)).conflicts).toEqual([]);
    await connection.withTransaction(ctx, tx => products.migrate(tx, variant.id, 7, 0));
    await connection.withTransaction(ctx, tx => products.migrate(tx, variant.id, 7, 0));
    expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(7);
    expect((await connection.getEntityOrThrow(ctx, StockLevel, legacy.id)).stockOnHand).toBe(7);
    expect(
        await connection
            .getRepository(ctx, DigitalVariantConfig)
            .count({ where: { productVariantId: variant.id, channelId: ctx.channelId } }),
    ).toBe(1);
});
it('repeats the additive database migration without rewriting existing quantities', async () => {
    const migrationDatabase = 'order_closure_migration_' + randomUUID().replace(/-/g, '');
    if (mysql) await connection.rawConnection.query(`CREATE DATABASE IF NOT EXISTS ${migrationDatabase}`);
    const isolated = new DataSource(
        mysql
            ? {
                  type: 'mysql',
                  host: '127.0.0.1',
                  port: 37406,
                  username: 'root',
                  password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
                  database: migrationDatabase,
                  entities: [],
              }
            : { type: 'sqljs', entities: [] },
    );
    await isolated.initialize();
    const runner = isolated.createQueryRunner();
    try {
        await runner.createTable(
            new Table({
                name: 'packaging_unpack_event',
                columns: [
                    { name: 'id', type: mysql ? 'int' : 'integer', isPrimary: true },
                    { name: 'unitsCreated', type: mysql ? 'int' : 'integer' },
                ],
            }),
        );
        await runner.query('INSERT INTO packaging_unpack_event (id, unitsCreated) VALUES (1, 12)');
        const migration = new AddDigitalProductDomains1791086400000();
        await migration.up(runner);
        await runner.query(
            `INSERT INTO digital_variant_config
             (channelId, productVariantId, deliveryMode, stockPolicy, availableQuantity)
             VALUES (2, 100, 'manual_service', 'limited', 7)`,
        );
        await migration.up(runner);
        expect(
            (await runner.query('SELECT availableQuantity FROM digital_variant_config'))[0].availableQuantity,
        ).toBe(7);
        expect(
            (await runner.query('SELECT unitsCreated, lotTransfersJson FROM packaging_unpack_event'))[0],
        ).toMatchObject({ unitsCreated: 12, lotTransfersJson: '[]' });
    } finally {
        await runner.release();
        await isolated.destroy();
    }
});
async function syntheticPhysical(quantity: number, multiple = false) {
    const warehouse = (await server.app.get(CatalogOperationsService).stockLocations(ctx))[0];
    const product = await server.app.get(ProductService).create(ctx, {
        customFields: { fulfillmentType: 'physical' },
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: '实物验收商品',
                slug: `physical-${randomUUID()}`,
                description: '隔离样本',
            },
        ],
    });
    const optionIds: ID[] = [];
    if (multiple) {
        const group = await server.app.get(ProductOptionGroupService).create(ctx, {
            code: `pack-${randomUUID()}`,
            translations: [{ languageCode: LanguageCode.zh_Hans, name: '包装' }],
        });
        await connection.withTransaction(ctx, tx =>
            server.app.get(ProductService).addOptionGroupToProduct(tx, product.id, group.id),
        );
        for (const name of ['散件', '整箱']) {
            const option = await server.app.get(ProductOptionService).create(ctx, group.id, {
                code: `opt-${randomUUID()}`,
                translations: [{ languageCode: LanguageCode.zh_Hans, name }],
            });
            optionIds.push(option.id);
        }
    }
    const variants = await server.app.get(ProductVariantService).create(
        ctx,
        (multiple ? ['散件', '整箱'] : ['默认规格']).map((name, i) => ({
            productId: product.id,
            sku: `PHYSICAL-${randomUUID()}`,
            price: 1000,
            ...(multiple ? { optionIds: [optionIds[i]] } : {}),
            stockLevels: [{ stockLocationId: warehouse.id, stockOnHand: i === 0 && multiple ? 0 : quantity }],
            translations: [{ languageCode: LanguageCode.zh_Hans, name }],
        })),
    );
    return { product, variants, warehouse };
}
it('reconciles existing physical inventory without duplication, excludes expired batches and restores only inspected returns', async () => {
    const {
        variants: [variant],
        warehouse,
    } = await syntheticPhysical(3);
    const operations = server.app.get(CatalogOperationsService);
    const input = {
        productVariantId: variant.id,
        stockLocationId: warehouse.id,
        lotCode: 'ACTIVE',
        quantityOnHand: 2,
        currencyCode: CurrencyCode.GBP,
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    };
    await expect(connection.withTransaction(ctx, tx => operations.saveLot(tx, input))).rejects.toThrow(
        '先分配现有库存',
    );
    await connection.withTransaction(ctx, tx =>
        operations.saveLot(tx, { ...input, reconcileExistingStock: true }),
    );
    await connection.withTransaction(ctx, tx =>
        operations.saveLot(tx, {
            ...input,
            lotCode: 'EXPIRED',
            quantityOnHand: 1,
            expiresAt: new Date(Date.now() - 86400000 * 3).toISOString(),
            reconcileExistingStock: true,
        }),
    );
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variant.id } })
        ).stockOnHand,
    ).toBe(3);
    expect(await server.app.get(ProductVariantService).getSaleableStockLevel(ctx, variant)).toBe(2);
    const fixture = await paidPurchase(variant, 2, false, true);
    const fulfillment = await connection.withTransaction(ctx, tx =>
        server.app.get(OrderService).createFulfillment(tx, {
            lines: [{ orderLineId: fixture.line.id, quantity: 2 }],
            handler: {
                code: manualFulfillmentHandler.code,
                arguments: [
                    { name: 'method', value: '隔离物流' },
                    { name: 'trackingCode', value: 'SYNTHETIC-1' },
                ],
            },
        }),
    );
    if (isGraphQlErrorResult(fulfillment)) throw new Error(fulfillment.message);
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variant.id } })
        ).stockOnHand,
    ).toBe(1);
    const refund = await server.app.get(OrderService).refundOrder(ctx, {
        paymentId: fixture.order.payments[0].id,
        lines: [{ orderLineId: fixture.line.id, quantity: 2 }],
        shipping: 0,
        adjustment: 0,
        reason: '验收退款不自动回库',
    });
    if (isGraphQlErrorResult(refund)) throw new Error(refund.message);
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variant.id } })
        ).stockOnHand,
    ).toBe(1);
    const request = await connection.getRepository(ctx, AfterSalesRequest).save(
        new AfterSalesRequest({
            channelId: ctx.channelId,
            orderId: fixture.order.id,
            customerId: fixture.order.customerId,
            code: `QA${randomUUID().slice(0, 8)}`,
            type: 'RETURN_AND_REFUND',
            state: 'APPROVED',
            reason: 'DAMAGED',
            description: '隔离退货验收',
            currencyCode: CurrencyCode.GBP,
            requestedAmount: 2000,
            customerName: 'Synthetic',
            customerEmail: 'synthetic@example.test',
        }),
    );
    await connection.getRepository(ctx, AfterSalesItem).save(
        new AfterSalesItem({
            requestId: request.id,
            orderLineId: fixture.line.id,
            fulfillmentType: 'physical',
            quantity: 2,
            unitPriceWithTax: 1000,
            lineAmountWithTax: 2000,
            productName: '实物验收商品',
            sku: variant.sku,
        }),
    );
    const returns = server.app.get(PhysicalReturnService);
    const receipt = {
        requestId: request.id,
        orderLineId: fixture.line.id,
        stockLocationId: warehouse.id,
        quantity: 1,
        quality: 'DAMAGED' as const,
        idempotencyKey: randomUUID(),
    };
    await connection.withTransaction(ctx, tx => returns.receive(tx, receipt));
    await connection.withTransaction(ctx, tx => returns.receive(tx, receipt));
    expect(await server.app.get(ProductVariantService).getSaleableStockLevel(ctx, variant)).toBe(0);
    await connection.withTransaction(ctx, tx =>
        returns.receive(tx, { ...receipt, quality: 'GOOD', idempotencyKey: randomUUID() }),
    );
    expect(await server.app.get(ProductVariantService).getSaleableStockLevel(ctx, variant)).toBe(1);
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variant.id } })
        ).stockOnHand,
    ).toBe(3);
    await expect(
        connection.withTransaction(ctx, tx =>
            returns.receive(tx, { ...receipt, idempotencyKey: randomUUID() }),
        ),
    ).rejects.toThrow('超过');
});
it('unpacks only valid package batches and preserves their source and expiry', async () => {
    const {
        product,
        variants: [unit, pack],
        warehouse,
    } = await syntheticPhysical(2, true);
    const operations = server.app.get(CatalogOperationsService);
    const expiration = new Date(Date.now() + 86400000 * 30).toISOString();
    await connection.withTransaction(ctx, tx =>
        operations.saveLot(tx, {
            productVariantId: pack.id,
            stockLocationId: warehouse.id,
            lotCode: 'PACK-A',
            quantityOnHand: 1,
            expiresAt: expiration,
            currencyCode: CurrencyCode.GBP,
            reconcileExistingStock: true,
        }),
    );
    await connection.withTransaction(ctx, tx =>
        operations.saveLot(tx, {
            productVariantId: pack.id,
            stockLocationId: warehouse.id,
            lotCode: 'PACK-EXPIRED',
            quantityOnHand: 1,
            expiresAt: new Date(Date.now() - 86400000 * 3).toISOString(),
            currencyCode: CurrencyCode.GBP,
            reconcileExistingStock: true,
        }),
    );
    await connection.withTransaction(ctx, tx =>
        server.app.get(ProductPackagingService).updateConfig(tx, {
            productId: product.id,
            unitVariantId: unit.id,
            packageVariantId: pack.id,
            unitLabel: '件',
            packageLabel: '箱',
            unitsPerPackage: 12,
            enabled: true,
            autoUnpack: true,
        }),
    );
    const fixture = await paidPurchase(unit, 2, false, true);
    const events = await connection
        .getRepository(ctx, PackagingUnpackEvent)
        .find({ where: { orderId: fixture.order.id } });
    expect(events).toHaveLength(1);
    expect(events[0].unitsCreated).toBe(12);
    const transfer = JSON.parse(events[0].lotTransfersJson);
    expect(transfer).toHaveLength(1);
    const lots = await connection.getRepository(ctx, InventoryLot).find({ where: { variantId: unit.id } });
    expect(lots).toHaveLength(1);
    expect(lots[0].quantityOnHand).toBe(12);
    expect(lots[0].expiresAt?.toISOString()).toBe(
        (
            await connection.getEntityOrThrow(ctx, InventoryLot, transfer[0].sourceLotId)
        ).expiresAt?.toISOString(),
    );
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: pack.id } })
        ).stockOnHand,
    ).toBe(1);
    expect(await server.app.get(ProductVariantService).getSaleableStockLevel(ctx, pack)).toBe(0);
    expect(String(transfer[0].targetLotId)).toBe(String(lots[0].id));
    const source = await connection.getEntityOrThrow(ctx, InventoryLot, transfer[0].sourceLotId);
    expect(source.lotCode).toBe('PACK-A');
    expect(source.quantityOnHand).toBe(0);
    expect(
        (await server.app.get(ProductPackagingService).stockSummary(ctx, product.id))?.packageStockAvailable,
    ).toBe(0);
});
it('copies only basic product data across types and blocks conversion of a product with business resources', async () => {
    const digital = await syntheticDigital('auto_card', 1);
    await expect(
        server.app
            .get(ProductService)
            .update(ctx, { id: digital.productId, customFields: { fulfillmentType: 'physical' } }),
    ).rejects.toThrow();
    const result = await adminClient.query(
        gql`
            mutation ($id: ID!) {
                copyProductBasicsAsType(productId: $id, fulfillmentType: "physical") {
                    id
                    enabled
                    variants {
                        id
                        sku
                        price
                    }
                }
            }
        `,
        { id: String(digital.productId) },
    );
    const copy = result.copyProductBasicsAsType;
    expect(copy.enabled).toBe(false);
    expect(copy.variants).toHaveLength(1);
    expect(copy.variants[0].price).toBe(1000);
    expect(copy.variants[0].sku).not.toBe(digital.sku);
    const levels = await connection
        .getRepository(ctx, StockLevel)
        .find({ where: { productVariantId: copy.variants[0].id } });
    expect(levels.every(level => level.stockOnHand === 0 && level.stockAllocated === 0)).toBe(true);
    expect(
        await connection
            .getRepository(ctx, DigitalVariantConfig)
            .count({ where: { productVariantId: copy.variants[0].id } }),
    ).toBe(0);
});
it('appends only newly purchased units after a paid digital order quantity increases', async () => {
    for (const mode of ['auto_card', 'manual_service', 'file_download'] as const) {
        const variant = await syntheticDigital(mode, 3);
        const fixture = await paidPurchase(variant);
        const manual = server.app.get(ManualDigitalDeliveryService);
        let task: ManualDigitalDelivery | undefined;
        if (mode === 'manual_service') {
            task = await connection
                .getRepository(ctx, ManualDigitalDelivery)
                .findOneOrFail({ where: { orderLineId: fixture.line.id } });
            await connection.withTransaction(ctx, tx =>
                manual.publish(tx, { id: requireFixture(task).id, packages: [{ note: 'original unit' }] }),
            );
        }
        const original = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
        const orders = server.app.get(OrderService);
        const modifying = await orders.transitionToState(ctx, fixture.order.id, 'Modifying');
        if (isGraphQlErrorResult(modifying))
            throw new Error((modifying as any).transitionError || modifying.message);
        const modified = await connection.withTransaction(ctx, tx =>
            orders.modifyOrder(tx, {
                dryRun: false,
                orderId: fixture.order.id,
                adjustOrderLines: [{ orderLineId: fixture.line.id, quantity: 2 }],
            }),
        );
        if (isGraphQlErrorResult(modified)) throw new Error(modified.message);
        const additional = await orders.transitionToState(
            ctx,
            fixture.order.id,
            'ArrangingAdditionalPayment',
        );
        if (isGraphQlErrorResult(additional))
            throw new Error((additional as any).transitionError || additional.message);
        const paid = await connection.withTransaction(ctx, tx =>
            orders.addPaymentToOrder(tx, fixture.order.id, { method: paymentCode, metadata: {} }),
        );
        if (isGraphQlErrorResult(paid)) throw new Error((paid as any).paymentErrorMessage || paid.message);
        expect(['PaymentSettled', 'PartiallyDelivered', 'Delivered']).toContain(paid.state);
        if (task) {
            await connection.getRepository(ctx, ManualDigitalDelivery).update(task.id, { state: 'SENT' });
            await connection.withTransaction(ctx, tx =>
                manual.append(tx, { id: task.id, packages: [{ note: 'new unit' }] }),
            );
        }
        const updated = (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery;
        expect(updated.readyQuantity, mode).toBe(2);
        if (mode !== 'file_download') expect(updated.packages[0]).toEqual(original.packages[0]);
        const before = await connection
            .getRepository(ctx, FulfillmentLine)
            .find({ where: { orderLineId: fixture.line.id } });
        expect(
            before.reduce((sum, line) => sum + line.quantity, 0),
            mode,
        ).toBe(2);
        await connection.withTransaction(ctx, tx => fulfillDigitalOrder(tx, fixture.order.id));
        expect(
            await connection
                .getRepository(ctx, FulfillmentLine)
                .count({ where: { orderLineId: fixture.line.id } }),
        ).toBe(before.length);
    }
});
it('keeps unknown payments occupied, releases explicit declines and cancels unpaid orders once', async () => {
    const checkout = server.app.get(CheckoutResourcesService);
    const orders = server.app.get(OrderService);
    const method = requireFixture(
        (await connection.getRepository(ctx, PaymentMethod).find()).find(
            item => item.handler.code === controlledResult.code,
        ),
    );
    for (const outcome of mysql ? ['unknown', 'declined', 'cancelled'] : ['declined', 'cancelled']) {
        const variant = await syntheticDigital('manual_service', 1);
        const order = await preparedPurchase(variant);
        const arranging = await orders.transitionToState(ctx, order.id, 'ArrangingPayment');
        if (isGraphQlErrorResult(arranging))
            throw new Error((arranging as any).transitionError || arranging.message);
        if (outcome === 'unknown') {
            await expect(
                connection.withTransaction(ctx, tx =>
                    orders.addPaymentToOrder(tx, order.id, { method: method.code, metadata: { outcome } }),
                ),
            ).rejects.toThrow('unknown payment result');
            expect((await checkout.hold(ctx, order.id))?.state).toBe('REVIEW');
            await connection
                .getRepository(ctx, CheckoutResourceHold)
                .update({ orderId: order.id }, { expiresAt: new Date(Date.now() - 1000) });
            await checkout.reconcileExpired();
            expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(0);
            const cancelled = await connection.withTransaction(ctx, tx =>
                orders.cancelOrder(tx, { orderId: order.id }),
            );
            expect(isGraphQlErrorResult(cancelled)).toBeTruthy();
            expect((cancelled as any).transitionError).toContain('尚待核验');
            await expect(
                connection.withTransaction(ctx, tx =>
                    orders.addPaymentToOrder(tx, order.id, { method: method.code, metadata: { outcome } }),
                ),
            ).rejects.toThrow('尚待确认');
        } else {
            if (outcome === 'declined') {
                const declined = await connection.withTransaction(ctx, tx =>
                    orders.addPaymentToOrder(tx, order.id, { method: method.code, metadata: { outcome } }),
                );
                expect(isGraphQlErrorResult(declined)).toBeTruthy();
            } else {
                const cancelled = await connection.withTransaction(ctx, tx =>
                    orders.cancelOrder(tx, { orderId: order.id }),
                );
                if (isGraphQlErrorResult(cancelled)) throw new Error(cancelled.message);
            }
            expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(1);
            expect((await checkout.hold(ctx, order.id))?.state).toBe('RELEASED');
            await connection.withTransaction(ctx, tx => checkout.release(tx, arranging));
            expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(1);
        }
    }
});
it('preserves a late confirmed payment and requires reviewed delivery recovery after an expired reservation', async () => {
    const variant = await syntheticDigital('file_download', 1);
    const order = await preparedPurchase(variant);
    const orders = server.app.get(OrderService);
    const checkout = server.app.get(CheckoutResourcesService);
    const arranging = await orders.transitionToState(ctx, order.id, 'ArrangingPayment');
    if (isGraphQlErrorResult(arranging)) throw new Error(arranging.message);
    await connection
        .getRepository(ctx, CheckoutResourceHold)
        .update({ orderId: order.id }, { expiresAt: new Date(Date.now() - 1000) });
    await checkout.reconcileExpired();
    expect((await checkout.hold(ctx, order.id))?.state).toBe('RELEASED');
    const paid = await connection.withTransaction(ctx, tx =>
        orders.addManualPaymentToOrder(tx, {
            orderId: order.id,
            method: paymentCode,
            transactionId: 'ISOLATED-LATE-PAYMENT',
            metadata: {},
        }),
    );
    if (isGraphQlErrorResult(paid)) throw new Error(paid.message);
    expect(
        (await orders.findOne(ctx, order.id, ['payments']))?.payments.some(
            payment => payment.state === 'Settled',
        ),
    ).toBe(true);
    expect((await checkout.hold(ctx, order.id))?.state).toBe('REVIEW');
    expect(
        await connection
            .getRepository(ctx, FulfillmentLine)
            .count({ where: { orderLineId: arranging.lines[0].id } }),
    ).toBe(0);
    await connection.withTransaction(ctx, tx => checkout.retryDelivery(tx, order.id));
    expect((await checkout.hold(ctx, order.id))?.state).toBe('CONFIRMED');
    expect((await products.config(ctx, variant.id))?.availableQuantity).toBe(0);
    expect(
        await connection
            .getRepository(ctx, FulfillmentLine)
            .count({ where: { orderLineId: arranging.lines[0].id } }),
    ).toBe(1);
});
it('delivers a zero-balance quantity increase without a payment callback and prevents refunded units from reopening', async () => {
    const variant = await syntheticDigital('file_download', 3);
    const fixture = await paidPurchase(variant);
    const orders = server.app.get(OrderService);
    await orders.transitionToState(ctx, fixture.order.id, 'Modifying');
    const modified = await connection.withTransaction(ctx, tx =>
        orders.modifyOrder(tx, {
            dryRun: false,
            orderId: fixture.order.id,
            adjustOrderLines: [{ orderLineId: fixture.line.id, quantity: 2 }],
            surcharges: [
                {
                    description: 'Isolated no-balance increase',
                    price: -fixture.order.totalWithTax,
                    priceIncludesTax: true,
                },
            ],
        }),
    );
    if (isGraphQlErrorResult(modified)) throw new Error(modified.message);
    const finalized = await orders.transitionToState(ctx, fixture.order.id, 'PaymentSettled');
    if (isGraphQlErrorResult(finalized))
        throw new Error((finalized as any).transitionError || finalized.message);
    expect(
        (await shopClient.query(claim, receiptArguments(fixture))).claimDigitalDelivery.readyQuantity,
    ).toBe(2);
    const lines = await connection
        .getRepository(ctx, FulfillmentLine)
        .find({ where: { orderLineId: fixture.line.id } });
    expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(2);
    const refund = await orders.refundOrder(ctx, {
        paymentId: fixture.order.payments[0].id,
        lines: [{ orderLineId: fixture.line.id, quantity: 1 }],
        shipping: 0,
        adjustment: 0,
        reason: 'Isolated partial refund',
    });
    if (isGraphQlErrorResult(refund)) throw new Error(refund.message);
    await orders.transitionToState(ctx, fixture.order.id, 'Modifying');
    await expect(
        connection.withTransaction(ctx, tx =>
            orders.modifyOrder(tx, {
                dryRun: false,
                orderId: fixture.order.id,
                adjustOrderLines: [{ orderLineId: fixture.line.id, quantity: 3 }],
            }),
        ),
    ).rejects.toThrow('已有按份退款');
    expect((await connection.getEntityOrThrow(ctx, OrderLine, fixture.line.id)).quantity).toBe(2);
});
it('rejects native batch updates and digital lot writes without changing the original data', async () => {
    const variant = await syntheticDigital('manual_service');
    await expect(
        adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: String(variant.id), customFields: { packageQuantity: 12 } }] },
        ),
    ).rejects.toThrow('实物字段');
    expect(
        (await connection.getEntityOrThrow(ctx, ProductVariant, variant.id)).customFields.packageQuantity,
    ).toBeNull();
    await expect(
        adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: String(variant.id), customFields: { digitalStockPolicy: 'limited' } }] },
        ),
    ).rejects.toThrow('当前店铺');
    const location = (await server.app.get(CatalogOperationsService).stockLocations(ctx))[0];
    await expect(
        connection.withTransaction(ctx, tx =>
            server.app.get(CatalogOperationsService).saveLot(tx, {
                productVariantId: variant.id,
                stockLocationId: location.id,
                quantityOnHand: 2,
                lotCode: 'DIGITAL-FORBIDDEN',
                currencyCode: CurrencyCode.GBP,
            }),
        ),
    ).rejects.toThrow('实物');
    expect(
        await connection.getRepository(ctx, StockLevel).count({ where: { productVariantId: variant.id } }),
    ).toBe(0);
    expect(
        await connection.getRepository(ctx, InventoryLot).count({ where: { variantId: variant.id } }),
    ).toBe(0);
    const updated = await adminClient.query(
        gql`
            mutation ($input: [UpdateProductVariantInput!]!) {
                updateProductVariants(input: $input) {
                    id
                    sku
                }
            }
        `,
        { input: [{ id: String(variant.id), sku: variant.sku }] },
    );
    expect(updated.updateProductVariants[0].sku).toBe(variant.sku);
});
it('allows resource-free type changes and reads zero cost through the independent workspace', async () => {
    const variant = await syntheticDigital('manual_service');
    const eligibility = await adminClient.query(
        gql`
            query ($id: ID!) {
                productTypeChangeAllowed(productId: $id)
            }
        `,
        { id: String(variant.productId) },
    );
    expect(eligibility.productTypeChangeAllowed).toBe(true);
    await adminClient.query(
        gql`
            mutation ($input: UpdateProductInput!) {
                updateProduct(input: $input) {
                    id
                }
            }
        `,
        { input: { id: String(variant.productId), customFields: { fulfillmentType: 'physical' } } },
    );
    await adminClient.query(
        gql`
            mutation ($input: UpdateProductInput!) {
                updateProduct(input: $input) {
                    id
                }
            }
        `,
        { input: { id: String(variant.productId), customFields: { fulfillmentType: 'digital' } } },
    );
    await adminClient.query(
        gql`
            mutation ($id: ID!) {
                updateProductVariantCost(productVariantId: $id, currencyCode: GBP, costMicrounits: 0)
            }
        `,
        { id: String(variant.id) },
    );
    const workspace = await adminClient.query(
        gql`
            query ($id: ID!) {
                digitalProductWorkspace(productId: $id) {
                    variants {
                        id
                        purchaseCostMicrounits
                        supplier {
                            id
                            name
                        }
                    }
                }
            }
        `,
        { id: String(variant.productId) },
    );
    expect(workspace.digitalProductWorkspace.variants[0]).toMatchObject({
        purchaseCostMicrounits: 0,
        supplier: null,
    });
    expect((await products.config(ctx, variant.id))?.stockPolicy).toBe('unlimited');
});
it('stops a shared warehouse migration without copying its balance into either store', async () => {
    const variant = await syntheticDigital('manual_service');
    await connection.getRepository(ctx, DigitalVariantConfig).delete({ productVariantId: variant.id });
    const created = await server.app.get(ChannelService).create(ctx, {
        code: `second-${randomUUID()}`,
        token: randomUUID(),
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: false,
        defaultTaxZoneId: requireFixture(channel.defaultTaxZone).id,
        defaultShippingZoneId: requireFixture(channel.defaultShippingZone).id,
        customFields: { commerceMode: 'HYBRID' },
    });
    if (!('id' in created)) throw new Error('Second fixture store failed');
    const location = await server.app
        .get(StockLocationService)
        .create(ctx, { name: 'Shared migration fixture' });
    await server.app
        .get(ChannelService)
        .assignToChannels(ctx, (await import('@vendure/core')).StockLocation, location.id, [created.id]);
    await connection.getRepository(ctx, StockLevel).save(
        new StockLevel({
            productVariantId: variant.id,
            stockLocationId: location.id,
            stockOnHand: 7,
            stockAllocated: 0,
        }),
    );
    const result = await products.migrationPreview(ctx, variant.id);
    expect(result.conflicts.join(' ')).toContain('共享归属');
    await expect(
        connection.withTransaction(ctx, tx => products.migrate(tx, variant.id, 7, 0)),
    ).rejects.toThrow('共享归属');
    expect(
        await connection
            .getRepository(ctx, DigitalVariantConfig)
            .count({ where: { productVariantId: variant.id } }),
    ).toBe(0);
    expect(
        (
            await connection
                .getRepository(ctx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variant.id, stockLocationId: location.id } })
        ).stockOnHand,
    ).toBe(7);
});
it.skipIf(!mysql)(
    'serializes paid physical recovery after expired reservations without over-allocation',
    async () => {
        const product = await server.app.get(ProductService).create(ctx, {
            customFields: { fulfillmentType: 'physical' },
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: '实物补交付样本',
                    slug: `recovery-${randomUUID()}`,
                    description: '隔离验收',
                },
            ],
        });
        const location = await server.app
            .get(StockLocationService)
            .create(ctx, { name: 'Physical recovery warehouse' });
        const [variant] = await server.app.get(ProductVariantService).create(ctx, [
            {
                productId: product.id,
                sku: `RECOVERY-${randomUUID()}`,
                price: 1000,
                stockLevels: [{ stockLocationId: location.id, stockOnHand: 2 }],
                translations: [{ languageCode: LanguageCode.zh_Hans, name: '实物补交付规格' }],
            },
        ]);
        const orders = server.app.get(OrderService);
        const checkout = server.app.get(CheckoutResourcesService);
        const prepared = [];
        for (let i = 0; i < 2; i++) {
            const order = await preparedPurchase(variant, 1, false, true);
            const arranged = await connection.withTransaction(ctx, tx =>
                orders.transitionToState(tx, order.id, 'ArrangingPayment'),
            );
            if (isGraphQlErrorResult(arranged))
                throw new Error((arranged as any).transitionError || arranged.message);
            await connection
                .getRepository(ctx, CheckoutResourceHold)
                .update({ orderId: order.id }, { expiresAt: new Date(Date.now() - 1000) });
            await checkout.reconcileExpired();
            const paid = await connection.withTransaction(ctx, tx =>
                orders.addManualPaymentToOrder(tx, {
                    orderId: order.id,
                    method: paymentCode,
                    transactionId: `ISOLATED-RECOVERY-${i}`,
                    metadata: {},
                }),
            );
            if (isGraphQlErrorResult(paid)) throw new Error(paid.message);
            expect((await checkout.hold(ctx, order.id))?.state).toBe('REVIEW');
            prepared.push(order);
        }
        await connection.withTransaction(ctx, tx =>
            server.app
                .get(StockMovementService)
                .adjustProductVariantStock(tx, variant.id, [
                    { stockLocationId: location.id, stockOnHand: 1 },
                ]),
        );
        const results = await Promise.allSettled(
            prepared.map(order =>
                connection.withTransaction(ctx, tx => checkout.retryDelivery(tx, order.id)),
            ),
        );
        expect(
            results.filter(result => result.status === 'fulfilled'),
            results
                .map(result => (result.status === 'rejected' ? String(result.reason) : 'CONFIRMED'))
                .join(' | '),
        ).toHaveLength(1);
        const level = await connection
            .getRepository(ctx, StockLevel)
            .findOneOrFail({ where: { productVariantId: variant.id, stockLocationId: location.id } });
        expect(level.stockAllocated).toBe(1);
        expect(level.stockOnHand).toBe(1);
        expect(
            (await Promise.all(prepared.map(order => checkout.hold(ctx, order.id)))).filter(
                hold => hold?.state === 'CONFIRMED',
            ),
        ).toHaveLength(1);
    },
);

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
