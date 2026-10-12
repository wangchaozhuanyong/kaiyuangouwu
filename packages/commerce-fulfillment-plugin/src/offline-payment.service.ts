import { Injectable } from '@nestjs/common';
import { isConfirmedControlledTestPayment } from '@vendure/common/lib/controlled-test-payment';
import {
    Channel,
    ID,
    Order,
    OrderService,
    Payment,
    PaymentMethodService,
    Permission,
    RequestContext,
    Sale,
    TransactionalConnection,
    UserInputError,
    assertOrderSalesChannel,
    isGraphQlErrorResult,
} from '@vendure/core';
import {
    createOfflinePaymentProof,
    sensitiveStoreFinancePermission,
    verifyOfflinePaymentProof,
} from '@vendure/store-management-plugin';
import { createHash } from 'node:crypto';

import { CheckoutResourcesService } from './checkout-resources.service';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { DigitalReceiptAccess } from './entities/digital-product.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { OFFLINE_MANUAL_HANDLER } from './offline-manual-payment';

export interface ConfirmOfflinePaymentInput {
    paymentId: ID;
    expectedAmount: number;
    transactionId: string;
    evidenceReference: string;
    receivedAt: string;
    idempotencyKey: string;
    note?: string;
}
interface RecoveryRecord {
    draftOrderId: string;
    idempotencyKey: string;
    stage: 'DRAFT' | 'SUBMITTED';
    createdBy: string;
    createdAt: string;
    quoteHash: string;
    changes: string[];
    submittedKey?: string;
}
const relations = [
    'customer',
    'customer.user',
    'lines',
    'lines.productVariant',
    'payments',
    'payments.refunds',
    'fulfillments',
    'shippingLines',
    'shippingLines.shippingMethod',
    'surcharges',
] as const;

