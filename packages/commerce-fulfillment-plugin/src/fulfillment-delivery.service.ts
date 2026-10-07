import { Injectable } from '@nestjs/common';
import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    CustomerService,
    effectiveRefundLines,
    EntityNotFoundError,
    EventBus,
    Fulfillment,
    FulfillmentService,
    Order,
    OrderService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { LessThanOrEqual } from 'typeorm';

import { CheckoutResourcesService } from './checkout-resources.service';
import { guardDigitalFulfillment } from './digital-fulfillment.guard';
import { DigitalReceiptService } from './digital-receipt.service';
import { FulfillmentDeliveryEvent } from './entities/fulfillment-delivery-event.entity';
import {
    FulfillmentDeliveryRecord,
    type FulfillmentDeliveryStatus,
} from './entities/fulfillment-delivery-record.entity';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';
import {
    ConfirmFulfillmentDeliveryInput,
    FulfillmentDeliveryListOptions,
    UpdateFulfillmentDeliveryInput,
} from './types';

const DELIVERY_SLA_DAYS = 14;
const NOTE_MAX_LENGTH = 2_000;
const FULFILLABLE_ORDER_STATES = new Set([
    'PaymentAuthorized',
    'PaymentSettled',
    'PartiallyShipped',
    'PartiallyDelivered',
]);
const DIGITAL_FULFILLMENT_HANDLERS = new Set([
    'digital-fulfillment',
    'manual-service-fulfillment',
    'auto-card-fulfillment',
]);

