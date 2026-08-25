import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Customer,
    CustomerService,
    EntityNotFoundError,
    Order,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, LockNotSupportedOnGivenDriverError } from 'typeorm';

import {
    activeAfterSalesStates,
    afterSalesReasons,
    AfterSalesState,
    afterSalesStates,
    afterSalesTypes,
} from './after-sales.constants';
import { AfterSalesEvent } from './entities/after-sales-event.entity';
import { AfterSalesItem } from './entities/after-sales-item.entity';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { getOrderLineFulfillmentType, isAutoCardOrderLine } from './fulfillment-classification';
import {
    AfterSalesRequestListOptions,
    CreateAfterSalesRequestInput,
    TransitionAfterSalesRequestInput,
} from './types';

const ELIGIBLE_ORDER_STATES = ['PaymentSettled', 'PartiallyShipped', 'Shipped', 'Delivered'];
const DESCRIPTION_MAX_LENGTH = 2_000;
const RESOLUTION_MAX_LENGTH = 2_000;
const MAX_ITEMS_PER_REQUEST = 20;

export interface AfterSalesRequestList {
    items: AfterSalesRequest[];
    totalItems: number;
}

@Injectable()
export class AfterSalesService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
    ) {}

    async findForCustomer(ctx: RequestContext): Promise<AfterSalesRequest[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const requests = await this.connection.getRepository(ctx, AfterSalesRequest).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            relations: { items: true, events: true, order: true, refund: true },
            order: { createdAt: 'DESC', events: { createdAt: 'ASC' } },
        });
        return requests.map(request => this.normalizeRelations(request));
    }

    async findOneForCustomer(ctx: RequestContext, id: ID): Promise<AfterSalesRequest | undefined> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
            relations: { items: true, events: true, order: true, refund: true },
            order: { events: { createdAt: 'ASC' } },
        });
        return request ? this.normalizeRelations(request) : undefined;
    }

    async findForAdmin(
        ctx: RequestContext,
        options: AfterSalesRequestListOptions = {},
    ): Promise<AfterSalesRequestList> {
        const skip = this.boundedInteger(options.skip, 0, 0, 10_000);
        const take = this.boundedInteger(options.take, 20, 1, 100);
        if (options.state && !afterSalesStates.includes(options.state)) {
            throw new UserInputError('售后状态筛选条件无效');
        }
        if (options.states?.some(state => !afterSalesStates.includes(state))) {
            throw new UserInputError('售后状态筛选条件无效');
        }
        const selectedStates = options.states?.length
            ? [...new Set(options.states)]
            : options.state
              ? [options.state]
              : [];
        const [items, totalItems] = await this.connection.getRepository(ctx, AfterSalesRequest).findAndCount({
            where: {
                channelId: ctx.channelId,
                ...(selectedStates.length ? { state: In(selectedStates) } : {}),
            },
            relations: { items: true, events: true, order: true, refund: true },
            order: { createdAt: 'DESC', events: { createdAt: 'ASC' } },
            skip,
            take,
        });
        return { items: items.map(item => this.normalizeRelations(item)), totalItems };
    }

    async create(ctx: RequestContext, input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        this.validateCreateInput(input);
        await this.lockOrderForAfterSales(ctx, input.orderId);
        const order = await this.connection.getEntityOrThrow(ctx, Order, input.orderId, {
            channelId: ctx.channelId,
            relations: ['customer', 'customer.user', 'lines', 'lines.productVariant'],
        });
        if (String(order.customer?.id) !== String(customer.id)) {
            throw new UserInputError('订单不存在或当前账号无权申请售后');
        }
        if (!ELIGIBLE_ORDER_STATES.includes(order.state)) {
            throw new UserInputError('当前订单状态暂不支持申请售后');
        }

        const quantities = new Map<string, number>();
        for (const item of input.items) {
            const key = String(item.orderLineId);
            if (quantities.has(key)) {
                throw new UserInputError('同一订单商品不能重复提交');
            }
            if (!Number.isInteger(item.quantity) || item.quantity < 1) {
                throw new UserInputError('售后商品数量必须是大于 0 的整数');
            }
            quantities.set(key, item.quantity);
        }

        const selectedLines = input.items.map(item => {
            const line = order.lines.find(candidate => String(candidate.id) === String(item.orderLineId));
            if (!line) {
                throw new UserInputError('售后商品不属于当前订单');
            }
            return {
                input: item,
                line,
                fulfillmentType: getOrderLineFulfillmentType(line),
                autoCard: isAutoCardOrderLine(line),
            };
        });
        if (selectedLines.some(item => item.autoCard)) {
            throw new UserInputError('自动发卡商品不支持申请退款，发卡异常请联系客服');
        }
        if (
            input.type === 'RETURN_AND_REFUND' &&
            selectedLines.some(item => item.fulfillmentType === 'digital')
        ) {
            throw new UserInputError('数字商品只能申请仅退款');
        }

        const existingRequests = await this.connection.getRepository(ctx, AfterSalesRequest).find({
            where: { orderId: order.id, state: In(activeAfterSalesStates) },
            relations: { items: true },
        });
        const usedQuantityByLineId = new Map<string, number>();
        for (const existingRequest of existingRequests) {
            for (const item of existingRequest.items ?? []) {
                if (item.orderLineId == null) continue;
                const key = String(item.orderLineId);
                usedQuantityByLineId.set(key, (usedQuantityByLineId.get(key) ?? 0) + item.quantity);
            }
        }
        for (const { input: item, line } of selectedLines) {
            const available = line.quantity - (usedQuantityByLineId.get(String(line.id)) ?? 0);
            if (item.quantity > available) {
                throw new UserInputError(`商品“${line.productVariant.name}”可申请售后的数量不足`);
            }
        }

        const requestedAmount = selectedLines.reduce(
            (total, item) => total + item.line.proratedUnitPriceWithTax * item.input.quantity,
            0,
        );
        const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).save(
            new AfterSalesRequest({
                code: this.createRequestCode(),
                type: input.type,
                state: 'PENDING',
                reason: input.reason,
                description: input.description.trim(),
                currencyCode: order.currencyCode,
                requestedAmount,
                approvedAmount: null,
                resolution: null,
                customerName: customerName || customer.emailAddress,
                customerEmail: customer.emailAddress,
                respondedAt: null,
                completedAt: null,
                cancelledAt: null,
                refundedAt: null,
                refundId: null,
                channel: ctx.channel,
                channelId: ctx.channelId,
                customer,
                customerId: customer.id,
                order,
                orderId: order.id,
                items: [],
                events: [],
            }),
        );
        await this.connection.getRepository(ctx, AfterSalesItem).save(
            selectedLines.map(
                ({ input: item, line, fulfillmentType }) =>
                    new AfterSalesItem({
                        request,
                        requestId: request.id,
                        orderLine: line,
                        orderLineId: line.id,
                        quantity: item.quantity,
                        unitPriceWithTax: line.proratedUnitPriceWithTax,
                        lineAmountWithTax: line.proratedUnitPriceWithTax * item.quantity,
                        productName: line.productVariant.name,
                        sku: line.productVariant.sku,
                        fulfillmentType,
                    }),
            ),
        );
        await this.addEvent(
            ctx,
            request,
            'PENDING',
            'CUSTOMER',
            request.customerName,
            String(ctx.activeUserId ?? customer.id),
            request.description,
        );
        return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
    }

    async cancelForCustomer(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const request = await this.getOwnedRequestOrThrow(ctx, id, customer.id);
        if (request.state !== 'PENDING') {
            throw new UserInputError('只有待处理的售后申请可以撤销');
        }
        const result = await this.connection
            .getRepository(ctx, AfterSalesRequest)
            .update(
                { id: request.id, customerId: customer.id, state: 'PENDING' },
                { state: 'CANCELLED', cancelledAt: new Date() },
            );
        if (result.affected !== 1) {
            throw new UserInputError('售后状态已更新，请刷新后重试');
        }
        await this.addEvent(
            ctx,
            request,
            'CANCELLED',
            'CUSTOMER',
            request.customerName,
            String(ctx.activeUserId ?? customer.id),
            '客户撤销售后申请',
        );
        return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
    }

    async transitionForAdmin(
        ctx: RequestContext,
        input: TransitionAfterSalesRequestInput,
    ): Promise<AfterSalesRequest> {
        const request = await this.getRequestForAdminOrThrow(ctx, input.id);
        const resolution = input.resolution.trim();
        if (!resolution || resolution.length > RESOLUTION_MAX_LENGTH) {
            throw new UserInputError('处理说明不能为空且不能超过 2000 个字符');
        }
        const allowed =
            (request.state === 'PENDING' && ['APPROVED', 'REJECTED'].includes(input.state)) ||
            (request.state === 'APPROVED' && input.state === 'COMPLETED');
        if (!allowed) {
            throw new UserInputError(`售后申请不能从 ${request.state} 变更为 ${input.state}`);
        }

        const approvedAmount =
            input.state === 'APPROVED'
                ? (input.approvedAmount ?? request.requestedAmount)
                : input.state === 'COMPLETED'
                  ? request.approvedAmount
                  : 0;
        if (
            approvedAmount == null ||
            !Number.isInteger(approvedAmount) ||
            approvedAmount < 0 ||
            approvedAmount > request.requestedAmount
        ) {
            throw new UserInputError('通过金额必须是 0 到申请金额之间的整数金额');
        }
        let linkedRefund: Refund | null = null;
        if (input.state === 'COMPLETED' && approvedAmount > 0) {
            if (!input.refundId) {
                throw new UserInputError('尚未关联已成功的实际退款，请先选择退款记录');
            }
            linkedRefund = await this.connection.getRepository(ctx, Refund).findOne({
                where: {
                    id: input.refundId,
                    state: 'Settled',
                    payment: { order: { id: request.orderId } },
                },
                relations: { payment: { order: true } },
            });
            if (!linkedRefund) {
                throw new UserInputError('退款不存在、尚未成功或不属于当前售后订单');
            }
            if (linkedRefund.total < approvedAmount) {
                throw new UserInputError('所选成功退款金额小于售后通过金额');
            }
            const alreadyLinked = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
                where: { refundId: linkedRefund.id },
            });
            if (alreadyLinked && String(alreadyLinked.id) !== String(request.id)) {
                throw new UserInputError('这笔退款已经关联到其他售后申请');
            }
        }

        const now = new Date();
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, channelId: ctx.channelId, state: request.state },
            {
                state: input.state,
                resolution,
                approvedAmount,
                ...(request.state === 'PENDING' ? { respondedAt: now } : {}),
                ...(input.state === 'COMPLETED' ? { completedAt: now } : {}),
                ...(linkedRefund ? { refundId: linkedRefund.id, refundedAt: now } : {}),
            },
        );
        if (result.affected !== 1) {
            throw new UserInputError('售后状态已更新，请刷新后重试');
        }
        await this.addEvent(
            ctx,
            request,
            input.state,
            'ADMIN',
            'Store team',
            String(ctx.activeUserId ?? ''),
            resolution,
        );
        return this.getRequestForAdminOrThrow(ctx, request.id);
    }

    private validateCreateInput(input: CreateAfterSalesRequestInput): void {
        if (!afterSalesTypes.includes(input.type)) {
            throw new UserInputError('售后类型无效');
        }
        if (!afterSalesReasons.includes(input.reason)) {
            throw new UserInputError('售后原因无效');
        }
        const description = input.description.trim();
        if (description.length < 3 || description.length > DESCRIPTION_MAX_LENGTH) {
            throw new UserInputError('问题描述需为 3 到 2000 个字符');
        }
        if (!input.items.length || input.items.length > MAX_ITEMS_PER_REQUEST) {
            throw new UserInputError(`每次需要选择 1 到 ${MAX_ITEMS_PER_REQUEST} 种订单商品`);
        }
    }

    private async activeCustomerOrThrow(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) {
            throw new UserInputError('请先登录');
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new UserInputError('当前账号没有客户资料');
        }
        return customer;
    }

    private async lockOrderForAfterSales(ctx: RequestContext, orderId: ID): Promise<void> {
        try {
            await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder('order')
                .setLock('pessimistic_write')
                .where('order.id = :orderId', { orderId })
                .getOne();
        } catch (error) {
            if (!(error instanceof LockNotSupportedOnGivenDriverError)) {
                throw error;
            }
        }
    }

    private async getOwnedRequestOrThrow(
        ctx: RequestContext,
        id: ID,
        customerId: ID,
    ): Promise<AfterSalesRequest> {
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id, channelId: ctx.channelId, customerId },
            relations: { items: true, events: true, order: true, refund: true },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!request) {
            throw new EntityNotFoundError(AfterSalesRequest.name, id);
        }
        return this.normalizeRelations(request);
    }

    private async getRequestForAdminOrThrow(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { items: true, events: true, order: true, refund: true },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!request) {
            throw new EntityNotFoundError(AfterSalesRequest.name, id);
        }
        return this.normalizeRelations(request);
    }

    private addEvent(
        ctx: RequestContext,
        request: AfterSalesRequest,
        state: AfterSalesState,
        actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM',
        actorLabel: string,
        actorId: string | null,
        note: string,
    ): Promise<AfterSalesEvent> {
        return this.connection.getRepository(ctx, AfterSalesEvent).save(
            new AfterSalesEvent({
                request,
                requestId: request.id,
                state,
                actorType,
                actorLabel,
                actorId,
                note,
            }),
        );
    }

    private normalizeRelations(request: AfterSalesRequest): AfterSalesRequest {
        request.items = [...(request.items ?? [])].sort((left, right) => Number(left.id) - Number(right.id));
        request.events = [...(request.events ?? [])].sort(
            (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
        return request;
    }

    private createRequestCode(): string {
        return `AS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    }

    private boundedInteger(
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
}