@Injectable()
export class OfflinePaymentService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orders: OrderService,
        private readonly resources: CheckoutResourcesService,
        private readonly methods: PaymentMethodService,
    ) {}

    private assertAdmin(ctx: RequestContext, creating = false) {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            !ctx.userHasPermissions([Permission.UpdateOrder]) ||
            !ctx.userHasPermissions([sensitiveStoreFinancePermission.Permission]) ||
            (creating && !ctx.userHasPermissions([Permission.CreateOrder]))
        )
            throw new UserInputError('当前岗位没有订单核款或历史恢复权限');
    }

    async confirm(ctx: RequestContext, input: ConfirmOfflinePaymentInput): Promise<Payment> {
        this.assertAdmin(ctx);
        const transactionId = bounded(input.transactionId, 180, '实际交易号');
        const evidenceReference = bounded(input.evidenceReference, 1000, '到账凭证');
        const idempotencyKey = bounded(input.idempotencyKey, 128, '请求编号');
        const receivedAt = Date.parse(input.receivedAt);
        if (
            !Number.isSafeInteger(input.expectedAmount) ||
            input.expectedAmount < 0 ||
            !Number.isSafeInteger(receivedAt) ||
            receivedAt <= 0 ||
            receivedAt > Date.now()
        )
            throw new UserInputError('到账时间或核款金额无效');
        return this.orders.withOrderMutationTransaction(ctx, async tx => {
            const observed = await this.connection
                .getRepository(tx, Payment)
                .findOne({ where: { id: input.paymentId }, relations: ['order'] });
            if (!observed) throw new UserInputError('待核款支付不存在');
            assertOrderSalesChannel(tx, observed.order);
            await this.orders.lockOrderForRefund(tx, observed.order.id);
            const payment = await this.connection
                .getRepository(tx, Payment)
                .findOneOrFail({ where: { id: input.paymentId }, relations: ['order'] });
            const order = await this.orders.findOne(tx, payment.order.id, [...relations], 'business');
            if (!order || payment.metadata?.offlineManual?.kind !== 'OFFLINE_MANUAL')
                throw new UserInputError('该付款不是客服核款支付');
            // Serialize same-shop receipt references; two orders must not spend the same bank receipt.
            await this.connection
                .getRepository(tx, Channel)
                .createQueryBuilder()
                .update()
                .set({ updatedAt: () => 'updatedAt' })
                .where('id = :id', { id: tx.channelId })
                .execute();
            const duplicate = await this.connection
                .getRepository(tx, Payment)
                .createQueryBuilder('receipt')
                .innerJoin('receipt.order', 'receiptOrder')
                .where('receipt.transactionId = :transactionId', { transactionId })
                .andWhere('receiptOrder.salesChannelId = :channelId', { channelId: tx.channelId })
                .andWhere('receipt.id != :paymentId', { paymentId: payment.id })
                .getMany();
            if (duplicate.some(item => item.metadata?.offlineManual?.receiptProof))
                throw new UserInputError('该实际交易号已登记在另一笔订单，请先核对原收款');
            const recorded = payment.metadata?.offlineManual?.confirmation;
            if (recorded?.idempotencyKey) {
                if (
                    recorded.idempotencyKey !== idempotencyKey ||
                    recorded.transactionId !== transactionId ||
                    recorded.evidenceReference !== evidenceReference ||
                    recorded.receivedAt !== receivedAt ||
                    payment.amount !== input.expectedAmount
                )
                    throw new UserInputError('此笔核款已登记其他凭证，请核对原记录，勿重复确认');
                if (payment.state === 'Settled' || payment.state === 'Error') return payment;
            }
            if (
                payment.state !== 'PendingManual' ||
                order.state !== 'AwaitingManualPayment' ||
                order.active ||
                !order.orderPlacedAt ||
                payment.amount !== input.expectedAmount ||
                payment.amount !==
                    order.totalWithTax -
                        order.payments
                            .filter(p => p.state === 'Settled')
                            .reduce((sum, p) => sum + p.amount, 0)
            )
                throw new UserInputError('订单、应付金额或核款状态已变化，请刷新核对');
            const receipt = {
                channelId: String(tx.channelId),
                orderId: String(order.id),
                paymentId: String(payment.id),
                amount: payment.amount,
                currencyCode: order.currencyCode,
                transactionId,
                evidenceReference,
                receivedAt,
                verifiedBy: String(tx.activeUserId),
                idempotencyKey,
            };
            payment.transactionId = transactionId;
            payment.metadata = {
                ...payment.metadata,
                offlineManual: {
                    ...payment.metadata.offlineManual,
                    confirmation: {
                        ...receipt,
                        note: input.note?.trim().slice(0, 1000) ?? '',
                        verifiedAt: new Date().toISOString(),
                    },
                    receiptProof: createOfflinePaymentProof(receipt),
                },
            };
            await this.connection.getRepository(tx, Payment).save(payment);
            await this.resources.prepareManualReceiptResources(tx, order);
            const settled = await this.orders.settlePayment(tx, payment.id);
            if (isGraphQlErrorResult(settled)) {
                const reviewed = await this.connection
                    .getRepository(tx, Payment)
                    .findOneOrFail({ where: { id: payment.id } });
                if (reviewed.metadata?.manualReview?.receivedState === 'Settled') return reviewed;
                throw new UserInputError(settled.message);
            }
            await this.orders.addNoteToOrder(tx, {
                id: order.id,
                note: `客服核款：${transactionId}；实际到账时间 ${new Date(receivedAt).toISOString()}`,
                isPublic: false,
            });
            return settled;
        });
    }

    async retryReview(ctx: RequestContext, paymentId: ID): Promise<Payment> {
        this.assertAdmin(ctx);
        return this.orders.withOrderMutationTransaction(ctx, async tx => {
            const payment = await this.connection
                .getRepository(tx, Payment)
                .findOneOrFail({ where: { id: paymentId }, relations: ['order'] });
            assertOrderSalesChannel(tx, payment.order);
            await this.orders.lockOrderForRefund(tx, payment.order.id);
            const fresh = await this.connection
                .getRepository(tx, Payment)
                .findOneOrFail({ where: { id: paymentId }, relations: ['order'] });
            if (fresh.state === 'Settled') return fresh;
            const proof = verifyOfflinePaymentProof(fresh.metadata?.offlineManual?.receiptProof);
            if (
                fresh.state !== 'Error' ||
                fresh.metadata?.manualReview?.receivedState !== 'Settled' ||
                !proof ||
                proof.purpose === 'REFUND_ONLY' ||
                proof.paymentId !== String(fresh.id) ||
                proof.orderId !== String(fresh.order.id) ||
                proof.channelId !== String(tx.channelId) ||
                proof.amount !== fresh.amount ||
                proof.transactionId !== fresh.transactionId
            )
                throw new UserInputError('该付款没有可重核的真实收款证据');
            const order = await this.orders.findOne(tx, fresh.order.id, [...relations], 'business');
            if (!order || order.state !== 'AwaitingManualPayment')
                throw new UserInputError('订单状态已变化，请人工核对');
            fresh.metadata = {
                ...fresh.metadata,
                manualReview: {
                    ...fresh.metadata.manualReview,
                    required: false,
                    retriedAt: new Date().toISOString(),
                    retriedBy: String(tx.activeUserId),
                },
            };
            await this.connection.getRepository(tx, Payment).save(fresh);
            await this.resources.prepareManualReceiptResources(tx, order);
            const result = await this.orders.settlePayment(tx, fresh.id);
            if (isGraphQlErrorResult(result)) {
                const reviewed = await this.connection
                    .getRepository(tx, Payment)
                    .findOneOrFail({ where: { id: fresh.id } });
                if (reviewed.metadata?.manualReview?.receivedState === 'Settled') return reviewed;
                throw new UserInputError(result.message);
            }
            await this.orders.addNoteToOrder(tx, {
                id: order.id,
                note: '已按原实际收款证据重核业务校验',
                isPublic: false,
            });
            return result;
        });
    }

    /** An already-received payment may be made refundable without approving its business quote. */
    async prepareRefund(ctx: RequestContext, paymentId: ID): Promise<Payment> {
        this.assertAdmin(ctx);
        return this.orders.withOrderMutationTransaction(ctx, async tx => {
            const observed = await this.connection
                .getRepository(tx, Payment)
                .findOneOrFail({ where: { id: paymentId }, relations: ['order'] });
            assertOrderSalesChannel(tx, observed.order);
            await this.orders.lockOrderForRefund(tx, observed.order.id);
            const payment = await this.connection
                .getRepository(tx, Payment)
                .findOneOrFail({ where: { id: paymentId }, relations: ['order'] });
            const proof = verifyOfflinePaymentProof(payment.metadata?.offlineManual?.receiptProof);
            if (
                !proof ||
                proof.orderId !== String(payment.order.id) ||
                proof.paymentId !== String(payment.id) ||
                proof.channelId !== String(tx.channelId) ||
                proof.amount !== payment.amount ||
                proof.transactionId !== payment.transactionId ||
                payment.order.state !== 'AwaitingManualPayment' ||
                payment.metadata?.manualReview?.receivedState !== 'Settled'
            )
                throw new UserInputError('该付款没有可用于退款的受核验实际收款证据');
            if (payment.state === 'Settled' && proof.purpose === 'REFUND_ONLY') return payment;
            if (payment.state !== 'Error') throw new UserInputError('请核对原收款状态后处理退款');
            payment.metadata = {
                ...payment.metadata,
                offlineManual: {
                    ...payment.metadata.offlineManual,
                    receiptProof: createOfflinePaymentProof({ ...proof, purpose: 'REFUND_ONLY' }),
                    refundOnly: { preparedAt: new Date().toISOString(), preparedBy: String(tx.activeUserId) },
                },
                manualReview: { ...payment.metadata.manualReview, required: true },
            };
            await this.connection.getRepository(tx, Payment).save(payment);
            const result = await this.orders.settlePayment(tx, payment.id);
            if (isGraphQlErrorResult(result)) throw new UserInputError(result.message);
            await this.orders.addNoteToOrder(tx, {
                id: payment.order.id,
                note: '原实际收款转入退款专用处理；业务报价未通过，不允许履约或产生返利',
                isPublic: false,
            });
            return result;
        });
    }

    async recovery(ctx: RequestContext, sourceOrderId: ID) {
        const source = await this.orders.findOne(ctx, sourceOrderId, [...relations], 'business');
        if (!source) throw new UserInputError('历史订单不存在或不属于当前店铺');
        const payment = source.payments.find(isConfirmedControlledTestPayment);
        const record = payment?.metadata?.offlineRecovery as RecoveryRecord | undefined;
        const draft =
            record && (await this.orders.findOne(ctx, record.draftOrderId, [...relations], 'business'));
        const blockedReason = await this.legacyBlockedReason(ctx, source);
        return {
            sourceOrderId: String(source.id),
            sourceOrderCode: source.code,
            draftOrderId: draft ? String(draft.id) : null,
            draftOrderCode: draft?.code ?? null,
            stage: record?.stage ?? 'NOT_PREPARED',
            quoteHash: draft ? quoteHash(draft) : null,
            originalTotal: source.totalWithTax,
            quotedTotal: draft?.totalWithTax ?? null,
            currencyCode: source.currencyCode,
            changes: draft ? quoteChanges(source, draft, record?.changes ?? []) : [],
            blockedReason,
        };
    }

    async prepare(ctx: RequestContext, input: { sourceOrderId: ID; idempotencyKey: string }) {
        this.assertAdmin(ctx, true);
        bounded(input.idempotencyKey, 128, '请求编号');
        return this.orders.withOrderMutationTransaction(ctx, async tx => {
            await this.orders.lockOrderForRefund(tx, input.sourceOrderId);
            const source = await this.orders.findOne(tx, input.sourceOrderId, [...relations], 'business');
            if (!source) throw new UserInputError('历史订单不存在');
            const reason = await this.legacyBlockedReason(tx, source);
            if (reason) throw new UserInputError(reason);
            const payment = source.payments.find(isConfirmedControlledTestPayment);
            if (!payment) throw new UserInputError('历史订单缺少可核对的模拟付款证据');
            if (payment.metadata?.offlineRecovery) return this.recovery(tx, source.id);
            const draftCtx = tx.copy({ currencyCode: source.currencyCode });
            const draft = await this.orders.createDraft(draftCtx);
            if (!source.customer) throw new UserInputError('历史订单缺少客户归属，请先人工核对');
            check(await this.orders.addCustomerToOrder(draftCtx, draft.id, source.customer));
            const added = await this.orders.addItemsToOrder(
                draftCtx,
                draft.id,
                source.lines.map(line => ({
                    productVariantId: line.productVariantId,
                    quantity: line.quantity,
                })),
            );
            if (
                added.errorResults.length ||
                added.order.lines.reduce((sum, line) => sum + line.quantity, 0) !==
                    source.lines.reduce((sum, line) => sum + line.quantity, 0)
            )
                throw new UserInputError('商品已停用或库存不足，不能按原数量恢复，请先补货或人工核对');
            const changes: string[] = [];
            if (source.shippingAddress?.countryCode)
                await this.orders.setShippingAddress(
                    draftCtx,
                    draft.id,
                    addressInput(source.shippingAddress),
                );
            if (source.billingAddress?.countryCode)
                check(
                    await this.orders.setBillingAddress(
                        draftCtx,
                        draft.id,
                        addressInput(source.billingAddress),
                    ),
                );
            if (source.customFields?.deliveryEmail)
                await this.orders.updateCustomFields(draftCtx, draft.id, {
                    deliveryEmail: source.customFields.deliveryEmail,
                    customerNote: (source.customFields as { customerNote?: string }).customerNote ?? '',
                });
            const shipping = await this.orders.getEligibleShippingMethods(draftCtx, draft.id);
            const previous = source.shippingLines[0]?.shippingMethodId;
            const selected = shipping.find(method => String(method.id) === String(previous)) ?? shipping[0];
            if (selected) {
                check(await this.orders.setShippingMethod(draftCtx, draft.id, [selected.id]));
                if (previous && String(previous) !== String(selected.id))
                    changes.push('原配送方式不可用，已按当前可用配送重新报价');
            }
            for (const code of source.couponCodes) {
                const applied = await this.orders.applyCouponCode(draftCtx, draft.id, code);
                if (isGraphQlErrorResult(applied))
                    changes.push(`原优惠码 ${code} 已不可用，正式单不沿用该优惠`);
            }
            const priced = await this.orders.findOne(draftCtx, draft.id, [...relations], 'business');
            if (!priced) throw new UserInputError('关联草稿不可读取，请核对当前店铺');
            const record: RecoveryRecord = {
                draftOrderId: String(draft.id),
                idempotencyKey: input.idempotencyKey,
                stage: 'DRAFT',
                createdBy: String(tx.activeUserId),
                createdAt: new Date().toISOString(),
                quoteHash: quoteHash(priced),
                changes,
            };
            payment.metadata = { ...payment.metadata, offlineRecovery: record };
            await this.connection.getRepository(tx, Payment).save(payment);
            await this.orders.addNoteToOrder(tx, {
                id: draft.id,
                note: `由历史模拟订单 ${source.code} 准备；等待确认当前报价与客服核款`,
                isPublic: false,
            });
            return this.recovery(tx, source.id);
        });
    }

    async submit(
        ctx: RequestContext,
        input: { sourceOrderId: ID; quoteHash: string; method: string; idempotencyKey: string },
    ) {
        this.assertAdmin(ctx, true);
        bounded(input.idempotencyKey, 128, '请求编号');
        return this.orders.withOrderMutationTransaction(ctx, async tx => {
            await this.orders.lockOrderForRefund(tx, input.sourceOrderId);
            const source = await this.orders.findOne(tx, input.sourceOrderId, [...relations], 'business');
            if (!source) throw new UserInputError('历史订单不存在');
            const reason = await this.legacyBlockedReason(tx, source);
            if (reason) throw new UserInputError(reason);
            const payment = source.payments.find(isConfirmedControlledTestPayment);
            if (!payment) throw new UserInputError('历史订单缺少可核对的模拟付款证据');
            const record = payment.metadata?.offlineRecovery as RecoveryRecord | undefined;
            if (!record) throw new UserInputError('请先准备并核对关联草稿');
            if (record.stage === 'SUBMITTED') return this.recovery(tx, source.id);
            await this.orders.lockOrderForRefund(tx, record.draftOrderId);
            const draftCtx = tx.copy({ currencyCode: source.currencyCode });
            let draft = await this.orders.findOne(draftCtx, record.draftOrderId, [...relations], 'business');
            if (!draft || draft.state !== 'Draft') throw new UserInputError('关联草稿状态已变化，请人工核对');
            draft = await this.orders.applyPriceAdjustments(draftCtx, draft, draft.lines);
            if (quoteHash(draft) !== input.quoteHash) return this.recovery(tx, source.id);
            const method = (await this.methods.getActivePaymentMethods(draftCtx)).find(
                candidate => candidate.code === input.method,
            );
            if (!method?.enabled || method.handler.code !== OFFLINE_MANUAL_HANDLER)
                throw new UserInputError('请选择本店已启用的客服核款方式');
            check(await this.orders.transitionToState(draftCtx, draft.id, 'ArrangingPayment'));
            const placed = check(
                await this.orders.addPaymentToOrder(draftCtx, draft.id, {
                    method: method.code,
                    metadata: {},
                }),
            );
            if (placed.state !== 'AwaitingManualPayment') throw new UserInputError('正式待核款订单未建立');
            const pending = (await this.orders.getOrderPayments(tx, draft.id)).find(
                p => p.state === 'PendingManual',
            );
            if (!pending) throw new UserInputError('正式单缺少待核款记录');
            pending.metadata = {
                ...pending.metadata,
                offlineRecoverySource: { orderId: String(source.id), orderCode: source.code },
            };
            await this.connection.getRepository(tx, Payment).save(pending);
            payment.metadata = {
                ...payment.metadata,
                offlineRecovery: {
                    ...record,
                    stage: 'SUBMITTED',
                    submittedKey: input.idempotencyKey,
                    quoteHash: input.quoteHash,
                },
            };
            await this.connection.getRepository(tx, Payment).save(payment);
            await this.orders.addNoteToOrder(tx, {
                id: source.id,
                note: `已关联正式待核款订单 ${placed.code}；原模拟付款证据保留`,
                isPublic: false,
            });
            return this.recovery(tx, source.id);
        });
    }

    private async legacyBlockedReason(ctx: RequestContext, source: Order): Promise<string | null> {
        assertOrderSalesChannel(ctx, source);
        if (
            source.active ||
            !source.payments.length ||
            !source.payments.every(
                payment =>
                    isConfirmedControlledTestPayment(payment) &&
                    ['TestSettled', 'Settled', 'Authorized'].includes(payment.state) &&
                    !payment.refunds?.length,
            )
        )
            return '仅无真实或混合收款、无退款的历史模拟订单可以恢复';
        if (
            source.fulfillments?.length ||
            !source.lines.length ||
            source.lines.some(line => line.quantity <= 0)
        )
            return '原单已有履约或商品数量已变化，需人工核对';
        const [claims, sales, manual, cards] = await Promise.all([
            this.connection.getRepository(ctx, DigitalReceiptAccess).count({ where: { orderId: source.id } }),
            this.connection
                .getRepository(ctx, Sale)
                .count({ where: { orderLine: { order: { id: source.id } } } }),
            this.connection
                .getRepository(ctx, ManualDigitalDelivery)
                .find({ where: { orderId: source.id }, relations: ['events'] }),
            this.connection
                .getRepository(ctx, AutoCardDelivery)
                .find({ where: { orderId: source.id }, relations: ['poolItems'] }),
        ]);
        if (
            claims ||
            sales ||
            manual.some(
                task =>
                    task.encryptedPackages ||
                    task.sentAt ||
                    task.fulfillmentId ||
                    task.events?.some(event => event.type === 'PUBLISHED'),
            ) ||
            cards.some(task => task.poolItems?.length || task.sentAt || task.fulfillmentId)
        )
            return '原单已有领取、发卡或已发布交付内容，不能重复恢复';
        return null;
    }
}

