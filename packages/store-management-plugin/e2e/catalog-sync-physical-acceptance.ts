import { InventoryLot } from '@vendure/catalog-management-plugin';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    CatalogSyncRule,
    Channel,
    Collection,
    Country,
    CountryService,
    CurrencyCode,
    CustomerService,
    LanguageCode,
    Order,
    OrderLine,
    OrderService,
    Permission,
    ProductOptionGroupService,
    ProductOptionService,
    ProductSalesAuthorization,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    ShippingMethodService,
    StockLevel,
    StockLocation,
    StockLocationService,
    StockMovementService,
    TransactionalConnection,
    ZoneService,
} from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { CatalogSupplierService } from '../../catalog-management-plugin/src/catalog-supplier.service';
import { PurchaseOrderService } from '../../catalog-management-plugin/src/purchase-order.service';
import { AfterSalesService } from '../../commerce-fulfillment-plugin/src/after-sales.service';
import { CatalogSyncShippingService } from '../../commerce-fulfillment-plugin/src/catalog-sync-shipping.service';
import { CheckoutResourcesService } from '../../commerce-fulfillment-plugin/src/checkout-resources.service';
import { AfterSalesItem } from '../../commerce-fulfillment-plugin/src/entities/after-sales-item.entity';
import { AfterSalesRequest } from '../../commerce-fulfillment-plugin/src/entities/after-sales-request.entity';
import { ProductPackagingService } from '../../commerce-fulfillment-plugin/src/product-packaging.service';
import { CatalogSyncSourceService } from '../src/catalog-sync-source.service';

import { addSyntheticCollectionMembers, requireSyntheticFixture } from './catalog-sync-fixture-links';

interface State {
    server: { app: { get<T>(token: new (...args: any[]) => T): T } };
    connection: TransactionalConnection;
    a: RequestContext;
    b: RequestContext;
    rule: CatalogSyncRule;
    child: Collection;
    products: Array<{ id: string; variantId: string }>;
    drain: () => Promise<void>;
}
const translations = (name: string) =>
    [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
        languageCode,
        name,
        slug: name.toLowerCase().replace(/ /g, '-'),
        description: 'Synthetic physical supply fixture',
    }));