@Injectable()
export class FulfillmentDeliveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly fulfillmentService: FulfillmentService,
        private readonly customerService: CustomerService,
        private readonly requestContextService: RequestContextService,
        private readonly eventBus: EventBus,
        private readonly orderService: OrderService,
        private readonly receipts: DigitalReceiptService,
        private readonly resources: CheckoutResourcesService,
    ) {}

    async recordShippedTransition(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
    ): Promise<void> {
        if (!isPhysicalFulfillment(fulfillment, orders)) return;
        const order = orderForFulfillment(fulfillment, orders);
        if (!order) throw new UserInputError('履约记录缺少订单归属');
        const key = `FULFILLMENT_SHIPPED:${String(fulfillment.id)}`.slice(0, 80);
        let record = await this.recordRepository(ctx).findOne({
            where: { fulfillmentId: fulfillment.id },
            relations: { events: true },
        });
        if (!record) {
            record = await this.recordRepository(ctx).save(
                new FulfillmentDeliveryRecord({
                    fulfillment,
                    fulfillmentId: fulfillment.id,
                    order,
                    orderId: order.id,
                    channel: ctx.channel,
                    channelId: ctx.channelId,
                    status: 'IN_TRANSIT',
                    carrier: requiredText(fulfillment.method, 120, '物流公司'),
                    trackingCode: requiredText(fulfillment.trackingCode, 160, '运单号'),
                    exceptionReason: null,
                    proofReference: null,
                    shippedAt: new Date(),
                    deliveredAt: null,
                    nextActionDueAt: addDays(new Date(), DELIVERY_SLA_DAYS),
                    events: [],
                }),
            );
        } else if (record.status !== 'DELIVERED') {
            record.status = 'IN_TRANSIT';
            record.carrier = requiredText(fulfillment.method, 120, '物流公司');
            record.trackingCode = requiredText(fulfillment.trackingCode, 160, '运单号');
            record.exceptionReason = null;
            record.nextActionDueAt = addDays(new Date(), DELIVERY_SLA_DAYS);
            record = await this.recordRepository(ctx).save(record);
        }
        if (!(await this.eventExists(ctx, record.id, key))) {
            await this.addEvent(
                ctx,
                record,
                'IN_TRANSIT',
                'SYSTEM',
                'Fulfillment process',
                null,
                '实物包裹已发出',
                key,
            );
        }
    }

    async guardPhysicalFulfillmentPayment(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
        toState: 'Pending' | 'Shipped',
    ): Promise<string | void> {
        const locked = await this.lockedFulfillment(ctx, fulfillment, orders);
        if (typeof locked === 'string') return locked;
        const { current, owners } = locked;
        if (current.state !== fulfillment.state || !['Created', 'Pending'].includes(current.state))
            return '包裹状态已变化，请刷新后重试';
        const resourceBoundary = await this.guardDeliveryResources(ctx, owners);
        if (resourceBoundary) return resourceBoundary;
        const included = current.lines.map(fulfillmentLine => {
            const matches = owners.flatMap(order =>
                (order.lines ?? [])
                    .filter(line => String(line.id) === String(fulfillmentLine.orderLineId))
                    .map(line => ({ order, line })),
            );
            return { fulfillmentLine, matches };
        });
        if (included.some(item => item.matches.length !== 1)) return '实物履约记录缺少订单归属';
        const types = included.map(
            item =>
                item.matches[0].line.customFields?.fulfillmentTypeSnapshot ??
                item.matches[0].line.productVariant?.customFields?.fulfillmentType,
        );
        if (types.some(type => !['physical', 'digital'].includes(type ?? '')))
            return '历史订单缺少商品交付类型，请核对后再发货';
        if (types.includes('digital')) {
            if (toState === 'Pending' && types.every(type => type === 'digital') && owners.length === 1) {
                const statuses = await this.receipts.statuses(ctx, owners[0]);
                return guardDigitalFulfillment(owners[0], current, statuses, 'Pending');
            }
            return '数字明细必须通过数字交付流程，不能使用实物发货';
        }
        if (DIGITAL_FULFILLMENT_HANDLERS.has(current.handlerCode)) return '实物商品不能使用数字交付处理器';
        for (const owner of owners) {
            if (owner.active || !owner.orderPlacedAt || !FULFILLABLE_ORDER_STATES.has(owner.state))
                return owner.state === 'Cancelled'
                    ? '订单已取消，停止实物发货'
                    : owner.state === 'Modifying'
                      ? '请先结束订单修改，再处理实物发货'
                      : '订单未付款或未授权，不能创建实物发货';
            const payments = owner.payments ?? [];
            const funding = payments.filter(
                payment =>
                    ['Settled', 'Authorized'].includes(payment.state) &&
                    !isControlledTestPaymentMethod(payment.method) &&
                    payment.metadata?.public?.testPayment !== true,
            );
            if (
                !Number.isSafeInteger(owner.totalWithTax) ||
                owner.totalWithTax < 0 ||
                !funding.length ||
                funding.some(payment => !Number.isSafeInteger(payment.amount) || payment.amount < 0) ||
                funding.reduce((sum, payment) => sum + payment.amount, 0) < owner.totalWithTax
            )
                return '订单收款或有效支付授权金额不足，请先处理补款';
        }
        const requested = new Map<string, number>();
        for (const { fulfillmentLine } of included) {
            if (!Number.isSafeInteger(fulfillmentLine.quantity) || fulfillmentLine.quantity <= 0)
                return '实物包裹的发货份数无效';
            const key = String(fulfillmentLine.orderLineId);
            requested.set(key, (requested.get(key) ?? 0) + fulfillmentLine.quantity);
        }
        for (const [lineId, quantity] of requested) {
            const includedLine = included.find(item => String(item.fulfillmentLine.orderLineId) === lineId);
            if (!includedLine?.matches[0]) return '包裹明细未加载完整，请刷新后重试';
            const { order: owner, line } = includedLine.matches[0];
            if (
                !Number.isSafeInteger(line.quantity) ||
                line.quantity < 0 ||
                !Number.isSafeInteger(line.orderPlacedQuantity) ||
                line.orderPlacedQuantity < 0
            )
                return '历史订单缺少有效商品数量，请核对后再发货';
            const refundLines = effectiveRefundLines(
                (owner.payments ?? []).flatMap(payment => payment.refunds ?? []),
            ).filter(item => String(item.orderLineId) === lineId);
            if (refundLines.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 0))
                return '退款份数记录异常，请核对后再发货';
            const refunded = refundLines.reduce((sum, item) => sum + item.quantity, 0);
            const valid = Math.max(
                0,
                Math.min(line.quantity, (line.orderPlacedQuantity || line.quantity) - refunded),
            );
            const dispatchedLines = (owner.fulfillments ?? [])
                .filter(
                    item =>
                        String(item.id) !== String(current.id) &&
                        ['Shipped', 'Delivered'].includes(item.state),
                )
                .flatMap(item => item.lines ?? [])
                .filter(item => String(item.orderLineId) === lineId);
            if (dispatchedLines.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 0))
                return '已发货份数记录异常，请核对后再发货';
            const dispatched = dispatchedLines.reduce((sum, item) => sum + item.quantity, 0);
            if (quantity > Math.max(0, valid - dispatched)) {
                return '包裹份数超过当前可发数量，请核对退款和已发货记录';
            }
        }
        if (
            toState === 'Shipped' &&
            (!current.method?.trim() ||
                current.method.trim().length > 120 ||
                !current.trackingCode?.trim() ||
                current.trackingCode.trim().length > 160)
        )
            return '请先填写有效的物流公司和运单号，再发出包裹';
        // The core transition loaded this object before waiting for the order lock. Preserve the
        // current logistics values rather than overwriting a concurrently prepared package.
        fulfillment.method = current.method;
        fulfillment.trackingCode = current.trackingCode;
        fulfillment.lines = current.lines;
    }

    private async guardDeliveryResources(ctx: RequestContext, owners: Order[]): Promise<string | void> {
        for (const order of owners) {
            // The locking read owns this evidence. A later ordinary read must not revive a test order.
            if (
                (order.payments ?? []).some(
                    payment =>
                        isControlledTestPaymentMethod(payment.method) ||
                        payment.metadata?.public?.testPayment === true,
                )
            )
                return '模拟付款订单不能创建真实交付';
            if (!(await this.resources.canDeliver(ctx, order.id, order)))
                return '付款或交付资源尚待核验，不能创建真实交付';
        }
    }

    private async lockedFulfillment(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
    ): Promise<{ current: Fulfillment; owners: Order[] } | string> {
        if (!fulfillment.id || !orders.length) return '实物履约记录缺少订单归属';
        const orderIds = [...new Set(orders.map(order => String(order.id)))].sort();
        // The surrounding Fulfillment transition transaction retains these write locks until the
        // state is saved. Refunds and competing packages therefore share the same quantity boundary.
        for (const orderId of orderIds) await this.orderService.lockOrderForRefund(ctx, orderId);
        const fulfillmentQuery = this.connection
            .getRepository(ctx, Fulfillment)
            .createQueryBuilder('fulfillment')
            .leftJoinAndSelect('fulfillment.lines', 'fulfillmentLine')
            .leftJoinAndSelect('fulfillment.orders', 'owner')
            .where('fulfillment.id = :fulfillmentId', { fulfillmentId: fulfillment.id });
        const orderQuery = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.lines', 'line')
            .leftJoinAndSelect('line.productVariant', 'variant')
            .leftJoinAndSelect('order.payments', 'payment')
            .leftJoinAndSelect('payment.refunds', 'refund')
            .leftJoinAndSelect('refund.lines', 'refundLine')
            .leftJoinAndSelect('order.fulfillments', 'package')
            .leftJoinAndSelect('package.lines', 'packageLine')
            .where('order.id IN (:...orderIds)', { orderIds });
        const databaseType = this.connection.rawConnection.options.type;
        if (['mysql', 'mariadb', 'postgres'].includes(databaseType)) {
            // A normal SELECT may retain the pre-lock snapshot under MySQL REPEATABLE READ.
            // Locking reads fetch current rows; PostgreSQL locks only the non-null root table.
            fulfillmentQuery.setLock(
                'pessimistic_write',
                undefined,
                databaseType === 'postgres' ? ['fulfillment'] : undefined,
            );
            orderQuery.setLock(
                'pessimistic_write',
                undefined,
                databaseType === 'postgres' ? ['order'] : undefined,
            );
        }
        const current = await fulfillmentQuery.getOne();
        const owners = await orderQuery.getMany();
        if (
            !current?.lines?.length ||
            owners.length !== orderIds.length ||
            current.orders.length !== orderIds.length ||
            current.orders.some(order => !orderIds.includes(String(order.id)))
        )
            return '实物履约记录缺少订单归属';
        if (
            owners.some(
                order =>
                    order.salesChannelId == null || String(order.salesChannelId) !== String(ctx.channelId),
            )
        )
            return '包裹不属于当前经营店铺';
        return { current, owners };
    }

    async guardDeliveredTransition(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
    ): Promise<string | void> {
        const locked = await this.lockedFulfillment(ctx, fulfillment, orders);
        if (typeof locked === 'string') return locked;
        const { current, owners } = locked;
        if (current.state !== fulfillment.state) return '包裹状态已变化，请刷新后重试';
        const resourceBoundary = await this.guardDeliveryResources(ctx, owners);
        if (resourceBoundary) return resourceBoundary;
        const included = current.lines.map(item =>
            owners.flatMap(order =>
                order.lines
                    .filter(line => String(line.id) === String(item.orderLineId))
                    .map(line => ({ order, line })),
            ),
        );
        if (included.some(matches => matches.length !== 1)) return '履约记录缺少订单归属';
        const types = included.map(
            matches =>
                matches[0].line.customFields?.fulfillmentTypeSnapshot ??
                matches[0].line.productVariant?.customFields?.fulfillmentType,
        );
        if (types.every(type => type === 'digital') && owners.length === 1) {
            const statuses = await this.receipts.statuses(ctx, owners[0]);
            return guardDigitalFulfillment(owners[0], current, statuses, 'Delivered');
        }
        if (types.some(type => type !== 'physical') || DIGITAL_FULFILLMENT_HANDLERS.has(current.handlerCode))
            return '请通过商品对应的交付流程处理，不能使用通用履约绕过交付校验';
        const record = await this.recordRepository(ctx).findOne({
            where: { fulfillmentId: fulfillment.id, channelId: ctx.channelId },
        });
        if (!record?.proofReference) {
            return '实物履约必须通过配送证据流程记录送达凭证';
        }
    }

    async finalizeDeliveredTransition(ctx: RequestContext, fulfillment: Fulfillment): Promise<void> {
        const record = await this.recordRepository(ctx).findOne({
            where: { fulfillmentId: fulfillment.id, channelId: ctx.channelId },
        });
        if (!record?.proofReference) return;
        record.status = 'DELIVERED';
        record.exceptionReason = null;
        record.deliveredAt ??= new Date();
        record.nextActionDueAt = null;
        await this.recordRepository(ctx).save(record);
    }

    findForFulfillment(ctx: RequestContext, fulfillmentId: ID): Promise<FulfillmentDeliveryRecord | null> {
        return this.recordRepository(ctx)
            .findOne({
                where: { fulfillmentId, channelId: ctx.channelId },
                relations: { fulfillment: true, order: true, events: true },
                order: { events: { createdAt: 'ASC' } },
            })
            .then(record => (record ? this.normalize(record) : null));
    }

    async findExceptions(ctx: RequestContext, options: FulfillmentDeliveryListOptions = {}) {
        const skip = boundedInteger(options.skip, 0, 0, 10_000);
        const take = boundedInteger(options.take, 20, 1, 100);
        const now = new Date();
        const where =
            options.exceptionsOnly === false
                ? { channelId: ctx.channelId }
                : [
                      { channelId: ctx.channelId, status: 'EXCEPTION' as const },
                      {
                          channelId: ctx.channelId,
                          status: 'IN_TRANSIT' as const,
                          nextActionDueAt: LessThanOrEqual(now),
                      },
                  ];
        const [items, totalItems] = await this.recordRepository(ctx).findAndCount({
            where,
            relations: { fulfillment: true, order: true, events: true },
            order: { nextActionDueAt: 'ASC', id: 'ASC', events: { createdAt: 'ASC' } },
            skip,
            take,
        });
        return { items: items.map(item => this.normalize(item)), totalItems };
    }

    updateForAdmin(
        ctx: RequestContext,
        input: UpdateFulfillmentDeliveryInput,
    ): Promise<FulfillmentDeliveryRecord> {
        return this.connection.withTransaction(ctx, txCtx =>
            this.update(txCtx, input, 'ADMIN', 'Store team', String(ctx.activeUserId ?? '')),
        );
    }

    async confirmForCustomer(
        ctx: RequestContext,
        input: ConfirmFulfillmentDeliveryInput,
    ): Promise<FulfillmentDeliveryRecord> {
        const customer = ctx.activeUserId
            ? await this.customerService.findOneByUserId(ctx, ctx.activeUserId)
            : null;
        if (!customer) throw new UserInputError('请先登录');
        return this.connection.withTransaction(ctx, async txCtx => {
            const { fulfillment, orders } = await this.loadFulfillment(txCtx, input.fulfillmentId);
            if (!orders.some(order => String(order.customer?.id) === String(customer.id))) {
                throw new UserInputError('履约记录不存在或当前账号无权操作');
            }
            return this.updateLoaded(
                txCtx,
                fulfillment,
                orders,
                {
                    fulfillmentId: input.fulfillmentId,
                    status: 'DELIVERED',
                    proofReference: 'CUSTOMER_CONFIRMED',
                    note: '客户确认实物包裹已收到',
                    idempotencyKey: input.idempotencyKey,
                },
                'CUSTOMER',
                [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.emailAddress,
                String(ctx.activeUserId ?? customer.id),
            );
        });
    }

    private async update(
        ctx: RequestContext,
        input: UpdateFulfillmentDeliveryInput,
        actorType: 'ADMIN' | 'CUSTOMER',
        actorLabel: string,
        actorId: string,
    ) {
        const { fulfillment, orders } = await this.loadFulfillment(ctx, input.fulfillmentId);
        return this.updateLoaded(ctx, fulfillment, orders, input, actorType, actorLabel, actorId);
    }

    private async updateLoaded(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
        input: UpdateFulfillmentDeliveryInput,
        actorType: 'ADMIN' | 'CUSTOMER',
        actorLabel: string,
        actorId: string,
    ): Promise<FulfillmentDeliveryRecord> {
        if (!isPhysicalFulfillment(fulfillment, orders)) {
            throw new UserInputError('数字交付不使用实物配送证据流程');
        }
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        const note = requiredText(input.note, NOTE_MAX_LENGTH, '操作说明');
        let record = await this.recordRepository(ctx).findOne({
            where: { fulfillmentId: fulfillment.id, channelId: ctx.channelId },
            relations: { events: true },
        });
        if (record && (await this.eventExists(ctx, record.id, key))) return this.normalize(record);
        if (fulfillment.state !== 'Shipped') {
            throw new UserInputError('只有运输中的实物履约可以更新配送证据');
        }
        if (!record) {
            const order = orderForFulfillment(fulfillment, orders);
            if (!order) throw new UserInputError('履约记录缺少订单归属');
            record = await this.recordRepository(ctx).save(
                new FulfillmentDeliveryRecord({
                    fulfillment,
                    fulfillmentId: fulfillment.id,
                    order,
                    orderId: order.id,
                    channel: ctx.channel,
                    channelId: ctx.channelId,
                    status: 'IN_TRANSIT',
                    carrier: requiredText(fulfillment.method, 120, '物流公司'),
                    trackingCode: requiredText(fulfillment.trackingCode, 160, '运单号'),
                    exceptionReason: null,
                    proofReference: null,
                    shippedAt: fulfillment.updatedAt ?? new Date(),
                    deliveredAt: null,
                    nextActionDueAt: addDays(fulfillment.updatedAt ?? new Date(), DELIVERY_SLA_DAYS),
                    events: [],
                }),
            );
        }
        if (input.status === 'EXCEPTION') {
            if (record.status !== 'IN_TRANSIT') throw new UserInputError('当前配送状态不能登记异常');
            record.status = 'EXCEPTION';
            record.exceptionReason = note;
            record.nextActionDueAt = new Date();
        } else if (input.status === 'IN_TRANSIT') {
            if (record.status !== 'EXCEPTION') throw new UserInputError('只有异常配送可以重新发运');
            record.status = 'IN_TRANSIT';
            record.carrier = requiredText(input.carrier, 120, '物流公司');
            record.trackingCode = requiredText(input.trackingCode, 160, '运单号');
            record.exceptionReason = null;
            record.nextActionDueAt = addDays(new Date(), DELIVERY_SLA_DAYS);
            fulfillment.method = record.carrier;
            fulfillment.trackingCode = record.trackingCode;
            await this.connection.getRepository(ctx, Fulfillment).save(fulfillment);
        } else {
            if (!['IN_TRANSIT', 'EXCEPTION'].includes(record.status)) {
                throw new UserInputError('当前配送状态不能确认送达');
            }
            record.status = 'DELIVERED';
            record.proofReference = requiredText(input.proofReference, 255, '送达凭证');
            record.exceptionReason = null;
            record.deliveredAt = new Date();
            record.nextActionDueAt = null;
        }
        record = await this.recordRepository(ctx).save(record);
        await this.addEvent(ctx, record, input.status, actorType, actorLabel, actorId, note, key);
        await this.publishDeliveryIncident(ctx, this.normalize(record));
        if (input.status === 'DELIVERED') {
            const transition = await this.fulfillmentService.transitionToState(
                ctx,
                fulfillment.id,
                'Delivered',
            );
            if (!('fulfillment' in transition)) {
                throw new UserInputError(transition.transitionError);
            }
        }
        await this.eventBus.publish(new OrderProcessingChangedEvent(ctx, String(record.orderId)));
        return (await this.findForFulfillment(ctx, fulfillment.id)) ?? this.normalize(record);
    }

    async reconcileOverdue(): Promise<{ flagged: number }> {
        const records = await this.connection.rawConnection.getRepository(FulfillmentDeliveryRecord).find({
            where: [
                { status: 'EXCEPTION' },
                { status: 'IN_TRANSIT', nextActionDueAt: LessThanOrEqual(new Date()) },
            ],
            relations: { channel: true, order: true, fulfillment: true },
            order: { nextActionDueAt: 'ASC', id: 'ASC' },
            take: 500,
        });
        for (const record of records) {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: record.channel,
            });
            await this.publishDeliveryIncident(ctx, this.normalize(record));
        }
        return { flagged: records.length };
    }

    private publishDeliveryIncident(ctx: RequestContext, record: FulfillmentDeliveryRecord) {
        const fingerprint = `fulfillment.delivery:${String(record.channelId)}:${String(record.id)}`;
        const firing = record.status === 'EXCEPTION' || record.overdue;
        return this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: firing ? 'INCIDENT_FIRING' : 'INCIDENT_RESOLVED',
                eventType: firing ? 'fulfillment.delivery.attention' : 'fulfillment.delivery.recovered',
                category: 'FULFILLMENT',
                severity: 'P2',
                sourceType: 'Fulfillment',
                sourceId: String(record.fulfillmentId),
                fingerprint,
                title: firing
                    ? `订单 ${record.order?.code ?? record.orderId} 配送需要处理`
                    : '配送异常已恢复',
                payload: {
                    channelId: String(record.channelId),
                    orderId: String(record.orderId),
                    fulfillmentId: String(record.fulfillmentId),
                    status: record.status,
                    overdue: record.overdue,
                    carrier: record.carrier,
                    trackingCode: record.trackingCode,
                    exceptionReason: record.exceptionReason,
                    nextActionDueAt: record.nextActionDueAt?.toISOString() ?? null,
                    adminPath: `/orders/${record.orderId}`,
                },
            }),
        );
    }

    private async loadFulfillment(ctx: RequestContext, id: ID) {
        const fulfillment = await this.connection.getRepository(ctx, Fulfillment).findOne({
            where: { id },
            relations: ['lines'],
        });
        if (!fulfillment) throw new EntityNotFoundError(Fulfillment.name, id);
        const lineIds = fulfillment.lines.map(line => line.orderLineId);
        const orders = lineIds.length
            ? await this.connection
                  .getRepository(ctx, Order)
                  .createQueryBuilder('order')
                  .leftJoinAndSelect('order.lines', 'line')
                  .leftJoinAndSelect('order.customer', 'customer')
                  .where('line.id IN (:...lineIds)', { lineIds })
                  .andWhere('order.salesChannelId = :channelId', { channelId: ctx.channelId })
                  .getMany()
            : [];
        if (!orders.length) throw new EntityNotFoundError(Fulfillment.name, id);
        return { fulfillment, orders };
    }

    private eventExists(ctx: RequestContext, recordId: ID, key: string): Promise<boolean> {
        return this.connection.getRepository(ctx, FulfillmentDeliveryEvent).exists({
            where: { recordId, idempotencyKey: key },
        });
    }

    private addEvent(
        ctx: RequestContext,
        record: FulfillmentDeliveryRecord,
        status: FulfillmentDeliveryStatus,
        actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM',
        actorLabel: string,
        actorId: string | null,
        note: string,
        idempotencyKey: string,
    ) {
        return this.connection.getRepository(ctx, FulfillmentDeliveryEvent).save(
            new FulfillmentDeliveryEvent({
                record,
                recordId: record.id,
                status,
                idempotencyKey,
                actorType,
                actorLabel,
                actorId,
                note,
                carrier: record.carrier,
                trackingCode: record.trackingCode,
                proofReference: record.proofReference,
            }),
        );
    }

    private recordRepository(ctx: RequestContext) {
        return this.connection.getRepository(ctx, FulfillmentDeliveryRecord);
    }

    private normalize(record: FulfillmentDeliveryRecord) {
        record.events = [...(record.events ?? [])].sort(
            (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
        record.overdue =
            record.status !== 'DELIVERED' &&
            record.nextActionDueAt != null &&
            record.nextActionDueAt.getTime() <= Date.now();
        return record;
    }
}

function isPhysicalFulfillment(fulfillment: Fulfillment, orders: Order[]): boolean {
    const lineIds = new Set((fulfillment.lines ?? []).map(line => String(line.orderLineId)));
    return orders.some(order =>
        (order.lines ?? []).some(
            line =>
                lineIds.has(String(line.id)) &&
                (line.customFields?.fulfillmentTypeSnapshot ??
                    line.productVariant?.customFields?.fulfillmentType ??
                    'physical') === 'physical',
        ),
    );
}

function orderForFulfillment(fulfillment: Fulfillment, orders: Order[]): Order | undefined {
    const lineIds = new Set((fulfillment.lines ?? []).map(line => String(line.orderLineId)));
    return orders.find(order => (order.lines ?? []).some(line => lineIds.has(String(line.id))));
}

function requiredText(value: unknown, max: number, label: string): string {
    if (typeof value !== 'string') throw new UserInputError(`${label}不能为空`);
    const text = value.trim();
    if (!text || text.length > max) throw new UserInputError(`${label}不能为空且不能超过 ${max} 个字符`);
    return text;
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function boundedInteger(
    value: number | null | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    if (value == null) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new UserInputError(`分页参数必须是 ${min} 到 ${max} 之间的整数`);
    }
    return value;
}
