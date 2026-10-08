import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
    isConfirmedControlledTestPayment,
    isControlledTestPaymentMethod,
} from '@vendure/common/lib/controlled-test-payment';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Allocation,
    Channel,
    EventBus,
    Order,
    OrderEvent,
    OrderLine,
    OrderLineEvent,
    PaymentAttemptEvent,
    PaymentStateTransitionEvent,
    RefundStateTransitionEvent,
    Release,
    RequestContext,
    RequestContextService,
    Sale,
    ScheduledTask,
    StockMovementService,
    TransactionalConnection,
    UserInputError,
    assertOrderSalesChannel,
    effectiveRefundLines,
} from '@vendure/core';
import { In, LessThan } from 'typeorm';

import { DigitalProductService } from './digital-product.service';
import { CheckoutResourceHold } from './entities/digital-product.entity';
import { getOrderLineFulfillmentType } from './fulfillment-classification';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';
import { ProductPackagingService } from './product-packaging.service';

@Injectable()
export class CheckoutResourcesService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly events: EventBus,
        private readonly digital: DigitalProductService,
        private readonly stock: StockMovementService,
        private readonly contexts: RequestContextService,
        private readonly packaging: ProductPackagingService,
    ) {}

    onApplicationBootstrap() {
        this.events.registerBlockingEventHandler({
            event: OrderEvent,
            id: 'commerce-digital-quantity-change-guard',
            handler: async event => {
                if (event.type !== 'updated' || event.entity.state !== 'Modifying') return;
                const order = await this.order(event.ctx, event.entity.id);
                const refunded = effectiveRefundLines(
                    order.payments.flatMap(payment => payment.refunds ?? []),
                );
                for (const line of order.lines) {
                    if (
                        getOrderLineFulfillmentType(line) === 'digital' &&
                        line.quantity > line.orderPlacedQuantity &&
                        refunded.some(
                            item => String(item.orderLineId) === String(line.id) && item.quantity > 0,
                        )
                    )
                        throw new UserInputError(
                            '该数字订单行已有按份退款，请新建订单购买，不能恢复已撤销的交付内容',
                        );
                }
                const additions = order.lines.filter(
                    line =>
                        getOrderLineFulfillmentType(line) === 'digital' &&
                        line.quantity > line.orderPlacedQuantity,
                );
                for (const line of additions) {
                    if (line.orderPlacedQuantity > 0 && !(await this.digital.reservation(event.ctx, line.id)))
                        throw new UserInputError('历史数字订单缺少成交资源快照，请新建订单购买');
                }
                if (additions.length) {
                    const originalLines = order.lines;
                    try {
                        order.lines = additions;
                        await this.digital.reserveOrder(event.ctx, order);
                    } finally {
                        order.lines = originalLines;
                    }
                }
            },
        });
        this.events.registerBlockingEventHandler({
            event: PaymentAttemptEvent,
            id: 'commerce-resource-payment-attempt',
            handler: async event => {
                // Persist outside the payment DB transaction: a gateway charge cannot be rolled back with SQL.
                const attempts = this.connection.rawConnection.getRepository(CheckoutResourceHold);
                const hold = await attempts.findOne({
                    where: { orderId: event.order.id, channelId: event.ctx.channelId },
                });
                if (event.phase === 'STARTED') {
                    if (!hold && !event.order.active && event.order.orderPlacedAt) return;
                    if (
                        !hold ||
                        hold.state === 'RELEASED' ||
                        (hold.state === 'HELD' && hold.expiresAt <= new Date())
                    ) {
                        throw new UserInputError('结算占用已失效，请返回购物车重新结算');
                    }
                    if (hold.state === 'PAYING' || hold.state === 'REVIEW')
                        throw new UserInputError('上一次付款结果尚待确认，请勿重复付款');
                    const changed = await attempts.update(
                        { id: hold.id, state: In(['HELD', 'CONFIRMED']) },
                        { state: 'PAYING' },
                    );
                    if (changed.affected !== 1) throw new UserInputError('付款已在处理中，请勿重复提交');
                } else {
                    // Even a network exception can follow a successful charge. Only explicit declines release resources.
                    const declined =
                        event.phase === 'RETURNED' &&
                        ['Declined', 'Cancelled'].includes(event.resultState ?? '');
                    if (declined) {
                        const currentOrder = await this.order(event.ctx, event.order.id);
                        if (
                            this.simulationDisposition(currentOrder) === 'REVIEW' ||
                            currentOrder.payments.some(
                                payment =>
                                    !['Authorized', 'Settled', 'Declined', 'Cancelled'].includes(
                                        payment.state,
                                    ) || payment.metadata?.manualReview?.required,
                            )
                        ) {
                            await attempts.update(
                                { orderId: event.order.id },
                                { state: 'REVIEW', reviewReason: '付款结果待核验' },
                            );
                            return;
                        }
                        const alreadyFunded = currentOrder.payments.some(
                            payment =>
                                ['Authorized', 'Settled'].includes(payment.state) &&
                                !payment.metadata?.public?.testPayment &&
                                !isControlledTestPaymentMethod(payment.method),
                        );
                        if (alreadyFunded) {
                            await attempts.update(
                                { orderId: event.order.id },
                                { state: 'CONFIRMED', reviewReason: null },
                            );
                            return;
                        }
                        await attempts.update(
                            { orderId: event.order.id },
                            { state: 'HELD', expiresAt: new Date() },
                        );
                        await this.release(event.ctx, event.order);
                    } else
                        await attempts.update(
                            { orderId: event.order.id },
                            { state: 'REVIEW', reviewReason: '付款结果待核验' },
                        );
                }
            },
        });
        this.events.registerBlockingEventHandler({
            event: PaymentStateTransitionEvent,
            id: 'commerce-resource-payment-confirm',
            handler: async event => {
                if (['Authorized', 'Settled'].includes(event.toState))
                    await this.confirm(event.ctx, event.order);
                if (['Declined', 'Cancelled'].includes(event.toState)) {
                    const order = await this.order(event.ctx, event.order.id);
                    if (this.simulationDisposition(order) === 'SIMULATED') {
                        await this.confirm(event.ctx, order);
                        return;
                    }
                    if (
                        !order.payments.some(
                            payment =>
                                !['Declined', 'Cancelled'].includes(payment.state) ||
                                payment.metadata?.manualReview?.required,
                        )
                    ) {
                        await this.connection
                            .getRepository(event.ctx, CheckoutResourceHold)
                            .update(
                                { orderId: order.id, channelId: event.ctx.channelId },
                                { state: 'HELD', reviewReason: null },
                            );
                        await this.release(event.ctx, order);
                    }
                }
            },
        });
        this.events.registerBlockingEventHandler({
            event: RefundStateTransitionEvent,
            id: 'commerce-digital-refund-release',
            handler: async event => {
                await this.events.publish(new OrderProcessingChangedEvent(event.ctx, event.order.id));
                if (event.toState === 'Failed') {
                    const { fulfillDigitalOrder } = await import('./commerce-order-process.js');
                    await fulfillDigitalOrder(event.ctx, event.order.id);
                }
                if (event.toState !== 'Settled') return;
                const order = await this.order(event.ctx, event.order.id);
                const refund = order.payments
                    .flatMap(payment => payment.refunds ?? [])
                    .find(item => String(item.id) === String(event.refund.id));
                for (const item of refund?.lines ?? [])
                    await this.digital.releaseLine(event.ctx, item.orderLineId, item.quantity);
            },
        });
        this.events.registerBlockingEventHandler({
            event: OrderLineEvent,
            id: 'commerce-digital-cancel-release',
            handler: async event => {
                if (['deleted', 'cancelled'].includes(event.type)) {
                    await this.assertCancellationAllowed(event.ctx, event.order.id);
                    const reservation = await this.digital.reservation(event.ctx, event.orderLine.id);
                    if (reservation)
                        await this.digital.releaseLine(
                            event.ctx,
                            event.orderLine.id,
                            event.type === 'deleted'
                                ? reservation.quantity
                                : Math.max(
                                      0,
                                      reservation.quantity -
                                          event.orderLine.quantity -
                                          reservation.releasedQuantity,
                                  ),
                        );
                }
            },
        });
    }

    hold(ctx: RequestContext, orderId: ID) {
        return this.connection
            .getRepository(ctx, CheckoutResourceHold)
            .findOne({ where: { orderId, channelId: ctx.channelId } });
    }

    async outstandingAllocation(ctx: RequestContext, lineId: ID): Promise<number> {
        const [allocated, released, sold] = await Promise.all([
            this.connection.getRepository(ctx, Allocation).find({ where: { orderLine: { id: lineId } } }),
            this.connection.getRepository(ctx, Release).find({ where: { orderLine: { id: lineId } } }),
            this.connection.getRepository(ctx, Sale).find({ where: { orderLine: { id: lineId } } }),
        ]);
        return Math.max(
            0,
            allocated.reduce((sum, row) => sum + row.quantity, 0) -
                released.reduce((sum, row) => sum + row.quantity, 0) -
                sold.reduce((sum, row) => sum + Math.abs(row.quantity), 0),
        );
    }

    async reserve(ctx: RequestContext, order: Order, physicalLines: Order['lines']) {
        assertOrderSalesChannel(ctx, order);
        await this.digital.lock(ctx, Order, order.id);
        const old = await this.hold(ctx, order.id);
        if (old && ['PAYING', 'REVIEW'].includes(old.state))
            throw new UserInputError('付款结果尚待核验，暂不能重新结算');
        const expiresAt = await this.expiry(ctx, order.id);
        await this.digital.reserveOrder(ctx, order, expiresAt);
        for (const line of physicalLines) {
            const allocated = await this.outstandingAllocation(ctx, line.id);
            if (allocated < line.quantity)
                await this.stock.createAllocationsForOrderLines(ctx, [
                    { orderLineId: line.id, quantity: line.quantity - allocated },
                ]);
        }
        await this.connection.getRepository(ctx, CheckoutResourceHold).save(
            new CheckoutResourceHold({
                ...old,
                channelId: ctx.channelId,
                orderId: order.id,
                state: 'HELD',
                expiresAt,
            }),
        );
    }

    async confirm(ctx: RequestContext, order: Order) {
        // Payment events carry the caller's pre-payment Order. Read the linked, persisted evidence.
        await this.digital.lock(ctx, Order, order.id);
        order = await this.order(ctx, order.id);
        const hold = await this.hold(ctx, order.id);
        const simulation = this.simulationDisposition(order);
        if (simulation === 'REVIEW') {
            await this.markReview(ctx, order, '付款证据不完整或与模拟付款混合，请核对原始支付凭证');
            return;
        }
        if (!hold) return; // Existing paid orders remain readable during staged rollout.
        if (simulation === 'SIMULATED') {
            // A successful local handler has a known outcome. It has no external funds to reconcile.
            if (hold.state !== 'RELEASED') {
                await this.connection.getRepository(ctx, CheckoutResourceHold).update(hold.id, {
                    state: 'HELD',
                    reviewReason: null,
                });
                await this.release(ctx, order);
            }
            return;
        }
        const intact = await this.resourcesIntact(ctx, order);
        if (hold.state === 'REVIEW' && hold.reviewReason && hold.reviewReason !== '付款结果待核验') return;
        await this.connection.getRepository(ctx, CheckoutResourceHold).update(hold.id, {
            state: intact && hold.state !== 'RELEASED' ? 'CONFIRMED' : 'REVIEW',
            reviewReason:
                intact && hold.state !== 'RELEASED'
                    ? null
                    : '付款已记录，结算资源不足或占用已释放，请补货后重试交付或退款',
        });
    }

    async isConfirmedSimulation(ctx: RequestContext, orderId: ID): Promise<boolean> {
        return this.simulationDisposition(await this.order(ctx, orderId)) === 'SIMULATED';
    }

    private simulationDisposition(order: Order): 'SIMULATED' | 'REVIEW' | 'REAL' {
        if (
            order.payments.some(
                payment =>
                    !['Authorized', 'Settled', 'Declined', 'Cancelled'].includes(payment.state) ||
                    payment.metadata?.manualReview?.required,
            )
        )
            return 'REVIEW';
        const successful = order.payments.filter(payment =>
            ['Authorized', 'Settled'].includes(payment.state),
        );
        const hasTestEvidence = successful.some(
            payment => isControlledTestPaymentMethod(payment.method) || payment.metadata?.public?.testPayment,
        );
        if (!hasTestEvidence) return 'REAL';
        return successful.every(isConfirmedControlledTestPayment) ? 'SIMULATED' : 'REVIEW';
    }

    async markReview(ctx: RequestContext, order: Order, reason: string) {
        await this.connection.getRepository(ctx, CheckoutResourceHold).save(
            new CheckoutResourceHold({
                ...(await this.hold(ctx, order.id)),
                channelId: ctx.channelId,
                orderId: order.id,
                state: 'REVIEW',
                expiresAt: new Date(),
                reviewReason: reason.slice(0, 1000),
            }),
        );
        await this.events.publish(new OrderProcessingChangedEvent(ctx, order.id));
    }

    private resourceLines(order: Order): OrderLine[] {
        const refunded = new Map<string, number>();
        for (const item of effectiveRefundLines(order.payments.flatMap(payment => payment.refunds ?? []))) {
            const key = String(item.orderLineId);
            refunded.set(key, (refunded.get(key) ?? 0) + item.quantity);
        }
        return order.lines
            .map(
                line =>
                    new OrderLine({
                        ...line,
                        quantity: Math.max(
                            0,
                            Math.min(
                                line.quantity,
                                (line.orderPlacedQuantity || line.quantity) -
                                    (refunded.get(String(line.id)) ?? 0),
                            ),
                        ),
                    }),
            )
            .filter(line => line.quantity > 0);
    }

    private async resourcesIntact(ctx: RequestContext, order: Order) {
        for (const line of this.resourceLines(order)) {
            if (getOrderLineFulfillmentType(line) === 'digital') {
                const reservation = await this.digital.reservation(ctx, line.id);
                if (
                    (await this.digital.config(ctx, line.productVariantId)) &&
                    (!reservation ||
                        reservation.state === 'RELEASED' ||
                        reservation.quantity - reservation.releasedQuantity < line.quantity)
                )
                    return false;
            } else if (line.quantity > (await this.outstandingAllocation(ctx, line.id))) {
                const sold = await this.connection
                    .getRepository(ctx, Sale)
                    .find({ where: { orderLine: { id: line.id } } });
                if (
                    line.quantity >
                    (await this.outstandingAllocation(ctx, line.id)) +
                        sold.reduce((sum, item) => sum + Math.abs(item.quantity), 0)
                )
                    return false;
            }
        }
        return true;
    }

    async exceptions(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CheckoutResourceHold).find({
            where: { channelId: ctx.channelId, state: 'REVIEW' },
            order: { updatedAt: 'DESC' },
            take: 100,
        });
    }

    async retryDelivery(ctx: RequestContext, orderId: ID) {
        await this.digital.lock(ctx, Order, orderId);
        const order = await this.order(ctx, orderId);
        assertOrderSalesChannel(ctx, order);
        if (this.hasTestPaymentIdentity(order))
            throw new UserInputError('模拟付款订单不具备真实交付资格，暂不能补交付');
        if (this.simulationDisposition(order) === 'REVIEW')
            throw new UserInputError('实际付款尚未确认或付款证据混合，暂不能补交付');
        const funding = order.payments.filter(
            payment =>
                payment.state === 'Settled' &&
                !payment.metadata?.public?.testPayment &&
                !isControlledTestPaymentMethod(payment.method),
        );
        const paid = funding.reduce((sum, payment) => sum + payment.amount, 0);
        if (
            order.active ||
            !order.orderPlacedAt ||
            ['Cancelled', 'Modifying', 'ArrangingAdditionalPayment'].includes(order.state) ||
            !funding.length ||
            !Number.isSafeInteger(order.totalWithTax) ||
            order.totalWithTax < 0 ||
            funding.some(payment => !Number.isSafeInteger(payment.amount) || payment.amount < 0) ||
            !Number.isSafeInteger(paid) ||
            paid < order.totalWithTax
        )
            throw new UserInputError('实际付款尚未确认或订单已取消，暂不能补交付');
        const held = await this.hold(ctx, order.id);
        if (!held || held.state !== 'REVIEW') throw new UserInputError('该订单没有待处理的交付异常');
        const resourceLines = this.resourceLines(order);
        if (order.lines.length && !resourceLines.length)
            throw new UserInputError('订单商品已全部退款或正在退款，暂不能补交付');
        const physical = resourceLines.filter(line => getOrderLineFulfillmentType(line) === 'physical');
        const rules = await this.packaging.rulesForVariantIds(
            ctx,
            physical.map(line => line.productVariantId),
        );
        await this.packaging.ensureStockLevelPairs(ctx, rules);
        const ids = this.packaging.variantIdsForLock(
            physical.map(line => line.productVariantId),
            rules,
        );
        if (ids.length) {
            const levels = this.connection.getRepository(ctx, (await import('@vendure/core')).StockLevel);
            const query = levels
                .createQueryBuilder('stock')
                .leftJoinAndSelect('stock.stockLocation', 'location')
                .leftJoinAndSelect('location.channels', 'channel')
                .where('stock.productVariantId IN (:...ids)', { ids })
                .orderBy('stock.productVariantId', 'ASC')
                .addOrderBy('stock.stockLocationId', 'ASC');
            if (!['sqljs', 'sqlite', 'better-sqlite3'].includes(levels.manager.connection.options.type))
                query.setLock('pessimistic_write');
            const locked = await query.getMany();
            const remaining = await Promise.all(
                physical.map(async line => {
                    const sales = await this.connection
                        .getRepository(ctx, Sale)
                        .find({ where: { orderLine: { id: line.id } } });
                    return {
                        productVariantId: line.productVariantId,
                        quantity: Math.max(
                            0,
                            line.quantity -
                                (await this.outstandingAllocation(ctx, line.id)) -
                                sales.reduce((sum, sale) => sum + Math.abs(sale.quantity), 0),
                        ),
                    };
                }),
            );
            const error = await this.packaging.autoUnpackForOrder(ctx, order, remaining, rules, locked);
            if (error) throw new UserInputError(error);
        }
        const originalLines = order.lines;
        try {
            order.lines = resourceLines;
            await this.digital.reserveOrder(ctx, order, held.expiresAt);
        } finally {
            order.lines = originalLines;
        }
        for (const line of physical) {
            const sales = await this.connection
                .getRepository(ctx, Sale)
                .find({ where: { orderLine: { id: line.id } } });
            const quantity =
                line.quantity -
                (await this.outstandingAllocation(ctx, line.id)) -
                sales.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
            if (quantity > 0)
                await this.stock.createAllocationsForOrderLines(ctx, [{ orderLineId: line.id, quantity }]);
        }
        if (!(await this.resourcesIntact(ctx, order)))
            throw new UserInputError('当前资源仍不足，请先补货或选择退款');
        await this.connection
            .getRepository(ctx, CheckoutResourceHold)
            .update(held.id, { state: 'CONFIRMED', reviewReason: null });
        const { fulfillDigitalOrder } = await import('./commerce-order-process.js');
        await fulfillDigitalOrder(ctx, order.id);
        await this.events.publish(new OrderProcessingChangedEvent(ctx, order.id));
        return this.hold(ctx, order.id);
    }

    async canDeliver(ctx: RequestContext, orderId: ID, currentOrder?: Order): Promise<boolean> {
        const order =
            currentOrder && String(currentOrder.id) === String(orderId)
                ? currentOrder
                : await this.order(ctx, orderId);
        if (this.hasTestPaymentIdentity(order)) return false;
        if (this.simulationDisposition(order) !== 'REAL') return false;
        const hold = await this.hold(ctx, orderId);
        return !hold || hold.state === 'CONFIRMED';
    }

    private hasTestPaymentIdentity(order: Order): boolean {
        return order.payments.some(
            payment =>
                isControlledTestPaymentMethod(payment.method) ||
                payment.metadata?.public?.testPayment === true,
        );
    }

    async assertCancellationAllowed(ctx: RequestContext, orderId: ID) {
        const hold = await this.hold(ctx, orderId);
        if (hold?.state === 'PAYING' || (hold?.state === 'REVIEW' && hold.reviewReason === '付款结果待核验'))
            throw new UserInputError('付款结果尚待核验，不能取消订单或释放交付资源');
        if (this.simulationDisposition(await this.order(ctx, orderId)) === 'REVIEW')
            throw new UserInputError('付款结果尚待核验，不能取消订单或释放交付资源');
    }

    async release(ctx: RequestContext, order: Order) {
        await this.digital.lock(ctx, Order, order.id);
        await this.assertCancellationAllowed(ctx, order.id);
        const hold = await this.hold(ctx, order.id);
        if (!hold || hold.state === 'RELEASED') return;
        for (const line of order.lines) {
            await this.digital.releaseLine(ctx, line.id);
            // Staged-rollout digital variants may still have legacy warehouse allocations.
            const quantity = await this.outstandingAllocation(ctx, line.id);
            if (quantity)
                await this.stock.createReleasesForOrderLines(ctx, [{ orderLineId: line.id, quantity }]);
        }
        await this.connection.getRepository(ctx, CheckoutResourceHold).update(hold.id, { state: 'RELEASED' });
    }

    async reconcileExpired() {
        const holds = await this.connection.rawConnection.getRepository(CheckoutResourceHold).find({
            where: { state: In(['HELD', 'PAYING', 'REVIEW']), expiresAt: LessThan(new Date()) },
            take: 100,
        });
        let released = 0;
        for (const hold of holds) {
            const channel = await this.connection.rawConnection
                .getRepository(Channel)
                .findOne({ where: { id: hold.channelId } });
            if (!channel) continue;
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            // Waiting for the cart/order lock must not preserve a pre-receipt funding snapshot.
            await this.connection.withTransaction(
                ctx,
                async tx => {
                    await this.digital.lock(tx, Order, hold.orderId);
                    const current = await this.hold(tx, hold.orderId);
                    if (!current || current.state === 'RELEASED' || current.expiresAt > new Date()) return;
                    const order = await this.order(tx, hold.orderId);
                    if (order.payments.some(payment => ['Authorized', 'Settled'].includes(payment.state))) {
                        const simulated = this.simulationDisposition(order) === 'SIMULATED';
                        // An older simulation does not resolve a later attempt whose gateway result is unknown.
                        if (simulated && current.state !== 'HELD') return;
                        await this.confirm(tx, order);
                        if (simulated && (await this.hold(tx, order.id))?.state === 'RELEASED') released++;
                        return;
                    }
                    // Pending/unknown gateway attempts must be reconciled, never inferred to be unpaid.
                    if (
                        current.state !== 'HELD' ||
                        order.payments.some(
                            payment =>
                                !['Declined', 'Cancelled'].includes(payment.state) ||
                                payment.metadata?.manualReview?.required,
                        )
                    )
                        return;
                    const expiresAt = await this.expiry(tx, order.id, false);
                    if (expiresAt && expiresAt > new Date()) {
                        await this.connection
                            .getRepository(tx, CheckoutResourceHold)
                            .update(hold.id, { expiresAt });
                        return;
                    }
                    await this.release(tx, order);
                    released++;
                },
                ['mysql', 'mariadb', 'postgres'].includes(this.connection.rawConnection.options.type)
                    ? 'READ COMMITTED'
                    : undefined,
            );
        }
        return { examined: holds.length, released };
    }

    private order(ctx: RequestContext, id: ID) {
        return this.connection.getEntityOrThrow(ctx, Order, id, {
            relations: [
                'lines',
                'lines.productVariant',
                'payments',
                'payments.refunds',
                'payments.refunds.lines',
            ],
        });
    }

    private async expiry(ctx: RequestContext, orderId: ID, fallback = true): Promise<Date> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(
            item => item.name === 'StorefrontUsdtPaymentIntent',
        );
        if (metadata) {
            const intents = await this.connection
                .getRepository(ctx, metadata.target)
                .find({ where: { orderId } });
            const latest = intents.reduce(
                (max: number, item: any) => Math.max(max, new Date(item.expiresAt).getTime()),
                0,
            );
            if (latest) return new Date(latest);
        }
        return new Date(fallback ? Date.now() + 15 * 60_000 : 0);
    }
}

export const reconcileCheckoutResourcesTask = new ScheduledTask({
    id: 'reconcile-checkout-resources',
    description: 'Release expired, confirmed-unpaid checkout resources',
    schedule: cron => cron.every(1).minutes(),
    execute: ({ injector }) => injector.get(CheckoutResourcesService).reconcileExpired(),
});
