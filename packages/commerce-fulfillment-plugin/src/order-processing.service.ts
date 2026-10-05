import { Injectable, OnModuleInit } from '@nestjs/common';
import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import type { RefundOrderInput } from '@vendure/common/lib/generated-types';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    Channel,
    ConfigService,
    effectiveRefundLines,
    EventBus,
    Fulfillment,
    isGraphQlErrorResult,
    Order,
    orderItemsAreDelivered,
    OrderService,
    Payment,
    PaymentMethod,
    Permission,
    Refund,
    RequestContext,
    scopeOrderQuery,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { sensitiveStoreFinancePermission } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { fulfillDigitalOrder } from './commerce-order-process';
import { DigitalReceiptService } from './digital-receipt.service';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { CheckoutResourceHold } from './entities/digital-product.entity';
import { FulfillmentDeliveryRecord } from './entities/fulfillment-delivery-record.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { getOrderLineDigitalDeliveryMode, getOrderLineFulfillmentType } from './fulfillment-classification';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';
import {
    matchesProcessingCategory,
    OrderProcessingSummary,
    ProcessingCategory,
    ProcessingSource,
    summarizeProcessing,
} from './order-processing-summary';

export interface OrderProcessingListOptions {
    category?: ProcessingCategory;
    skip?: number;
    take?: number;
    term?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
}

const CATEGORIES = [
    'PENDING',
    'DIGITAL',
    'PHYSICAL',
    'EXCEPTIONS',
    'AFTER_SALES',
    'ALL',
    'DRAFT',
    'IN_TRANSIT',
    'DELIVERED',
    'CANCELLED',
    'TO_SETTLE',
];
const ORDER_RELATIONS = [
    'lines',
    'lines.productVariant',
    'lines.productVariant.translations',
    'lines.productVariant.options',
    'lines.featuredAsset',
    'customer',
    'payments',
    'payments.refunds',
    'payments.refunds.lines',
    'fulfillments',
    'fulfillments.lines',
    'salesChannel',
] as const;
const summaryKey = Symbol('order-processing-summary');
type ProcessingOrder = Order & { [summaryKey]?: OrderProcessingSummary };