function bounded(value: string, length: number, label: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > length) throw new UserInputError(`${label}缺失或过长`);
    return normalized;
}
function check<T>(value: T): Exclude<T, { errorCode: unknown }> {
    if (isGraphQlErrorResult(value as any))
        throw new UserInputError((value as any).transitionError || (value as any).message);
    return value as Exclude<T, { errorCode: unknown }>;
}
function addressInput(address: Order['shippingAddress']) {
    if (!address.countryCode) throw new UserInputError('历史订单地址缺少配送国家');
    return {
        fullName: address.fullName ?? '',
        company: address.company ?? '',
        streetLine1: address.streetLine1 ?? '',
        streetLine2: address.streetLine2 ?? '',
        city: address.city ?? '',
        province: address.province ?? '',
        postalCode: address.postalCode ?? '',
        countryCode: address.countryCode,
        phoneNumber: address.phoneNumber ?? '',
    };
}
export function quoteHash(order: Order): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                currency: order.currencyCode,
                total: order.totalWithTax,
                lines: order.lines.map(line => [
                    String(line.productVariantId),
                    line.quantity,
                    line.unitPriceWithTax,
                    line.linePriceWithTax,
                ]),
                coupons: [...order.couponCodes].sort(),
                shipping: order.shippingLines?.map(line => [
                    String(line.shippingMethodId),
                    line.priceWithTax,
                ]),
                address: order.shippingAddress,
            }),
        )
        .digest('hex');
}
function quoteChanges(source: Order, draft: Order, existing: string[]): string[] {
    const changes = [...existing];
    if (source.totalWithTax !== draft.totalWithTax)
        changes.push('当前应付金额与历史订单不同，请按正式单当前报价联系客户确认');
    for (const old of source.lines) {
        const current = draft.lines.find(
            line => String(line.productVariantId) === String(old.productVariantId),
        );
        if (
            !current ||
            current.quantity !== old.quantity ||
            current.unitPriceWithTax !== old.unitPriceWithTax
        )
            changes.push(`${old.productVariant?.name ?? old.productVariantId}：数量或当前商品价格已变化`);
    }
    return [...new Set(changes)];
}