export function registerCatalogSyncPhysicalAcceptance(state: () => State) {
    describe('physical source and grouped delivery', () => {
        let sourceVariant: ProductVariant;
        let localVariant: ProductVariant;
        let sequence = 0;
        const createOrder = async (
            ctx: RequestContext,
            variants: Array<{ variant: ProductVariant; amount: number }>,
        ) => {
            const f = state();
            const amount = variants.reduce((sum, item) => sum + item.amount, 0);
            const order = await f.connection.rawConnection.getRepository(Order).save(
                new Order({
                    code: `SYNC-PHYSICAL-${++sequence}`,
                    state: 'AddingItems',
                    active: true,
                    salesChannelId: ctx.channelId,
                    channels: [ctx.channel],
                    currencyCode: ctx.currencyCode,
                    couponCodes: [],
                    subTotal: amount,
                    subTotalWithTax: amount,
                    shippingAddress: { countryCode: 'MY', postalCode: '50000' },
                    billingAddress: {},
                }),
            );
            order.lines = [];
            for (const item of variants)
                order.lines.push(
                    await f.connection.rawConnection.getRepository(OrderLine).save(
                        new OrderLine({
                            order,
                            productVariant: item.variant,
                            quantity: 1,
                            listPrice: item.amount,
                            listPriceIncludesTax: false,
                            adjustments: [],
                            taxLines: [],
                            customFields: { fulfillmentTypeSnapshot: 'physical' },
                        }),
                    ),
                );
            return order;
        };

        it('uses only source stock and quotes each source group without sharing free-shipping thresholds', async () => {
            const f = state();
            const country =
                (await f.connection.rawConnection.getRepository(Country).findOneBy({ code: 'MY' })) ??
                (await f.server.app.get(CountryService).create(f.a, {
                    code: 'MY',
                    enabled: true,
                    translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                        languageCode,
                        name: 'Synthetic Malaysia',
                    })),
                }));
            const zone = await f.server.app
                .get(ZoneService)
                .create(f.a, { name: 'Synthetic shared delivery zone', memberIds: [country.id] });
            for (const ctx of [f.a, f.b]) {
                await f.connection.rawConnection
                    .getRepository(Channel)
                    .update(ctx.channelId, { defaultShippingZone: zone });
                ctx.channel.defaultShippingZone = zone;
            }
            for (const ctx of [f.a, f.b])
                await f.server.app
                    .get(StockLocationService)
                    .create(ctx, { name: `Synthetic warehouse ${ctx.channelId}` });
            const shipping = f.server.app.get(ShippingMethodService);
            for (const ctx of [f.a, f.b])
                await f.connection.withTransaction(ctx, tx =>
                    shipping.create(tx, {
                        code: `sync-physical-${ctx.channelId}`,
                        fulfillmentHandler: 'manual-fulfillment',
                        translations: translations(`Physical shipping ${ctx.channelId}`),
                        checker: {
                            code: 'supported-destination-eligibility-checker',
                            arguments: [
                                { name: 'allowedCountryCodes', value: 'MY' },
                                { name: 'blockedPostalPrefixes', value: '' },
                            ],
                        },
                        calculator: {
                            code: 'physical-subtotal-shipping-calculator',
                            arguments: [
                                { name: 'baseRate', value: ctx.channelId === f.a.channelId ? '1000' : '300' },
                                { name: 'freeAbove', value: ctx.channelId === f.a.channelId ? '2000' : '0' },
                                { name: 'currencyCode', value: ctx.channel.defaultCurrencyCode },
                                { name: 'sourceCurrencyCode', value: ctx.channel.defaultCurrencyCode },
                                { name: 'taxRate', value: '0' },
                                { name: 'priceIncludesTax', value: 'false' },
                                { name: 'estimateMinDays', value: '1' },
                                { name: 'estimateMaxDays', value: '3' },
                            ],
                        },
                    }),
                );
            const make = async (ctx: RequestContext, name: string, amount: number, stock: number) => {
                const product = await f.server.app.get(ProductService).create(ctx, {
                    translations: translations(name),
                    customFields: { fulfillmentType: 'physical' },
                });
                return (
                    await f.server.app.get(ProductVariantService).create(ctx, [
                        {
                            productId: product.id,
                            sku: name.replace(/ /g, '-'),
                            price: amount,
                            stockOnHand: stock,
                            trackInventory: GlobalFlag.TRUE,
                            customFields: {
                                fulfillmentType: 'physical',
                                saleUnit: 'unit',
                                packageQuantity: 1,
                            },
                            translations: translations(name).map(t => ({
                                languageCode: t.languageCode,
                                name: t.name,
                            })),
                        },
                    ])
                )[0];
            };
            sourceVariant = await make(f.a, 'Sync source physical', 1000, 1);
            localVariant = await make(f.b, 'Sync local physical', 10000, 4);
            f.products.push({ id: String(sourceVariant.productId), variantId: String(sourceVariant.id) });
            await f.connection.rawConnection.getRepository(Collection).update(f.child.id, {
                filters: [
                    {
                        code: 'variant-id-filter',
                        args: [
                            { name: 'variantIds', value: JSON.stringify(f.products.map(p => p.variantId)) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
            });
            await addSyntheticCollectionMembers(f.connection, f.child.id, [sourceVariant.id]);
            await f.drain();
            expect(
                await f.connection.rawConnection.getRepository(StockLevel).count({
                    where: {
                        productVariantId: sourceVariant.id,
                        stockLocation: { channels: { id: f.b.channelId } },
                    },
                }),
            ).toBe(0);
            const order = await createOrder(f.b, [
                { variant: sourceVariant, amount: 600 },
                { variant: localVariant, amount: 10000 },
            ]);
            const orders = f.server.app.get(OrderService);
            const fixtureMethodNames = new Set([
                `Physical shipping ${f.a.channelId}`,
                `Physical shipping ${f.b.channelId}`,
            ]);
            const candidates = (await shipping.getActiveShippingMethods(f.b)).filter(method =>
                fixtureMethodNames.has(method.name),
            );
            expect(candidates).toHaveLength(2);
            const scopes = await Promise.all(
                candidates.map(method =>
                    f.server.app.get(CatalogSyncShippingService).scope(f.b, order, method),
                ),
            );
            expect(
                scopes.filter(Boolean).length,
                JSON.stringify(
                    scopes.map(scope =>
                        scope ? { id: scope.groupId, lines: scope.order.lines.length } : null,
                    ),
                ),
            ).toBe(2);
            const loaded = await orders.findOne(f.b, order.id, [
                'lines',
                'lines.productVariant',
                'shippingLines',
            ]);
            expect(loaded?.shippingAddress.countryCode).toBe('MY');
            expect(loaded?.lines.length).toBe(2);
            const checks = await Promise.all(
                candidates.map(method => method.test(f.b, requireSyntheticFixture(loaded))),
            );
            expect(checks.filter(Boolean)).toHaveLength(2);
            const methods = (await orders.getEligibleShippingMethods(f.b, order.id)).filter(method =>
                candidates.some(candidate => String(candidate.id) === String(method.id)),
            );
            expect(methods).toHaveLength(2);
            expect(methods.map(method => method.priceWithTax).sort((a, b) => a - b)).toEqual([300, 600]);
            expect(new Set(methods.map(method => method.metadata?.shippingGroupId)).size).toBe(2);
            const selected = await f.connection.withTransaction(f.b, tx =>
                orders.setShippingMethod(
                    tx,
                    order.id,
                    methods.map(method => method.id),
                ),
            );
            expect('errorCode' in selected).toBe(false);
            if ('errorCode' in selected) throw new Error('Grouped delivery selection failed');
            expect(selected.shippingWithTax).toBe(900);
            expect(new Set(selected.lines.map(line => String(line.shippingLineId))).size).toBe(2);
            const resources = f.server.app.get(CheckoutResourcesService);
            await f.connection.withTransaction(f.b, tx => resources.reserve(tx, selected, selected.lines));
            const sourceStock = await f.connection.rawConnection.getRepository(StockLevel).findOneOrFail({
                where: {
                    productVariantId: sourceVariant.id,
                    stockLocation: { channels: { id: f.a.channelId } },
                },
            });
            expect(sourceStock.stockAllocated).toBe(1);
            await f.connection.withTransaction(f.b, tx => resources.release(tx, selected));
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(StockLevel)
                        .findOneByOrFail({ id: sourceStock.id })
                ).stockAllocated,
            ).toBe(0);
        }, 120_000);

        it('prevents two stores from reserving the final source unit (parallel on MySQL)', async () => {
            const f = state();
            const resources = f.server.app.get(CheckoutResourcesService);
            const orderA = await createOrder(f.a, [{ variant: sourceVariant, amount: 1000 }]);
            const orderB = await createOrder(f.b, [{ variant: sourceVariant, amount: 600 }]);
            const work = [
                () => f.connection.withTransaction(f.a, tx => resources.reserve(tx, orderA, orderA.lines)),
                () => f.connection.withTransaction(f.b, tx => resources.reserve(tx, orderB, orderB.lines)),
            ];
            const result = ['mysql', 'mariadb'].includes(f.connection.rawConnection.options.type)
                ? await Promise.allSettled(work.map(run => run()))
                : await (async () => {
                      const values: Array<PromiseSettledResult<void>> = [];
                      for (const run of work) {
                          try {
                              await run();
                              values.push({ status: 'fulfilled', value: undefined });
                          } catch (reason) {
                              values.push({ status: 'rejected', reason });
                          }
                      }
                      return values;
                  })();
            expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
            expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
            const winner =
                result[0].status === 'fulfilled' ? { ctx: f.a, order: orderA } : { ctx: f.b, order: orderB };
            await f.connection.withTransaction(winner.ctx, tx => resources.release(tx, winner.order));
            const stock = await f.connection.rawConnection.getRepository(StockLevel).findOneOrFail({
                where: {
                    productVariantId: sourceVariant.id,
                    stockLocation: { channels: { id: f.a.channelId } },
                },
            });
            expect(stock.stockOnHand).toBe(1);
            expect(stock.stockAllocated).toBe(0);
        }, 120_000);

        it('restocks only the original source warehouse through the selling-store return workflow', async () => {
            const f = state();
            const resources = f.server.app.get(CheckoutResourcesService);
            const order = await createOrder(f.b, [{ variant: sourceVariant, amount: 600 }]);
            await f.connection.withTransaction(f.b, tx => resources.reserve(tx, order, order.lines));
            await f.connection.withTransaction(f.b, tx =>
                f.server.app
                    .get(StockMovementService)
                    .createSalesForOrder(tx, [{ orderLineId: order.lines[0].id, quantity: 1 }]),
            );
            const customer = await f.server.app.get(CustomerService).create(f.b, {
                firstName: 'Synthetic',
                lastName: 'Return',
                emailAddress: 'sync-return@example.invalid',
            });
            if (!('id' in customer)) throw new Error('Synthetic customer could not be created');
            await f.connection.rawConnection
                .getRepository(Order)
                .update(order.id, { state: 'Delivered', active: false, customerId: customer.id });
            const request = await f.connection.rawConnection.getRepository(AfterSalesRequest).save(
                new AfterSalesRequest({
                    code: 'SYNTHETIC-SUPPLY-RETURN',
                    channelId: f.b.channelId,
                    customerId: customer.id,
                    orderId: order.id,
                    type: 'RETURN_AND_REFUND',
                    state: 'APPROVED',
                    returnStatus: 'RECEIVED',
                    reason: 'OTHER',
                    description: 'Local source return acceptance',
                    currencyCode: f.b.currencyCode,
                    requestedAmount: 600,
                    customerName: 'Synthetic Return',
                    customerEmail: 'sync-return@example.invalid',
                }),
            );
            const item = await f.connection.rawConnection.getRepository(AfterSalesItem).save(
                new AfterSalesItem({
                    requestId: request.id,
                    orderLineId: order.lines[0].id,
                    quantity: 1,
                    unitPriceWithTax: 600,
                    lineAmountWithTax: 600,
                    productName: 'Synthetic source physical',
                    sku: sourceVariant.sku,
                    fulfillmentType: 'physical',
                }),
            );
            const service = f.server.app.get(AfterSalesService);
            const locations = await service.returnLocationsForAdmin(f.b, request.id);
            expect(locations).toHaveLength(1);
            expect(locations[0].locations).toHaveLength(1);
            const sourceStock = await f.connection.rawConnection.getRepository(StockLevel).findOneOrFail({
                where: {
                    productVariantId: sourceVariant.id,
                    stockLocation: { channels: { id: f.a.channelId } },
                },
            });
            expect(sourceStock.stockOnHand).toBe(0);
            expect(String(locations[0].locations[0].id)).toBe(String(sourceStock.stockLocationId));
            await expect(service.returnLocationsForAdmin(f.a, request.id)).rejects.toThrow('当前店铺');
            const input = {
                id: request.id,
                note: 'Synthetic original-source return',
                idempotencyKey: 'synthetic-source-return',
                items: [
                    {
                        itemId: item.id,
                        acceptedQuantity: 1,
                        rejectedQuantity: 0,
                        stockLocationId: sourceStock.stockLocationId,
                        lotCode: 'SYNTHETIC-RETURN',
                    },
                ],
            };
            await f.connection.withTransaction(f.b, tx => service.inspectReturnForAdmin(tx, input));
            await f.connection.withTransaction(f.b, tx => service.inspectReturnForAdmin(tx, input));
            expect(
                (
                    await f.connection.rawConnection
                        .getRepository(StockLevel)
                        .findOneByOrFail({ id: sourceStock.id })
                ).stockOnHand,
            ).toBe(1);
            expect(
                await f.connection.rawConnection.getRepository(StockLevel).count({
                    where: {
                        productVariantId: sourceVariant.id,
                        stockLocation: { channels: { id: f.b.channelId } },
                    },
                }),
            ).toBe(0);
        }, 120_000);
        it('blocks new source purchases when every shipping currency path is invalid and recovers after repair', async () => {
            const f = state();
            const shipping = f.server.app.get(ShippingMethodService);
            const method = requireSyntheticFixture(
                (await shipping.getActiveShippingMethods(f.a)).find(
                    item => item.code === `sync-physical-${f.a.channelId}`,
                ),
            );
            const enabled = await shipping.getActiveShippingMethods(f.a);
            const manager = new RequestContext({
                apiType: 'admin',
                channel: f.a.channel,
                currencyCode: f.a.currencyCode,
                languageCode: f.a.languageCode,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
                session: {
                    user: {
                        id: f.a.activeUserId,
                        channelPermissions: [
                            {
                                id: f.a.channelId,
                                permissions: [Permission.SuperAdmin, Permission.UpdateShippingMethod],
                            },
                        ],
                    },
                } as any,
            });
            // A template's source currency is immutable. Create a real USD template rather
            // than trying to overwrite the existing CNY template through the public service.
            const invalid = await f.connection.withTransaction(f.a, tx =>
                shipping.create(
                    tx,
                    {
                        code: `sync-unconvertible-${f.a.channelId}`,
                        fulfillmentHandler: method.fulfillmentHandlerCode,
                        translations: translations('Synthetic unconvertible shipping'),
                        checker: { code: method.checker.code, arguments: method.checker.args },
                        calculator: { code: method.calculator.code, arguments: method.calculator.args },
                    },
                    CurrencyCode.USD,
                ),
            );
            const toggle = (id: typeof method.id, value: boolean) =>
                f.connection.withTransaction(manager, tx =>
                    shipping.setMyShippingTemplateEnabled(tx, id, value),
                );
            try {
                for (const item of enabled) await toggle(item.id, false);
                expect(await shipping.getShippingMethodSourceCurrency(f.a, invalid)).toBe('USD');
                await f.drain();
                const grant = await f.connection.rawConnection
                    .getRepository(ProductSalesAuthorization)
                    .findOneByOrFail({
                        productId: sourceVariant.productId,
                        channelId: f.b.channelId,
                    });
                expect(grant.state).toBe('PENDING');
                expect(grant.pendingVariantIds).toContain(String(sourceVariant.id));
                await expect(
                    f.server.app.get(CatalogSyncSourceService).resolve(f.b, sourceVariant.id),
                ).rejects.toThrow('配置');
            } finally {
                await toggle(invalid.id, false);
                for (const item of enabled) await toggle(item.id, true);
                await f.drain();
            }
            expect(
                (await f.server.app.get(CatalogSyncSourceService).resolve(f.b, sourceVariant.id))?.ctx
                    .channelId,
            ).toBe(f.a.channelId);
        }, 120_000);

        it.runIf(process.env.CATALOG_SYNC_CLOSEOUT === '1')(
            'receives a source purchase batch, unpacks for the target checkout and sells only the source lot',
            async () => {
                const f = state();
                const product = await f.server.app.get(ProductService).create(f.a, {
                    translations: translations('Synthetic source case pack'),
                    customFields: { fulfillmentType: 'physical' },
                });
                const group = await f.server.app.get(ProductOptionGroupService).create(f.a, {
                    code: 'synthetic-case-pack',
                    translations: translations('Case size'),
                });
                const options = [];
                for (const code of ['unit', 'case'])
                    options.push(
                        await f.server.app.get(ProductOptionService).create(f.a, group.id, {
                            productOptionGroupId: group.id,
                            code,
                            translations: translations(code),
                        }),
                    );
                await f.connection.withTransaction(f.a, tx =>
                    f.server.app.get(ProductService).addOptionGroupToProduct(tx, product.id, group.id),
                );
                const [unit, box] = await f.server.app.get(ProductVariantService).create(
                    f.a,
                    options.map((option, index) => ({
                        productId: product.id,
                        sku: `SYNC-PACK-${index}`,
                        optionIds: [option.id],
                        price: index ? 4000 : 1000,
                        trackInventory: GlobalFlag.TRUE,
                        translations: translations(index ? 'Case' : 'Unit'),
                        customFields: { fulfillmentType: 'physical', packageQuantity: index ? 4 : 1 },
                    })),
                );
                const packaging = f.server.app.get(ProductPackagingService);
                const packagingInput = {
                    productId: product.id,
                    unitVariantId: unit.id,
                    packageVariantId: box.id,
                    unitLabel: 'Unit',
                    packageLabel: 'Case',
                    unitsPerPackage: 4,
                    enabled: true,
                    autoUnpack: true,
                };
                await f.connection.withTransaction(f.a, tx => packaging.updateConfig(tx, packagingInput));
                const warehouse = await f.connection.rawConnection
                    .getRepository(StockLocation)
                    .findOneOrFail({ where: { channels: { id: f.a.channelId } } });
                const supplier = await f.server.app
                    .get(CatalogSupplierService)
                    .create(f.a, { code: 'sync-pack-source', name: 'Synthetic source supplier' });
                const purchases = f.server.app.get(PurchaseOrderService);
                const purchase = await purchases.create(f.a, {
                    supplierId: supplier.id,
                    stockLocationId: warehouse.id,
                    currencyCode: f.a.currencyCode,
                    lines: [{ productVariantId: box.id, orderedQuantity: 2, unitCostMicrounits: 1_000_000 }],
                });
                await purchases.submit(f.a, purchase.id);
                await purchases.receive(f.a, {
                    purchaseOrderId: purchase.id,
                    idempotencyKey: 'sync-case-receipt',
                    lines: [
                        {
                            purchaseOrderLineId: purchase.lines[0].id,
                            receivedQuantity: 2,
                            acceptedQuantity: 2,
                            rejectedQuantity: 0,
                            lotCode: 'SYNC-SOURCE-PACK-LOT',
                        },
                    ],
                });
                f.products.push({ id: String(product.id), variantId: String(unit.id) });
                await f.connection.rawConnection.getRepository(Collection).update(f.child.id, {
                    filters: [
                        {
                            code: 'variant-id-filter',
                            args: [
                                {
                                    name: 'variantIds',
                                    value: JSON.stringify(f.products.map(p => p.variantId)),
                                },
                                { name: 'combineWithAnd', value: 'true' },
                            ],
                        },
                    ],
                });
                await addSyntheticCollectionMembers(f.connection, f.child.id, [unit.id]);
                await f.drain();
                // Source maintenance remains possible after licensing; target edits remain denied.
                await f.connection.withTransaction(f.a, tx => packaging.updateConfig(tx, packagingInput));
                await expect(
                    f.connection.withTransaction(f.b, tx => packaging.updateConfig(tx, packagingInput)),
                ).rejects.toThrow();
                const order = await createOrder(f.b, [{ variant: unit, amount: 600 }]);
                const customer = await f.server.app.get(CustomerService).create(f.b, {
                    firstName: 'Synthetic',
                    lastName: 'Pack',
                    emailAddress: 'sync-pack@example.invalid',
                });
                if (!('id' in customer)) throw new Error('Synthetic package customer was not created');
                await f.connection.rawConnection.getRepository(Order).update(order.id, {
                    customerId: customer.id,
                    shippingAddress: {
                        fullName: 'Synthetic Buyer',
                        streetLine1: '1 Synthetic Road',
                        city: 'Kuala Lumpur',
                        province: 'Kuala Lumpur',
                        postalCode: '50000',
                        country: 'Malaysia',
                        countryCode: 'MY',
                        phoneNumber: '+60000000000',
                    },
                });
                const orders = f.server.app.get(OrderService);
                const methods = await orders.getEligibleShippingMethods(f.b, order.id);
                const method = requireSyntheticFixture(
                    methods.find(m => m.metadata?.shippingGroupId === String(f.a.channelId)),
                );
                const selected = await f.connection.withTransaction(f.b, tx =>
                    orders.setShippingMethod(tx, order.id, [method.id]),
                );
                expect('errorCode' in selected).toBe(false);
                const arranged = await orders.transitionToState(f.b, order.id, 'ArrangingPayment');
                expect('errorCode' in arranged ? arranged : null).toBeNull();
                if ('errorCode' in arranged) throw new Error('Source package checkout transition failed');
                await f.connection.withTransaction(f.b, tx =>
                    f.server.app
                        .get(StockMovementService)
                        .createSalesForOrder(tx, [{ orderLineId: order.lines[0].id, quantity: 1 }]),
                );
                const lots = await f.connection.rawConnection
                    .getRepository(InventoryLot)
                    .find({ where: { stockLocationId: warehouse.id } });
                expect(lots.find(l => String(l.variantId) === String(box.id))?.quantityOnHand).toBe(1);
                expect(lots.find(l => String(l.variantId) === String(unit.id))?.quantityOnHand).toBe(3);
                expect(
                    await f.connection.rawConnection.getRepository(StockLevel).count({
                        where: {
                            productVariantId: unit.id,
                            stockLocation: { channels: { id: f.b.channelId } },
                        },
                    }),
                ).toBe(0);
            },
            120_000,
        );
    });
}
