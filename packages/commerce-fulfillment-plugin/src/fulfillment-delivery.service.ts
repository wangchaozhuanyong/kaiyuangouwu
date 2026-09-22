import { Injectable } from '@nestjs/common';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    CustomerService,
    EntityNotFoundError,
    EventBus,
    Fulfillment,
    FulfillmentService,
    Order,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { LessThanOrEqual } from 'typeorm';

import { FulfillmentDeliveryEvent } from './entities/fulfillment-delivery-event.entity';
import {
    FulfillmentDeliveryRecord,
    type FulfillmentDeliveryStatus,
} from './entities/fulfillment-delivery-record.entity';
import {
    ConfirmFulfillmentDeliveryInput,
    FulfillmentDeliveryListOptions,
    UpdateFulfillmentDeliveryInput,
} from './types';

const DELIVERY_SLA_DAYS = 14;
const NOTE_MAX_LENGTH = 2_000;

@Injectable()
export class FulfillmentDeliveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly fulfillmentService: FulfillmentService,
        private readonly customerService: CustomerService,
        private readonly requestContextService: RequestContextService,
        private readonly eventBus: EventBus,
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

    async guardDeliveredTransition(
        ctx: RequestContext,
        fulfillment: Fulfillment,
        orders: Order[],
    ): Promise<string | void> {
        if (!isPhysicalFulfillment(fulfillment, orders)) return;
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
