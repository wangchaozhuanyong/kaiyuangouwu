import { Injectable } from '@nestjs/common';
import { InventoryControlService } from '@vendure/catalog-management-plugin';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService, isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    assertOrderSalesChannel,
    Customer,
    CustomerService,
    EntityNotFoundError,
    Order,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash, randomBytes } from 'node:crypto';
import { FindOptionsWhere, In, LessThanOrEqual, Like } from 'typeorm';

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
import { getOrderLineFulfillmentType } from './fulfillment-classification';
import { orderLineProductName } from './order-line-snapshot';
import {
    AfterSalesRequestListOptions,
    ConfirmAfterSalesReplacementInput,
    CreateAfterSalesRequestInput,
    InspectAfterSalesReturnInput,
    ReceiveAfterSalesReturnInput,
    SubmitAfterSalesReturnShipmentInput,
    TransitionAfterSalesRequestInput,
    UpdateAfterSalesReplacementInput,
} from './types';

const ELIGIBLE_ORDER_STATES = [
    'PaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'PartiallyDelivered',
    'Delivered',
];
const DESCRIPTION_MAX_LENGTH = 2_000;
const RESOLUTION_MAX_LENGTH = 2_000;
const MAX_ITEMS_PER_REQUEST = 20;
const RESPONSE_SLA_HOURS = 48;
const RETURN_SHIPMENT_SLA_DAYS = 14;
const RETURN_RECEIPT_SLA_DAYS = 14;
const INSPECTION_SLA_HOURS = 48;
const SETTLEMENT_SLA_HOURS = 72;
const REPLACEMENT_DELIVERY_SLA_DAYS = 14;

export interface AfterSalesRequestList {
    items: AfterSalesRequest[];
    totalItems: number;
}