@Injectable()
export class OrderProcessingService implements OnModuleInit {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly config: ConfigService,
        private readonly receipts: DigitalReceiptService,
        private readonly events: EventBus,
    ) {}

    onModuleInit() {
        this.orderService.registerRefundRequestValidator(
            'commerce-order-processing',
            (ctx, order, input, existingRefund) =>
                this.validateRefundRequest(ctx, order, input, existingRefund),
        );
    }

    async validateRefundRequest(
        ctx: RequestContext,
        parent: Order,
        input: RefundOrderInput,
        existingRefund?: Refund,
    ): Promise<void> {
        const order = await this.orderService.findOne(
            ctx,
            parent.id,
            ['lines', 'lines.productVariant'],
            'business',
        );
        if (!order) throw new UserInputError('退款订单不属于当前经营店铺');
        if (
            (input.shipping ?? 0) > 0 &&
            order.lines.every(line => getOrderLineFulfillmentType(line) === 'digital')
        )
            throw new UserInputError('纯数字订单不适用运费退款，请选择商品退款或金额补偿');
        if (!input.afterSalesId) return;
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id: input.afterSalesId, orderId: order.id, channelId: ctx.channelId },
            relations: ['items'],
        });
        if (!request || request.state !== 'APPROVED' || !request.approvedAmount)
            throw new UserInputError('售后申请不存在、不属于当前订单或尚未通过退款审核');
        if (
            request.refundId &&
            !(existingRefund?.state === 'Failed' && String(request.refundId) === String(existingRefund.id))
        )
            throw new UserInputError('该售后申请已关联退款，请处理原退款记录');
        const existing = await this.connection.getRepository(ctx, Refund).find({
            where: { payment: { order: { id: order.id } } },
            relations: ['lines'],
        });
        const reserved = existing.filter(
            refund =>
                ['Pending', 'Settled'].includes(refund.state) &&
                String(refund.metadata?.refundRequest?.afterSalesId) === String(request.id),
        );
        const amount =
            input.amount ??
            (input.lines ?? []).reduce(
                (sum, item) => {
                    const line = order.lines.find(
                        candidate => String(candidate.id) === String(item.orderLineId),
                    );
                    return sum + (line?.proratedUnitPriceWithTax ?? 0) * item.quantity;
                },
                (input.shipping ?? 0) + (input.adjustment ?? 0),
            );
        if (amount + reserved.reduce((sum, refund) => sum + refund.total, 0) > request.approvedAmount)
            throw new UserInputError('退款金额超过售后通过金额');
        for (const line of input.lines ?? []) {
            const approved = request.items.find(
                item => String(item.orderLineId) === String(line.orderLineId),
            );
            const quantity = effectiveRefundLines(
                existing.filter(
                    refund => String(refund.metadata?.refundRequest?.afterSalesId) === String(request.id),
                ),
                existingRefund?.metadata?.refundRequest?.quantityGroup?.key,
            )
                .filter(item => String(item.orderLineId) === String(line.orderLineId))
                .reduce((sum, item) => sum + item.quantity, 0);
            if (!approved || line.quantity + quantity > approved.quantity)
                throw new UserInputError('退款份数超过该售后商品申请');
        }
    }

    async prepareShipment(
        ctx: RequestContext,
        input: { fulfillmentId: ID; carrier: string; trackingCode: string },
    ) {
        const carrier = input.carrier?.trim();
        const trackingCode = input.trackingCode?.trim();
        if (!carrier || carrier.length > 120 || !trackingCode || trackingCode.length > 160)
            throw new UserInputError('请填写有效的物流公司和运单号');
        return this.orderService.withOrderMutationTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, Fulfillment);
            let fulfillment = await repository.findOne({
                where: { id: input.fulfillmentId },
                relations: ['orders', 'orders.lines', 'orders.lines.productVariant', 'lines'],
            });
            if (
                !fulfillment ||
                fulfillment.orders.length !== 1 ||
                String(fulfillment.orders[0].salesChannelId) !== String(txCtx.channelId)
            )
                throw new UserInputError('包裹不存在或不属于当前经营店铺');
            const owner = fulfillment.orders[0];
            await this.orderService.lockOrderForRefund(txCtx, owner.id);
            fulfillment = await repository.findOne({
                where: { id: input.fulfillmentId },
                relations: ['lines'],
            });
            const order = await this.orderService.findOne(txCtx, owner.id, [...ORDER_RELATIONS], 'business');
            if (!fulfillment || !order || !['Pending', 'Created'].includes(fulfillment.state))
                throw new UserInputError('仅尚未发出的包裹可以补充物流资料');
            const summary = await this.forOrder(txCtx, order);
            if (
                !summary.canManage ||
                !txCtx.userHasPermissions([Permission.UpdateOrder]) ||
                !order.orderPlacedAt ||
                order.active ||
                !['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'].includes(
                    order.state,
                ) ||
                summary.isTestOrder
            )
                throw new UserInputError('订单当前不允许处理发货');
            const authorized = order.payments
                .filter(
                    payment =>
                        payment.state === 'Authorized' &&
                        payment.metadata?.public?.testPayment !== true &&
                        !isControlledTestPaymentMethod(payment.method),
                )
                .reduce((sum, payment) => sum + payment.amount, 0);
            if (summary.settledAmount + authorized < order.totalWithTax)
                throw new UserInputError('请先确认足额收款或支付授权');
            for (const line of fulfillment.lines) {
                const item = summary.lines.find(
                    candidate => candidate.orderLineId === String(line.orderLineId),
                );
                const otherShipped = order.fulfillments
                    .filter(
                        candidate =>
                            String(candidate.id) !== String(fulfillment.id) &&
                            ['Shipped', 'Delivered'].includes(candidate.state),
                    )
                    .flatMap(candidate => candidate.lines ?? [])
                    .filter(candidate => String(candidate.orderLineId) === String(line.orderLineId))
                    .reduce((sum, candidate) => sum + candidate.quantity, 0);
                if (
                    !item ||
                    item.fulfillmentType !== 'physical' ||
                    item.requiredQuantity < line.quantity + otherShipped
                )
                    throw new UserInputError('包裹商品已失去发货资格，请先处理取消或按件退款');
            }
            fulfillment.method = carrier;
            fulfillment.trackingCode = trackingCode;
            await repository.save(fulfillment);
            await this.orderService.addNoteToOrder(txCtx, {
                id: order.id,
                isPublic: false,
                note: `已更新待发包裹 ${String(fulfillment.id)} 的物流资料：${carrier} / ${trackingCode}`,
            });
            await this.events.publish(new OrderProcessingChangedEvent(txCtx, String(order.id)));
            return fulfillment;
        });
    }

    async forOrder(ctx: RequestContext, parent: ProcessingOrder): Promise<OrderProcessingSummary> {
        if (parent[summaryKey]) return this.requireSummary(parent);
        const order = await this.orderService.findOne(ctx, parent.id, [...ORDER_RELATIONS]);
        if (!order) throw new UserInputError('订单不存在或不属于当前可查看店铺');
        return this.requireSummary((await this.attach(ctx, [order]))[0]);
    }

    async list(
        ctx: RequestContext,
        options: OrderProcessingListOptions = {},
    ): Promise<{ items: Order[]; totalItems: number }> {
        const category = options.category ?? 'PENDING';
        if (!CATEGORIES.includes(category)) throw new UserInputError('不支持的订单处理分类');
        const skip = options.skip ?? 0;
        const take = options.take ?? 20;
        if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 100)
            throw new UserInputError('订单分页参数无效');
        const candidates = await this.candidates(ctx, options);
        const items: ProcessingOrder[] = [];
        // Lifecycle filtering happens before pagination, including digital and financial exceptions.
        for (let offset = 0; offset < candidates.length; offset += 100) {
            const orders = await this.load(ctx, candidates.slice(offset, offset + 100));
            for (const order of await this.attach(ctx, orders)) {
                if (!matchesProcessingCategory(this.requireSummary(order), category, order.active)) continue;
                items.push(order);
            }
        }
        if (options.sortBy === 'totalWithTax' || options.sortBy === 'totalQuantity') {
            const key = options.sortBy;
            const direction = options.sortOrder === 'ASC' ? 1 : -1;
            items.sort(
                (a, b) =>
                    direction * (a[key] - b[key]) || direction * String(a.id).localeCompare(String(b.id)),
            );
        }
        return { items: items.slice(skip, skip + take), totalItems: items.length };
    }

    async counts(ctx: RequestContext) {
        const result = { pending: 0, digital: 0, physical: 0, exceptions: 0, afterSales: 0 };
        const ids = await this.candidates(ctx, {});
        const categories = {
            pending: 'PENDING',
            digital: 'DIGITAL',
            physical: 'PHYSICAL',
            exceptions: 'EXCEPTIONS',
            afterSales: 'AFTER_SALES',
        } as const;
        for (let offset = 0; offset < ids.length; offset += 100) {
            for (const order of await this.attach(
                ctx,
                await this.load(ctx, ids.slice(offset, offset + 100)),
            )) {
                for (const [key, category] of Object.entries(categories))
                    if (matchesProcessingCategory(this.requireSummary(order), category, order.active))
                        result[key as keyof typeof result]++;
            }
        }
        return result;
    }

    async finishModification(ctx: RequestContext, orderId: ID) {
        return this.orderService.withOrderMutationTransaction(ctx, txCtx =>
            this.finishModificationInTransaction(txCtx, orderId),
        );
    }

    private async finishModificationInTransaction(ctx: RequestContext, orderId: ID) {
        // This portable write lock also serializes modifications against refunds on the same order.
        await this.orderService.lockOrderForRefund(ctx, orderId);
        const order = await this.orderService.findOne(
            ctx,
            orderId,
            [...ORDER_RELATIONS, 'modifications', 'modifications.payment', 'modifications.refund'],
            'business',
        );
        if (!order) throw new UserInputError('请在订单所属店铺结束修改');
        if (order.state !== 'Modifying') return order;
        const source = await this.forOrder(ctx, order);
        // Pending refunds stay visible independently; they never imply money has reached the buyer.
        const needsAdditionalPayment =
            source.outstandingAmount > 0 ||
            (order.modifications ?? []).some(
                modification => modification.priceChange > 0 && !modification.payment,
            );
        const physicalDelivered = source.lines
            .filter(line => line.fulfillmentType === 'physical')
            .every(line => line.deliveredQuantity >= line.requiredQuantity);
        const anyShipped = order.fulfillments.some(fulfillment => fulfillment.state === 'Shipped');
        const anyDelivered = order.fulfillments.some(fulfillment => fulfillment.state === 'Delivered');
        const remaining = source.remainingPhysicalQuantity > 0;
        const realPayments = order.payments.filter(
            payment =>
                payment.metadata?.public?.testPayment !== true &&
                !isControlledTestPaymentMethod(payment.method),
        );
        const settled = realPayments
            .filter(payment => payment.state === 'Settled')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const authorized = realPayments
            .filter(payment => payment.state === 'Authorized')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const fundingState =
            settled >= order.totalWithTax
                ? 'PaymentSettled'
                : settled + authorized >= order.totalWithTax
                  ? 'PaymentAuthorized'
                  : 'ArrangingAdditionalPayment';
        const target = needsAdditionalPayment
            ? 'ArrangingAdditionalPayment'
            : anyDelivered
              ? physicalDelivered && source.remainingDigitalQuantity === 0
                  ? 'Delivered'
                  : 'PartiallyDelivered'
              : anyShipped
                ? remaining
                    ? 'PartiallyShipped'
                    : 'Shipped'
                : fundingState;
        // Default Vendure does not allow Modifying -> Delivered. Its partial state then closes normally.
        const firstTarget = target === 'Delivered' ? 'PartiallyDelivered' : target;
        const transitioned = await this.orderService.transitionToState(ctx, order.id, firstTarget);
        if (isGraphQlErrorResult(transitioned)) throw new UserInputError(transitioned.message);
        if (needsAdditionalPayment) return transitioned;
        // A zero-price modification has no Payment transition. Reuse the same delivery
        // operation only after the paid Order state has actually been persisted.
        if (settled >= order.totalWithTax) await fulfillDigitalOrder(ctx, order.id);
        const refreshed = await this.orderService.findOne(
            ctx,
            order.id,
            [...ORDER_RELATIONS, 'fulfillments.lines.fulfillment'],
            'business',
        );
        if (
            !refreshed ||
            refreshed.state === 'Delivered' ||
            !orderItemsAreDelivered(refreshed) ||
            !this.orderService.getNextOrderStates(refreshed).includes('Delivered')
        )
            return refreshed ?? transitioned;
        const completed = await this.orderService.transitionToState(ctx, order.id, 'Delivered');
        if (isGraphQlErrorResult(completed)) throw new UserInputError(completed.message);
        return completed;
    }

    /** Internal reminder uses the same facts and rules as the Admin, without inventing a user session. */
    async needsReminder(order: Order): Promise<boolean> {
        if (order.salesChannelId == null) return false;
        const channel = await this.connection.rawConnection
            .getRepository(Channel)
            .findOneBy({ id: order.salesChannelId });
        if (!channel) return false;
        const ctx = new RequestContext({
            apiType: 'admin',
            channel,
            languageCode: channel.defaultLanguageCode,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
        const loaded = await this.load(ctx, [order.id]);
        return loaded.length > 0 && this.requireSummary((await this.attach(ctx, loaded))[0]).needsProcessing;
    }

    private requireSummary(order: ProcessingOrder | undefined): OrderProcessingSummary {
        const summary = order?.[summaryKey];
        if (!summary) throw new UserInputError('订单处理资料不完整，请刷新后重试');
        return summary;
    }

    private async candidates(ctx: RequestContext, options: OrderProcessingListOptions): Promise<ID[]> {
        const query = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .select(['order.id'])
            .leftJoin('order.customer', 'customer')
            .where('(order.active = :inactive OR order.state = :draft)', { inactive: false, draft: 'Draft' });
        scopeOrderQuery(ctx, query, 'read');
        const term = options.term?.trim();
        if (term) {
            if (term.length > 120) throw new UserInputError('订单搜索词过长');
            const paymentMatches = query
                .subQuery()
                .select('1')
                .from(Payment, 'processing_payment')
                .where('processing_payment.orderId = order.id')
                .andWhere("processing_payment.transactionId LIKE :term ESCAPE '!'")
                .getQuery();
            query.andWhere(
                `(order.code LIKE :term ESCAPE '!'
                  OR customer.emailAddress LIKE :term ESCAPE '!'
                  OR customer.firstName LIKE :term ESCAPE '!'
                  OR customer.lastName LIKE :term ESCAPE '!'
                  OR EXISTS ${paymentMatches})`,
                { term: `%${term.replace(/[%_!]/gu, '!$&')}%` },
            );
        }
        const sortMap: Record<string, string> = {
            createdAt: 'order.createdAt',
            orderPlacedAt: 'order.orderPlacedAt',
            code: 'order.code',
            totalWithTax: 'order.totalWithTax',
            totalQuantity: 'order.totalQuantity',
            state: 'order.state',
            customerLastName: 'customer.lastName',
        };
        const sortBy = options.sortBy ?? 'orderPlacedAt';
        const sortOrder = options.sortOrder ?? 'DESC';
        if (!Object.prototype.hasOwnProperty.call(sortMap, sortBy) || !['ASC', 'DESC'].includes(sortOrder))
            throw new UserInputError('订单排序参数无效');
        // Derived money/quantity are sorted after loading the filtered rows, before pagination.
        const persistedSort = ['totalWithTax', 'totalQuantity'].includes(sortBy)
            ? 'order.createdAt'
            : sortMap[sortBy];
        query.orderBy(persistedSort, sortOrder).addOrderBy('order.id', sortOrder);
        return (await query.getMany()).map(order => order.id);
    }

    private async load(ctx: RequestContext, ids: ID[]): Promise<Order[]> {
        if (!ids.length) return [];
        const query = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .where('order.id IN (:...ids)', { ids })
            .setFindOptions({ relations: [...ORDER_RELATIONS] });
        const orders = await scopeOrderQuery(ctx, query, 'read').getMany();
        const positions = new Map(ids.map((id, index) => [String(id), index]));
        return orders.sort(
            (a, b) =>
                (positions.get(String(a.id)) ?? ids.length) - (positions.get(String(b.id)) ?? ids.length),
        );
    }

    private async attach(ctx: RequestContext, orders: Order[]): Promise<ProcessingOrder[]> {
        if (!orders.length) return [];
        const orderIds = orders.map(order => order.id);
        const methods = [
            ...new Set(orders.flatMap(order => (order.payments ?? []).map(payment => payment.method))),
        ];
        const [manual, cards, afterSales, deliveries, paymentMethods, holds] = await Promise.all([
            this.connection.getRepository(ctx, ManualDigitalDelivery).find({
                where: { orderId: In(orderIds) },
                select: ['id', 'orderId', 'orderLineId', 'state', 'quantity', 'recipientEmail', 'expectedAt'],
            }),
            this.connection.getRepository(ctx, AutoCardDelivery).find({
                where: { orderId: In(orderIds) },
                select: ['id', 'orderId', 'orderLineId', 'state', 'quantity', 'recipientEmail'],
            }),
            this.connection
                .getRepository(ctx, AfterSalesRequest)
                .find({ where: { orderId: In(orderIds) }, select: ['id', 'orderId', 'state'] }),
            this.connection
                .getRepository(ctx, FulfillmentDeliveryRecord)
                .find({ where: { orderId: In(orderIds) }, select: ['orderId', 'status', 'nextActionDueAt'] }),
            methods.length
                ? this.connection
                      .getRepository(ctx, PaymentMethod)
                      .find({ where: { code: In(methods) }, withDeleted: true })
                : [],
            this.connection.getRepository(ctx, CheckoutResourceHold).find({
                where: { orderId: In(orderIds), state: 'REVIEW' },
                select: ['orderId', 'reviewReason'],
            }),
        ]);
        return Promise.all(
            orders.map(async order => {
                const matchesOrder = (item: { orderId: ID }) => String(item.orderId) === String(order.id);
                // Platform readers may inspect a different sales channel. The delivery projection
                // uses its owner channel, while write capabilities still use the caller's channel.
                const deliveryCtx =
                    String(order.salesChannelId) === String(ctx.channelId)
                        ? ctx
                        : order.salesChannel
                          ? ctx.copy({ channel: order.salesChannel })
                          : undefined;
                const statuses = deliveryCtx ? await this.receipts.statuses(deliveryCtx, order) : [];
                const source: ProcessingSource = {
                    id: String(order.id),
                    state: order.state,
                    active: order.active,
                    placed: !!order.orderPlacedAt,
                    totalWithTax: order.totalWithTax,
                    recipientEmail: order.customFields?.deliveryEmail,
                    resourceReviewReason:
                        holds.find(matchesOrder)?.reviewReason ??
                        (holds.some(matchesOrder)
                            ? '付款或交付资源待核验，请核对后重试交付或处理退款'
                            : null),
                    canManage:
                        order.salesChannelId != null &&
                        String(order.salesChannelId) === String(ctx.channelId),
                    canUpdate: ctx.userHasPermissions([Permission.UpdateOrder]),
                    canFinance: ctx.userHasPermissions([sensitiveStoreFinancePermission.Permission]),
                    canArrangePayment:
                        ctx.userHasPermissions([Permission.ReadSettings]) ||
                        ctx.userHasPermissions([Permission.ReadPaymentMethod]),
                    shippingWithTax: order.shippingWithTax,
                    payments: (order.payments ?? []).map(payment => {
                        const method = paymentMethods.find(candidate => candidate.code === payment.method);
                        const handler = this.config.paymentOptions.paymentMethodHandlers.find(
                            candidate => candidate.code === method?.handler.code,
                        );
                        return {
                            id: String(payment.id),
                            state: payment.state,
                            amount: payment.amount,
                            method: payment.method,
                            isTest: payment.metadata?.public?.testPayment === true,
                            canCancel: handler?.supportsPaymentCancellation ?? false,
                            refundSettlementMode: handler?.refundSettlementMode ?? 'unsupported',
                            shippingBudget: payment.metadata?.refundBudget?.shippingWithTax,
                            refunds: (payment.refunds ?? []).map(refund => ({
                                id: String(refund.id),
                                state: refund.state,
                                total: refund.total,
                                shipping: refund.shipping,
                                metadata: {
                                    refundRequest: {
                                        quantityGroup: refund.metadata?.refundRequest?.quantityGroup,
                                    },
                                },
                                lines: (refund.lines ?? []).map(line => ({
                                    orderLineId: String(line.orderLineId),
                                    quantity: line.quantity,
                                })),
                            })),
                        };
                    }),
                    lines: (order.lines ?? []).map(line => {
                        const task = [...manual, ...cards].find(
                            item => matchesOrder(item) && String(item.orderLineId) === String(line.id),
                        );
                        const delivery = statuses.find(item => String(item.orderLineId) === String(line.id));
                        return {
                            id: String(line.id),
                            quantity: line.quantity,
                            placedQuantity: line.orderPlacedQuantity,
                            productName:
                                line.productVariant?.name ||
                                line.productVariant?.translations?.[0]?.name ||
                                line.productVariant?.sku ||
                                '商品',
                            sku: line.productVariant?.sku ?? '',
                            type: getOrderLineFulfillmentType(line),
                            mode: getOrderLineDigitalDeliveryMode(line),
                            fulfillments: (order.fulfillments ?? []).flatMap(fulfillment =>
                                (fulfillment.lines ?? [])
                                    .filter(item => String(item.orderLineId) === String(line.id))
                                    .map(item => ({
                                        id: String(fulfillment.id),
                                        state: fulfillment.state,
                                        quantity: item.quantity,
                                    })),
                            ),
                            task: task
                                ? {
                                      id: String(task.id),
                                      state: task.state,
                                      quantity: task.quantity,
                                      recipientEmail: task.recipientEmail,
                                      overdue:
                                          'expectedAt' in task &&
                                          task.expectedAt < new Date() &&
                                          ['WAITING_PROCESSING', 'DRAFT'].includes(task.state),
                                  }
                                : undefined,
                            delivery: delivery
                                ? {
                                      readyQuantity: delivery.readyQuantity,
                                      claimedQuantity: delivery.claimedQuantity,
                                      notificationStatus: notificationStatus(delivery.notificationState),
                                  }
                                : undefined,
                            fileReady:
                                getOrderLineDigitalDeliveryMode(line) === 'file_download' &&
                                delivery?.state === 'READY',
                        };
                    }),
                    afterSales: afterSales
                        .filter(matchesOrder)
                        .map(item => ({ id: String(item.id), state: item.state })),
                    deliveryException: deliveries.some(
                        item =>
                            matchesOrder(item) &&
                            (item.status === 'EXCEPTION' ||
                                (item.status === 'IN_TRANSIT' &&
                                    item.nextActionDueAt != null &&
                                    item.nextActionDueAt < new Date())),
                    ),
                };
                const result = order as ProcessingOrder;
                result[summaryKey] = summarizeProcessing(source);
                return result;
            }),
        );
    }
}

function notificationStatus(state: string): 'NONE' | 'QUEUED' | 'SENT' | 'FAILED' {
    if (state === 'SENT') return 'SENT';
    if (state === 'EMAIL_FAILED' || state === 'MANUAL_REVIEW') return 'FAILED';
    if (state === 'SENDING' || state === 'ALLOCATED') return 'QUEUED';
    return 'NONE';
}
