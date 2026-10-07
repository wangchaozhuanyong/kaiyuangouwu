import {
    CurrencyCode,
    LanguageCode,
    Order,
    OrderLine,
    OrderService,
    Payment,
    PaymentMethodService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { AutoCardSupplyService } from '../../commerce-fulfillment-plugin/src/auto-card-supply.service';
import { AutoCardService } from '../../commerce-fulfillment-plugin/src/auto-card.service';
import { AutoCardConfig } from '../../commerce-fulfillment-plugin/src/entities/auto-card-config.entity';
import { AutoCardDelivery } from '../../commerce-fulfillment-plugin/src/entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from '../../commerce-fulfillment-plugin/src/entities/auto-card-pool-item.entity';
import { AutoCardSupplyGrant } from '../../commerce-fulfillment-plugin/src/entities/auto-card-supply-grant.entity';
export function registerCardConcurrencyAcceptance(
    state: () => {
        server: any;
        connection: TransactionalConnection;
        platform: RequestContext;
        a: RequestContext;
        b: RequestContext;
        variantIds: string[];
    },
) {
    it.skipIf(process.env.PLATFORM_GOVERNANCE_MYSQL !== '1')(
        'allocates the original A pool once across A/B competition and duplicate paid events, resumes shortage after restock, and retains cards after refund',
        async () => {
            const { server, connection, platform, a, b, variantIds } = state();
            const auto: AutoCardService = server.app.get(AutoCardService);
            const supply: AutoCardSupplyService = server.app.get(AutoCardSupplyService);
            const config = await connection.rawConnection
                .getRepository(AutoCardConfig)
                .findOneByOrFail({ channelId: a.channelId, productVariantId: variantIds[1] });
            const grant = await connection.rawConnection
                .getRepository(AutoCardSupplyGrant)
                .findOneByOrFail({ channelId: b.channelId, productVariantId: variantIds[1] });
            await connection.withTransaction(platform, tx =>
                supply.setGrant(tx, {
                    channelId: b.channelId,
                    productVariantId: variantIds[1],
                    configId: config.id,
                    enabled: true,
                    version: grant.version,
                }),
            );
            const imported = await connection.withTransaction(a, tx =>
                auto.importPoolItems(tx, {
                    productVariantId: variantIds[1],
                    rawText: `SYNTHETIC-COMPETITION-${randomUUID()}`,
                }),
            );
            expect(imported.importedCount).toBe(1);
            const variant = await server.app.get(ProductVariantService).findOne(a, variantIds[1]);
            const createOrder = async (salesContext: RequestContext) => {
                const order = await connection.rawConnection.getRepository(Order).save(
                    new Order({
                        code: `RACE-${randomUUID()}`,
                        state: 'ArrangingPayment',
                        salesChannelId: salesContext.channelId,
                        channels: [salesContext.channel],
                        currencyCode: CurrencyCode.USD,
                        couponCodes: [],
                        shippingAddress: {},
                        billingAddress: {},
                        subTotal: 2400,
                        subTotalWithTax: 2400,
                        customFields: { deliveryEmail: 'synthetic-buyer@example.invalid' },
                    }),
                );
                const line = await connection.rawConnection.getRepository(OrderLine).save(
                    new OrderLine({
                        order,
                        productVariant: variant,
                        quantity: 1,
                        listPrice: 2400,
                        listPriceIncludesTax: false,
                        adjustments: [],
                        taxLines: [],
                        customFields: {
                            fulfillmentTypeSnapshot: 'digital',
                            digitalDeliveryModeSnapshot: 'auto_card',
                        },
                    }),
                );
                line.productVariant = variant;
                order.lines = [line];
                expect(
                    await connection.withTransaction(salesContext, tx => auto.availabilityError(tx, order)),
                ).toBeUndefined();
                order.state = 'PaymentSettled';
                order.active = false;
                order.orderPlacedAt = new Date();
                await connection.rawConnection.getRepository(Order).update(order.id, {
                    state: 'PaymentSettled',
                    active: false,
                    orderPlacedAt: order.orderPlacedAt,
                });
                line.orderPlacedQuantity = 1;
                await connection.rawConnection
                    .getRepository(OrderLine)
                    .update(line.id, { orderPlacedQuantity: 1 });
                // Seed native synthetic evidence as well as the state label; no external payment is sent.
                order.payments = [
                    await connection.rawConnection.getRepository(Payment).save(
                        new Payment({
                            order,
                            state: 'Settled',
                            amount: 2400,
                            method: 'governance-concurrency-local-fixture',
                            transactionId: `fixture-${order.code}`,
                            metadata: {},
                            refunds: [],
                        }),
                    ),
                ];
                return order;
            };
            const orderA = await createOrder(a);
            const orderB = await createOrder(b);
            const concurrent = await Promise.all([
                connection.withTransaction(a, tx => auto.allocateSettledOrder(tx, orderA)),
                connection.withTransaction(b, tx => auto.allocateSettledOrder(tx, orderB)),
                connection.withTransaction(b, tx => auto.allocateSettledOrder(tx, orderB)),
            ]);
            const deliveries = await connection.rawConnection.getRepository(AutoCardDelivery).find({
                where: [{ orderId: orderA.id }, { orderId: orderB.id }],
                relations: { poolItems: true },
            });
            expect(deliveries).toHaveLength(2);
            expect(concurrent[1][0].id).toBe(concurrent[2][0].id);
            expect(deliveries.filter(d => d.state === 'ALLOCATED')).toHaveLength(1);
            expect(deliveries.filter(d => d.state === 'WAITING_STOCK')).toHaveLength(1);
            expect(deliveries.flatMap(d => d.poolItems)).toHaveLength(1);
            const waiting = deliveries.find(d => d.state === 'WAITING_STOCK');
            if (!waiting) throw new Error('Missing expected shortage delivery');
            await expect(
                auto.emailPayload(waiting.channelId === a.channelId ? a : b, waiting.id),
            ).rejects.toThrow('尚未分配');
            const current = await connection.rawConnection
                .getRepository(AutoCardSupplyGrant)
                .findOneByOrFail({ id: grant.id });
            await connection.withTransaction(platform, tx =>
                supply.setGrant(tx, {
                    channelId: b.channelId,
                    productVariantId: variantIds[1],
                    configId: config.id,
                    enabled: false,
                    version: current.version,
                }),
            );
            expect(await supply.resolve(b, variantIds[1])).toBeNull();
            await connection.withTransaction(a, tx =>
                auto.importPoolItems(tx, {
                    productVariantId: variantIds[1],
                    rawText: `SYNTHETIC-RESTOCK-${randomUUID()}`,
                }),
            );
            const resumed = await connection.rawConnection
                .getRepository(AutoCardDelivery)
                .findOneOrFail({ where: { id: waiting.id }, relations: { poolItems: true } });
            expect(resumed.state).toBe('ALLOCATED');
            expect(resumed.poolItems).toHaveLength(1);
            const ctx = resumed.channelId === a.channelId ? a : b;
            const original = (await auto.emailPayload(ctx, resumed.id)).credentials.map(
                c => c.fields[0].value,
            );
            await connection.withTransaction(ctx, tx =>
                auto.recordEmailResult(tx, resumed.id, false, new Error('Synthetic email failure')),
            );
            await connection.withTransaction(ctx, tx => auto.retryDelivery(tx, resumed.id));
            expect(
                (await auto.emailPayload(ctx, resumed.id)).credentials.map(c => c.fields[0].value),
            ).toEqual(original);
            await connection.withTransaction(ctx, tx => auto.recordEmailResult(tx, resumed.id, true));
            const refundMethod = await server.app.get(PaymentMethodService).create(platform, {
                code: 'synthetic-refund-method',
                enabled: false,
                handler: {
                    code: 'dummy-payment-handler',
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        name: '合成退款配置',
                        description: '本地合成验收，无真实转账',
                    },
                ],
            });
            const paid = await connection.rawConnection.getRepository(Payment).findOneOrFail({
                where: { order: { id: resumed.orderId }, state: 'Settled' },
            });
            await connection.rawConnection
                .getRepository(Payment)
                .update(paid.id, { method: refundMethod.code });
            paid.method = refundMethod.code;
            const orders: OrderService = server.app.get(OrderService);
            const request = {
                paymentId: paid.id,
                amount: 2400,
                shipping: 0,
                adjustment: 0,
                reason: 'Synthetic local refund',
                lines: [],
            };
            await expect(
                orders.refundOrder(ctx.channelId === a.channelId ? b : a, request),
            ).rejects.toThrow();
            const refund = await orders.refundOrder(ctx, request);
            expect(refund).toMatchObject({ total: 2400, state: 'Pending' });
            await expect(
                orders.settleRefund(ctx, {
                    id: (refund as any).id,
                    transactionId: 'synthetic-manual-refund-proof',
                }),
            ).rejects.toThrow('登记线下退款');
            const settled = await orders.recordManualRefund(ctx, {
                refundId: (refund as any).id,
                transactionId: 'synthetic-manual-refund-proof',
                evidenceReference: 'local-fixture:synthetic-refund-receipt',
                note: 'Synthetic local receipt only; no external transfer',
            });
            expect(settled.state).toBe('Settled');
            expect(
                (
                    await orders.settleRefund(ctx, {
                        id: settled.id,
                        transactionId: 'synthetic-manual-refund-proof',
                    })
                ).id,
            ).toBe(settled.id);
            await connection.rawConnection
                .getRepository(Order)
                .update(resumed.orderId, { state: 'Cancelled' });
            await auto.reconcilePending();
            expect(
                (
                    await connection.rawConnection
                        .getRepository(AutoCardPoolItem)
                        .findOneByOrFail({ id: resumed.poolItems[0].id })
                ).state,
            ).toBe('ASSIGNED');
            const all = await connection.rawConnection.getRepository(AutoCardDelivery).find({
                where: [{ orderId: orderA.id }, { orderId: orderB.id }],
                relations: { poolItems: true },
            });
            expect(new Set(all.flatMap(d => d.poolItems.map(i => i.id))).size).toBe(2);
            expect(
                await connection.rawConnection
                    .getRepository(AutoCardPoolItem)
                    .count({ where: { configId: config.id, state: 'AVAILABLE' } }),
            ).toBe(0);
        },
    );
}