@Injectable()
export class AfterSalesService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly translations: ContentTranslationService,
        private readonly inventoryControl: InventoryControlService,
    ) {}

    async findForCustomer(ctx: RequestContext): Promise<AfterSalesRequest[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const requests = await this.connection.getRepository(ctx, AfterSalesRequest).find({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                order: { salesChannelId: ctx.channelId },
            },
            relations: { items: { returnStockLocation: true }, events: true, order: true, refund: true },
            order: { createdAt: 'DESC', id: 'DESC', events: { createdAt: 'ASC' } },
        });
        return requests.map(request => this.normalizeRelations(request, ctx));
    }

    async findOneForCustomer(ctx: RequestContext, id: ID): Promise<AfterSalesRequest | undefined> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: {
                id,
                channelId: ctx.channelId,
                customerId: customer.id,
                order: { salesChannelId: ctx.channelId },
            },
            relations: { items: { returnStockLocation: true }, events: true, order: true, refund: true },
            order: { events: { createdAt: 'ASC' } },
        });
        return request ? this.normalizeRelations(request, ctx) : undefined;
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
        const baseWhere: FindOptionsWhere<AfterSalesRequest> = {
            channelId: ctx.channelId,
            order: { salesChannelId: ctx.channelId },
            ...(selectedStates.length ? { state: In(selectedStates) } : {}),
            ...(options.exceptionsOnly
                ? {
                      state: In(selectedStates.length ? selectedStates : ['PENDING', 'APPROVED']),
                      nextActionDueAt: LessThanOrEqual(new Date()),
                  }
                : {}),
        };
        const search = options.search?.trim().slice(0, 200);
        const where: FindOptionsWhere<AfterSalesRequest> | Array<FindOptionsWhere<AfterSalesRequest>> = search
            ? [
                  { ...baseWhere, code: Like(`%${search}%`) },
                  { ...baseWhere, customerName: Like(`%${search}%`) },
                  { ...baseWhere, customerEmail: Like(`%${search}%`) },
                  { ...baseWhere, order: { salesChannelId: ctx.channelId, code: Like(`%${search}%`) } },
              ]
            : baseWhere;
        const [items, totalItems] = await this.connection.getRepository(ctx, AfterSalesRequest).findAndCount({
            where,
            relations: { items: { returnStockLocation: true }, events: true, order: true, refund: true },
            order: { createdAt: 'DESC', id: 'DESC', events: { createdAt: 'ASC' } },
            skip,
            take,
        });
        return { items: items.map(item => this.normalizeRelations(item, ctx)), totalItems };
    }

    async create(ctx: RequestContext, input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        this.validateCreateInput(input);
        await this.lockOrderForAfterSales(ctx, input.orderId);
        const order = await this.connection.getEntityOrThrow(ctx, Order, input.orderId, {
            relations: [
                'customer',
                'customer.user',
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ],
        });
        assertOrderSalesChannel(ctx, order);
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
                refundPolicy: line.customFields?.refundPolicySnapshot ?? 'MERCHANT_REVIEW',
            };
        });
        if (selectedLines.some(item => item.refundPolicy === 'NON_REFUNDABLE')) {
            throw new UserInputError('所选商品不支持自助退款；交付异常请联系客服人工处理');
        }
        if (input.type !== 'REFUND_ONLY' && selectedLines.some(item => item.fulfillmentType === 'digital')) {
            throw new UserInputError('数字商品只能申请仅退款；交付异常请使用数字发货重试流程');
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

        const requestedAmount = requiresRefund(input.type)
            ? selectedLines.reduce(
                  (total, item) => total + item.line.proratedUnitPriceWithTax * item.input.quantity,
                  0,
              )
            : 0;
        const now = new Date();
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
                resolutionZh: null,
                resolutionEn: null,
                returnStatus: 'NOT_REQUIRED',
                returnInstructions: null,
                returnCarrier: null,
                returnTrackingCode: null,
                returnShippedAt: null,
                returnReceivedAt: null,
                inspectedAt: null,
                inspectionNote: null,
                replacementStatus: 'NOT_REQUIRED',
                replacementCarrier: null,
                replacementTrackingCode: null,
                replacementProofReference: null,
                replacementException: null,
                replacementShippedAt: null,
                replacementDeliveredAt: null,
                nextActionDueAt: addHours(now, RESPONSE_SLA_HOURS),
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
                        productName: orderLineProductName(ctx, line),
                        sku: line.productVariant.sku,
                        fulfillmentType,
                        acceptedReturnQuantity: 0,
                        rejectedReturnQuantity: 0,
                        returnLotCode: null,
                        inventoryOperationId: null,
                        returnStockLocation: null,
                        returnStockLocationId: null,
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
                { state: 'CANCELLED', cancelledAt: new Date(), nextActionDueAt: null },
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
        const request = await this.lockRequestForAdmin(ctx, input.id);
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
                ? requiresRefund(request.type)
                    ? (input.approvedAmount ?? request.requestedAmount)
                    : 0
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
        const returnInstructions = input.returnInstructions?.trim().slice(0, RESOLUTION_MAX_LENGTH) || null;
        if (input.state === 'APPROVED' && requiresReturn(request.type) && !returnInstructions) {
            throw new UserInputError('退货或换货审核通过时必须填写退货说明');
        }
        if (
            input.state === 'COMPLETED' &&
            requiresReturn(request.type) &&
            request.returnStatus !== 'INSPECTED'
        ) {
            throw new UserInputError('退货尚未完成签收和质检，不能结束售后');
        }
        if (
            input.state === 'COMPLETED' &&
            requiresReplacement(request.type) &&
            request.replacementStatus !== 'DELIVERED'
        ) {
            throw new UserInputError('换货或补发尚未确认送达，不能结束售后');
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
                    payment: { order: { id: request.orderId, salesChannelId: ctx.channelId } },
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

        const prepared = await this.translations.prepareLocalizedFields([
            {
                path: 'resolution',
                sourceText: resolution,
                existingSourceText: request.resolutionZh ?? request.resolution,
                existingTargetText: request.resolutionEn,
                required: true,
            },
        ]);
        const resolutionEn = prepared[0].translatedText;

        const now = new Date();
        const approvalWorkflow =
            input.state === 'APPROVED'
                ? {
                      returnStatus: requiresReturn(request.type)
                          ? ('AWAITING_SHIPMENT' as const)
                          : request.returnStatus,
                      returnInstructions,
                      replacementStatus: requiresReplacement(request.type)
                          ? ('PENDING' as const)
                          : request.replacementStatus,
                      nextActionDueAt: requiresReturn(request.type)
                          ? addDays(now, RETURN_SHIPMENT_SLA_DAYS)
                          : addHours(now, SETTLEMENT_SLA_HOURS),
                  }
                : {};
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, channelId: ctx.channelId, state: request.state },
            {
                state: input.state,
                resolution,
                resolutionZh: resolution,
                resolutionEn,
                approvedAmount,
                ...approvalWorkflow,
                ...(request.state === 'PENDING' ? { respondedAt: now } : {}),
                ...(input.state === 'COMPLETED'
                    ? { completedAt: now, nextActionDueAt: null }
                    : input.state === 'REJECTED'
                      ? { nextActionDueAt: null }
                      : {}),
                ...(linkedRefund ? { refundId: linkedRefund.id, refundedAt: now } : {}),
            },
        );
        if (result.affected !== 1) {
            throw new UserInputError('售后状态已更新，请刷新后重试');
        }
        await this.translations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: AfterSalesRequest.name,
                entityId: request.id,
            },
            prepared,
        );
        await this.addEvent(
            ctx,
            request,
            input.state,
            'ADMIN',
            'Store team',
            String(ctx.activeUserId ?? ''),
            resolution,
            'STATE_CHANGED',
            null,
        );
        return this.getRequestForAdminOrThrow(ctx, request.id);
    }

    async submitReturnShipmentForCustomer(
        ctx: RequestContext,
        input: SubmitAfterSalesReturnShipmentInput,
    ): Promise<AfterSalesRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const request = await this.lockRequestForAdmin(ctx, input.id);
        if (String(request.customerId) !== String(customer.id)) {
            throw new UserInputError('售后申请不存在或当前账号无权操作');
        }
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (await this.eventExists(ctx, request.id, key)) {
            return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
        }
        if (request.state !== 'APPROVED' || request.returnStatus !== 'AWAITING_SHIPMENT') {
            throw new UserInputError('当前售后不在等待客户寄回状态');
        }
        const carrier = requiredText(input.carrier, 120, '退货物流公司');
        const trackingCode = requiredText(input.trackingCode, 160, '退货运单号');
        const now = new Date();
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, state: 'APPROVED', returnStatus: 'AWAITING_SHIPMENT' },
            {
                returnStatus: 'IN_TRANSIT',
                returnCarrier: carrier,
                returnTrackingCode: trackingCode,
                returnShippedAt: now,
                nextActionDueAt: addDays(now, RETURN_RECEIPT_SLA_DAYS),
            },
        );
        if (result.affected !== 1) throw new UserInputError('退货状态已更新，请刷新后重试');
        await this.addEvent(
            ctx,
            request,
            'APPROVED',
            'CUSTOMER',
            request.customerName,
            String(ctx.activeUserId ?? customer.id),
            `客户已寄回：${carrier} ${trackingCode}`,
            'RETURN_SHIPPED',
            key,
        );
        return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
    }

    async receiveReturnForAdmin(
        ctx: RequestContext,
        input: ReceiveAfterSalesReturnInput,
    ): Promise<AfterSalesRequest> {
        const request = await this.lockRequestForAdmin(ctx, input.id);
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (await this.eventExists(ctx, request.id, key)) return request;
        if (
            request.state !== 'APPROVED' ||
            !['AWAITING_SHIPMENT', 'IN_TRANSIT'].includes(request.returnStatus)
        ) {
            throw new UserInputError('当前售后不在可签收退货的状态');
        }
        const note = requiredText(input.note, RESOLUTION_MAX_LENGTH, '签收说明');
        const now = new Date();
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, state: 'APPROVED', returnStatus: request.returnStatus },
            {
                returnStatus: 'RECEIVED',
                returnReceivedAt: now,
                nextActionDueAt: addHours(now, INSPECTION_SLA_HOURS),
            },
        );
        if (result.affected !== 1) throw new UserInputError('退货状态已更新，请刷新后重试');
        await this.addEvent(
            ctx,
            request,
            'APPROVED',
            'ADMIN',
            'Store team',
            String(ctx.activeUserId ?? ''),
            note,
            'RETURN_RECEIVED',
            key,
        );
        return this.getRequestForAdminOrThrow(ctx, request.id);
    }

    async inspectReturnForAdmin(
        ctx: RequestContext,
        input: InspectAfterSalesReturnInput,
    ): Promise<AfterSalesRequest> {
        const request = await this.lockRequestForAdmin(ctx, input.id);
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (await this.eventExists(ctx, request.id, key)) return request;
        if (request.state !== 'APPROVED' || request.returnStatus !== 'RECEIVED') {
            throw new UserInputError('退货尚未签收或已经完成质检');
        }
        const note = requiredText(input.note, RESOLUTION_MAX_LENGTH, '质检说明');
        if (input.items.length !== request.items.length) {
            throw new UserInputError('质检必须覆盖售后申请中的全部商品');
        }
        const submitted = new Map(input.items.map(item => [String(item.itemId), item]));
        if (submitted.size !== input.items.length) throw new UserInputError('同一售后商品不能重复质检');
        const inventoryLines = new Map<
            string,
            {
                productVariantId: ID;
                stockLocationId: ID;
                lotCode: string;
                quantity: number;
                currencyCode: AfterSalesRequest['currencyCode'];
                purchaseCostMicrounits: null;
            }
        >();
        const plans: Array<{
            item: AfterSalesItem;
            acceptedQuantity: number;
            rejectedQuantity: number;
            stockLocationId: ID | null;
            lotCode: string | null;
        }> = [];
        for (const item of request.items) {
            const inspection = submitted.get(String(item.id));
            if (!inspection) throw new UserInputError('质检商品与售后申请不一致');
            if (
                !Number.isSafeInteger(inspection.acceptedQuantity) ||
                !Number.isSafeInteger(inspection.rejectedQuantity) ||
                inspection.acceptedQuantity < 0 ||
                inspection.rejectedQuantity < 0 ||
                inspection.acceptedQuantity + inspection.rejectedQuantity !== item.quantity
            ) {
                throw new UserInputError(`商品 ${item.productName} 的验收与拒收数量必须等于退货数量`);
            }
            let stockLocationId: ID | null = null;
            let lotCode: string | null = null;
            if (inspection.acceptedQuantity > 0) {
                stockLocationId = inspection.stockLocationId ?? null;
                lotCode = inspection.lotCode?.trim().slice(0, 80) || null;
                const variantId = item.orderLine?.productVariantId;
                if (!variantId || !stockLocationId || !lotCode) {
                    throw new UserInputError(`商品 ${item.productName} 重新入库时必须选择仓库并填写批次号`);
                }
                const scope = `${String(variantId)}:${String(stockLocationId)}:${lotCode}`;
                const existing = inventoryLines.get(scope);
                if (existing) existing.quantity += inspection.acceptedQuantity;
                else {
                    inventoryLines.set(scope, {
                        productVariantId: variantId,
                        stockLocationId,
                        lotCode,
                        quantity: inspection.acceptedQuantity,
                        currencyCode: request.currencyCode,
                        purchaseCostMicrounits: null,
                    });
                }
            }
            plans.push({
                item,
                acceptedQuantity: inspection.acceptedQuantity,
                rejectedQuantity: inspection.rejectedQuantity,
                stockLocationId,
                lotCode,
            });
        }
        const inventoryOperation = inventoryLines.size
            ? await this.inventoryControl.receiveCustomerReturn(ctx, {
                  idempotencyKey: inventoryIdempotencyKey(request.id, key),
                  reason: note,
                  reference: request.code,
                  lines: [...inventoryLines.values()],
              })
            : null;
        for (const plan of plans) {
            await this.connection.getRepository(ctx, AfterSalesItem).update(
                { id: plan.item.id, requestId: request.id },
                {
                    acceptedReturnQuantity: plan.acceptedQuantity,
                    rejectedReturnQuantity: plan.rejectedQuantity,
                    returnStockLocationId: plan.stockLocationId,
                    returnLotCode: plan.lotCode,
                    inventoryOperationId: inventoryOperation ? String(inventoryOperation.id) : null,
                },
            );
        }
        const now = new Date();
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, state: 'APPROVED', returnStatus: 'RECEIVED' },
            {
                returnStatus: 'INSPECTED',
                inspectedAt: now,
                inspectionNote: note,
                nextActionDueAt: addHours(now, SETTLEMENT_SLA_HOURS),
            },
        );
        if (result.affected !== 1) throw new UserInputError('退货状态已更新，请刷新后重试');
        await this.addEvent(
            ctx,
            request,
            'APPROVED',
            'ADMIN',
            'Store team',
            String(ctx.activeUserId ?? ''),
            note,
            'RETURN_INSPECTED',
            key,
        );
        return this.getRequestForAdminOrThrow(ctx, request.id);
    }

    async updateReplacementForAdmin(
        ctx: RequestContext,
        input: UpdateAfterSalesReplacementInput,
    ): Promise<AfterSalesRequest> {
        const request = await this.lockRequestForAdmin(ctx, input.id);
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (await this.eventExists(ctx, request.id, key)) return request;
        if (request.state !== 'APPROVED' || !requiresReplacement(request.type)) {
            throw new UserInputError('当前售后不需要换货或补发');
        }
        if (request.type === 'EXCHANGE' && request.returnStatus !== 'INSPECTED') {
            throw new UserInputError('换货必须先完成退货签收和质检');
        }
        const note = requiredText(input.note, RESOLUTION_MAX_LENGTH, '处理说明');
        const now = new Date();
        const patch: Partial<AfterSalesRequest> = { replacementStatus: input.status };
        let eventType: string;
        if (input.status === 'SHIPPED') {
            if (!['PENDING', 'EXCEPTION'].includes(request.replacementStatus)) {
                throw new UserInputError('当前换货或补发状态不能登记发货');
            }
            patch.replacementCarrier = requiredText(input.carrier, 120, '承运商');
            patch.replacementTrackingCode = requiredText(input.trackingCode, 160, '运单号');
            patch.replacementShippedAt = now;
            patch.replacementException = null;
            patch.nextActionDueAt = addDays(now, REPLACEMENT_DELIVERY_SLA_DAYS);
            eventType = 'REPLACEMENT_SHIPPED';
        } else if (input.status === 'EXCEPTION') {
            if (request.replacementStatus !== 'SHIPPED') {
                throw new UserInputError('只有运输中的换货或补发可以登记异常');
            }
            patch.replacementException = note;
            patch.nextActionDueAt = now;
            eventType = 'REPLACEMENT_EXCEPTION';
        } else {
            if (!['SHIPPED', 'EXCEPTION'].includes(request.replacementStatus)) {
                throw new UserInputError('换货或补发尚未发出，不能确认送达');
            }
            patch.replacementProofReference = requiredText(input.proofReference, 255, '送达凭证');
            patch.replacementDeliveredAt = now;
            patch.replacementException = null;
            patch.nextActionDueAt = addHours(now, RESPONSE_SLA_HOURS);
            eventType = 'REPLACEMENT_DELIVERED';
        }
        const result = await this.connection
            .getRepository(ctx, AfterSalesRequest)
            .update(
                { id: request.id, state: 'APPROVED', replacementStatus: request.replacementStatus },
                patch,
            );
        if (result.affected !== 1) throw new UserInputError('换货或补发状态已更新，请刷新后重试');
        await this.addEvent(
            ctx,
            request,
            'APPROVED',
            'ADMIN',
            'Store team',
            String(ctx.activeUserId ?? ''),
            note,
            eventType,
            key,
        );
        return this.getRequestForAdminOrThrow(ctx, request.id);
    }

    async confirmReplacementForCustomer(
        ctx: RequestContext,
        input: ConfirmAfterSalesReplacementInput,
    ): Promise<AfterSalesRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const request = await this.lockRequestForAdmin(ctx, input.id);
        if (String(request.customerId) !== String(customer.id)) {
            throw new UserInputError('售后申请不存在或当前账号无权操作');
        }
        const key = requiredText(input.idempotencyKey, 80, '幂等键');
        if (await this.eventExists(ctx, request.id, key)) {
            return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
        }
        if (request.state !== 'APPROVED' || !['SHIPPED', 'EXCEPTION'].includes(request.replacementStatus)) {
            throw new UserInputError('当前换货或补发不能确认送达');
        }
        const now = new Date();
        const result = await this.connection.getRepository(ctx, AfterSalesRequest).update(
            { id: request.id, state: 'APPROVED', replacementStatus: request.replacementStatus },
            {
                replacementStatus: 'DELIVERED',
                replacementProofReference: 'CUSTOMER_CONFIRMED',
                replacementDeliveredAt: now,
                replacementException: null,
                nextActionDueAt: addHours(now, RESPONSE_SLA_HOURS),
            },
        );
        if (result.affected !== 1) throw new UserInputError('换货或补发状态已更新，请刷新后重试');
        await this.addEvent(
            ctx,
            request,
            'APPROVED',
            'CUSTOMER',
            request.customerName,
            String(ctx.activeUserId ?? customer.id),
            '客户确认换货或补发已送达',
            'REPLACEMENT_DELIVERED',
            key,
        );
        return this.getOwnedRequestOrThrow(ctx, request.id, customer.id);
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
        const repository = this.connection.getRepository(ctx, Order);
        if (['sqlite', 'better-sqlite3', 'sqljs'].includes(this.connection.rawConnection.options.type)) {
            // SQLite has no SELECT FOR UPDATE. Acquire its transaction write lock
            // before checking existing requests, without changing business fields.
            await repository.update({ id: orderId }, { id: orderId });
            return;
        }
        await repository
            .createQueryBuilder('order')
            .setLock('pessimistic_write')
            .where('order.id = :orderId', { orderId })
            .getOne();
    }

    private async getOwnedRequestOrThrow(
        ctx: RequestContext,
        id: ID,
        customerId: ID,
    ): Promise<AfterSalesRequest> {
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id, channelId: ctx.channelId, customerId },
            relations: { items: { returnStockLocation: true }, events: true, order: true, refund: true },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!request) {
            throw new EntityNotFoundError(AfterSalesRequest.name, id);
        }
        assertOrderSalesChannel(ctx, request.order);
        return this.normalizeRelations(request, ctx);
    }

    private async lockRequestForAdmin(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const repository = this.connection.getRepository(ctx, AfterSalesRequest);
        const databaseType = String(this.connection.rawConnection.options.type);
        if (['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType)) {
            const result = await repository.update({ id, channelId: ctx.channelId }, { id });
            if (result.affected !== 1) throw new EntityNotFoundError(AfterSalesRequest.name, id);
        } else {
            const locked = await repository
                .createQueryBuilder('request')
                .setLock('pessimistic_write')
                .where('request.id = :id', { id })
                .andWhere('request.channelId = :channelId', { channelId: ctx.channelId })
                .getOne();
            if (!locked) throw new EntityNotFoundError(AfterSalesRequest.name, id);
        }
        return this.getRequestForAdminOrThrow(ctx, id);
    }

    private async getRequestForAdminOrThrow(ctx: RequestContext, id: ID): Promise<AfterSalesRequest> {
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: { id, channelId: ctx.channelId },
            relations: {
                items: { orderLine: { productVariant: true }, returnStockLocation: true },
                events: true,
                order: true,
                refund: true,
            },
            order: { events: { createdAt: 'ASC' } },
        });
        if (!request) {
            throw new EntityNotFoundError(AfterSalesRequest.name, id);
        }
        assertOrderSalesChannel(ctx, request.order);
        return this.normalizeRelations(request, ctx);
    }

    private async eventExists(ctx: RequestContext, requestId: ID, idempotencyKey: string): Promise<boolean> {
        return this.connection.getRepository(ctx, AfterSalesEvent).exists({
            where: { requestId, idempotencyKey },
        });
    }

    private addEvent(
        ctx: RequestContext,
        request: AfterSalesRequest,
        state: AfterSalesState,
        actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM',
        actorLabel: string,
        actorId: string | null,
        note: string,
        eventType = 'STATE_CHANGED',
        idempotencyKey: string | null = null,
    ): Promise<AfterSalesEvent> {
        return this.connection.getRepository(ctx, AfterSalesEvent).save(
            new AfterSalesEvent({
                request,
                requestId: request.id,
                state,
                eventType,
                idempotencyKey,
                actorType,
                actorLabel,
                actorId,
                note,
            }),
        );
    }

    private normalizeRelations(request: AfterSalesRequest, ctx: RequestContext): AfterSalesRequest {
        request.items = [...(request.items ?? [])].sort((left, right) => Number(left.id) - Number(right.id));
        request.events = [...(request.events ?? [])].sort(
            (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
        const isChinese = String(ctx.languageCode).toLowerCase().startsWith('zh');
        request.resolution = isChinese
            ? request.resolutionZh || request.resolutionEn || request.resolution
            : isUsableEnglishTranslation(request.resolutionEn)
              ? request.resolutionEn
              : null;
        request.overdue =
            request.nextActionDueAt != null &&
            request.nextActionDueAt.getTime() <= Date.now() &&
            !['REJECTED', 'CANCELLED', 'COMPLETED'].includes(request.state);
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

function requiresRefund(type: AfterSalesRequest['type']): boolean {
    return type === 'REFUND_ONLY' || type === 'RETURN_AND_REFUND';
}

function requiresReturn(type: AfterSalesRequest['type']): boolean {
    return type === 'RETURN_AND_REFUND' || type === 'EXCHANGE';
}

function requiresReplacement(type: AfterSalesRequest['type']): boolean {
    return type === 'EXCHANGE' || type === 'RESHIP';
}

function requiredText(value: unknown, max: number, label: string): string {
    if (typeof value !== 'string') throw new UserInputError(`${label}不能为空`);
    const text = value.trim();
    if (!text || text.length > max) throw new UserInputError(`${label}不能为空且不能超过 ${max} 个字符`);
    return text;
}

function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1_000);
}

function addDays(date: Date, days: number): Date {
    return addHours(date, days * 24);
}

function inventoryIdempotencyKey(requestId: ID, key: string): string {
    return `ASR-${createHash('sha256')
        .update(`${String(requestId)}:${key}`)
        .digest('hex')
        .slice(0, 64)}`;
}
