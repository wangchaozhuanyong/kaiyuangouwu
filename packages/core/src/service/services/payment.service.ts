// organize-imports-ignore
import { Injectable } from '@nestjs/common';
import { ManualPaymentInput, RefundOrderInput } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { createHash } from 'node:crypto';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError, UserInputError } from '../../common/error/errors';
import {
    PaymentStateTransitionError,
    RefundAmountError,
    RefundStateTransitionError,
} from '../../common/error/generated-graphql-admin-errors';
import { IneligiblePaymentMethodError } from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { PaymentMetadata } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { Logger } from '../../config/logger/vendure-logger';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { RefundLine } from '../../entity/order-line-reference/refund-line.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { Refund } from '../../entity/refund/refund.entity';
import { EventBus } from '../../event-bus/event-bus';
import { PaymentAttemptEvent } from '../../event-bus/events/payment-attempt-event';
import { PaymentStateTransitionEvent } from '../../event-bus/events/payment-state-transition-event';
import { RefundStateTransitionEvent } from '../../event-bus/events/refund-state-transition-event';
import { modificationQuantityRefundGroup } from '../helpers/order-modifier/modification-refunds';
import { assertOrderSalesChannel } from '../helpers/order-sales-scope';
import { PaymentState } from '../helpers/payment-state-machine/payment-state';
import { PaymentStateMachine } from '../helpers/payment-state-machine/payment-state-machine';
import { RefundStateMachine } from '../helpers/refund-state-machine/refund-state-machine';
import { effectiveRefundLines } from '../helpers/utils/refund-quantities';

import { PaymentMethodService } from './payment-method.service';

/** Server-only evidence; GraphQL callers cannot supply this argument. */
export interface VerifiedRefundSettlementEvidence {
    source: 'provider-callback' | 'verified-external' | 'manual-registration';
    paymentId: ID;
    amount: number;
    transactionId: string;
    evidenceReference: string;
}

function refundRequestFingerprint(input: RefundOrderInput): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                paymentId: String(input.paymentId),
                amount: input.amount ?? null,
                lines: (input.lines ?? [])
                    .map(line => ({ orderLineId: String(line.orderLineId), quantity: line.quantity }))
                    .sort((a, b) => a.orderLineId.localeCompare(b.orderLineId)),
                shipping: input.shipping ?? 0,
                adjustment: input.adjustment ?? 0,
                reason: input.reason?.trim() || null,
                reasonType:
                    input.reasonType ??
                    ((input.lines?.length ?? 0) > 0
                        ? 'ITEMS'
                        : (input.shipping ?? 0) > 0
                          ? 'SHIPPING'
                          : 'COMPENSATION'),
                afterSalesId: input.afterSalesId ? String(input.afterSalesId) : null,
            }),
        )
        .digest('hex');
}

function refundRequestKey(input: RefundOrderInput): string {
    // Legacy callers cannot express two distinct but identical refund requests.
    // Prefer safe replay to issuing the same transfer twice; new callers provide
    // a new explicit key for a separately reviewed request.
    if (input.idempotencyKey == null) return `refund-legacy:${refundRequestFingerprint(input)}`;
    const key = input.idempotencyKey.trim();
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(key)) {
        throw new UserInputError('退款请求编号必须是 1 至 128 位字母、数字、冒号、下划线或连字符');
    }
    return key;
}

/**
 * @description
 * Contains methods relating to {@link Payment} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class PaymentService {
    private readonly refundRequestValidators = new Map<
        string,
        (ctx: RequestContext, order: Order, input: RefundOrderInput, existingRefund?: Refund) => Promise<void>
    >();

    registerRefundRequestValidator(
        id: string,
        validator: (
            ctx: RequestContext,
            order: Order,
            input: RefundOrderInput,
            existingRefund?: Refund,
        ) => Promise<void>,
    ): void {
        this.refundRequestValidators.set(id, validator);
    }
    private readonly confirmationValidators = new Map<
        string,
        (
            ctx: RequestContext,
            order: Order,
            payment: Payment,
            state: PaymentState,
            source: 'handler' | 'manual',
        ) => Promise<string | undefined>
    >();

    registerConfirmationValidator(
        id: string,
        validator: (
            ctx: RequestContext,
            order: Order,
            payment: Payment,
            state: PaymentState,
            source: 'handler' | 'manual',
        ) => Promise<string | undefined>,
    ): void {
        this.confirmationValidators.set(id, validator);
    }

    private async validateConfirmation(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        state: PaymentState,
        source: 'handler' | 'manual' = 'handler',
    ): Promise<PaymentState> {
        if (state !== 'Authorized' && state !== 'Settled') return state;
        for (const validator of this.confirmationValidators.values()) {
            let error: string | undefined;
            try {
                error = await this.connection.withTransaction(ctx, txCtx =>
                    validator(txCtx, order, payment, state, source),
                );
            } catch {
                error = 'Payment received but validation could not be completed; manual review required';
            }
            if (error) {
                payment.errorMessage = 'PAYMENT_REVIEW_REQUIRED: ' + error;
                payment.metadata = {
                    ...payment.metadata,
                    manualReview: {
                        required: true,
                        receivedState: state,
                        reason: error,
                        recordedAt: new Date().toISOString(),
                    },
                };
                return 'Error';
            }
        }
        return state;
    }

    constructor(
        private connection: TransactionalConnection,
        private paymentStateMachine: PaymentStateMachine,
        private refundStateMachine: RefundStateMachine,
        private paymentMethodService: PaymentMethodService,
        private eventBus: EventBus,
    ) {}

    async create(ctx: RequestContext, input: DeepPartial<Payment>): Promise<Payment> {
        const newPayment = new Payment({
            ...input,
            state: this.paymentStateMachine.getInitialState(),
        });
        return this.connection.getRepository(ctx, Payment).save(newPayment);
    }

    async findOneOrThrow(ctx: RequestContext, id: ID, relations: string[] = ['order']): Promise<Payment> {
        return await this.connection.getEntityOrThrow(ctx, Payment, id, {
            relations,
        });
    }

    /**
     * @description
     * Transitions a Payment to the given state.
     *
     * When updating a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `transitionPaymentToState()` method, which will also handle
     * updating the Order state too.
     */
    async transitionToState(
        ctx: RequestContext,
        paymentId: ID,
        state: PaymentState,
    ): Promise<Payment | PaymentStateTransitionError> {
        if (state === 'Settled') {
            return this.settlePayment(ctx, paymentId);
        }
        if (state === 'Cancelled') {
            return this.cancelPayment(ctx, paymentId);
        }
        const payment = await this.findOneOrThrow(ctx, paymentId);
        assertOrderSalesChannel(ctx, payment.order);
        const fromState = payment.state;
        return this.transitionStateAndSave(ctx, payment, fromState, state);
    }

    getNextStates(payment: Payment): readonly PaymentState[] {
        return this.paymentStateMachine.getNextStates(payment);
    }

    /**
     * @description
     * Creates a new Payment.
     *
     * When creating a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `addPaymentToOrder()` method, which will also handle
     * updating the Order state too.
     */
    async createPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        method: string,
        metadata: any,
        beforeFinalize?: (ctx: RequestContext, payment: Payment) => Promise<void>,
    ): Promise<Payment | IneligiblePaymentMethodError> {
        assertOrderSalesChannel(ctx, order);
        const { paymentMethod, handler, checker } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            method,
        );
        if (paymentMethod.checker && checker) {
            const eligible = await checker.check(ctx, order, paymentMethod.checker.args, paymentMethod);
            if (eligible === false || typeof eligible === 'string') {
                return new IneligiblePaymentMethodError({
                    eligibilityCheckerMessage: typeof eligible === 'string' ? eligible : undefined,
                });
            }
        }
        await this.eventBus.publish(new PaymentAttemptEvent(ctx, order, 'STARTED'));
        let result: Awaited<ReturnType<typeof handler.createPayment>>;
        try {
            result = await handler.createPayment(
                ctx,
                order,
                amount,
                paymentMethod.handler.args,
                metadata || {},
                paymentMethod,
            );
        } catch (error) {
            await this.eventBus.publish(new PaymentAttemptEvent(ctx, order, 'FAILED'));
            throw error;
        }
        await this.eventBus.publish(new PaymentAttemptEvent(ctx, order, 'RETURNED', result.state));
        const initialState = 'Created';
        // The DB-write sequence below (payment create, state transition, save, relation
        // add, onTransitionEnd hooks) is wrapped in withTransaction so it commits or
        // rolls back atomically — this is what fixes #4686 for this method. Note that
        // handler.createPayment above is intentionally outside the transaction (it is
        // a network call to a third-party gateway) and is NOT covered by this wrap.
        // If the gateway succeeds and a subsequent DB write fails, the resulting
        // orphaned charge must be reconciled at a higher level. Likewise, the `order`
        // entity was loaded by the caller outside this transaction.
        return this.connection.withTransaction(ctx, async txCtx => {
            const newPayment = new Payment({ ...result, method, state: initialState, metadata: {} });
            newPayment.metadata = this.paymentMetadataWithRefundBudget(order, result.metadata);
            const payment = await this.connection.getRepository(txCtx, Payment).save(newPayment);
            const confirmedState = await this.validateConfirmation(txCtx, order, payment, result.state);
            const { finalize } = await this.paymentStateMachine.transition(
                txCtx,
                order,
                payment,
                confirmedState,
            );
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder()
                .relation('payments')
                .of(order)
                .add(payment);
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(initialState, confirmedState, txCtx, payment, order),
            );
            await beforeFinalize?.(txCtx, payment);
            await finalize();
            return payment;
        });
    }

    /**
     * @description
     * Settles a Payment.
     *
     * When settling a Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `settlePayment()` method, which will also handle
     * updating the Order state too.
     */
    async settlePayment(ctx: RequestContext, paymentId: ID): Promise<PaymentStateTransitionError | Payment> {
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, paymentId, {
            relations: ['order'],
        });
        assertOrderSalesChannel(ctx, payment.order);
        const { paymentMethod, handler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            payment.method,
            true,
        );
        const settlePaymentResult = await handler.settlePayment(
            ctx,
            payment.order,
            payment,
            paymentMethod.handler.args,
            paymentMethod,
        );
        const fromState = payment.state;
        let toState: PaymentState;
        payment.metadata = this.mergePaymentMetadata(payment.metadata, settlePaymentResult.metadata);
        if (settlePaymentResult.success) {
            toState = 'Settled';
        } else {
            toState = settlePaymentResult.state || 'Error';
            payment.errorMessage = settlePaymentResult.errorMessage;
        }
        return this.transitionStateAndSave(ctx, payment, fromState, toState);
    }

    async cancelPayment(ctx: RequestContext, paymentId: ID): Promise<PaymentStateTransitionError | Payment> {
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, paymentId, {
            relations: ['order'],
        });
        assertOrderSalesChannel(ctx, payment.order);
        if (payment.state === 'Cancelled') return payment;
        if (payment.state === 'Settled') {
            throw new UserInputError('已到账款项必须通过退款处理，不能取消支付记录');
        }
        const { paymentMethod, handler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            payment.method,
            true,
        );
        if (!handler.supportsPaymentCancellation) {
            throw new UserInputError('当前支付渠道不支持撤销支付，请先核对渠道结果');
        }
        const cancelPaymentResult = await handler.cancelPayment(
            ctx,
            payment.order,
            payment,
            paymentMethod.handler.args,
            paymentMethod,
        );
        const fromState = payment.state;
        let toState: PaymentState;
        payment.metadata = this.mergePaymentMetadata(payment.metadata, cancelPaymentResult?.metadata);
        if (cancelPaymentResult?.success) {
            toState = 'Cancelled';
        } else {
            toState = cancelPaymentResult?.state || 'Error';
            payment.errorMessage = cancelPaymentResult?.errorMessage || '支付渠道未确认撤销成功';
        }
        return this.transitionStateAndSave(ctx, payment, fromState, toState);
    }

    private async transitionStateAndSave(
        ctx: RequestContext,
        payment: Payment,
        fromState: PaymentState,
        toState: PaymentState,
    ) {
        if (fromState !== toState)
            toState = await this.validateConfirmation(ctx, payment.order, payment, toState);
        if (fromState === toState) {
            // in case metadata was changed
            await this.connection.getRepository(ctx, Payment).save(payment, { reload: false });
            return payment;
        }
        // Wrapped in withTransaction so the state save and onTransitionEnd hooks
        // are atomic — see the equivalent comment on OrderService.transitionToState.
        // #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            let finalize: () => Promise<any>;
            try {
                const result = await this.paymentStateMachine.transition(
                    txCtx,
                    payment.order,
                    payment,
                    toState,
                );
                finalize = result.finalize;
            } catch (e: any) {
                const transitionError = txCtx.translate(e.message, { fromState, toState });
                return new PaymentStateTransitionError({ transitionError, fromState, toState });
            }
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(fromState, toState, txCtx, payment, payment.order),
            );
            await finalize();
            return payment;
        });
    }

    /**
     * @description
     * Creates a Payment from the manual payment mutation in the Admin API
     *
     * When creating a manual Payment in the context of an Order, it is
     * preferable to use the {@link OrderService} `addManualPaymentToOrder()` method, which will also handle
     * updating the Order state too.
     */
    async createManualPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        input: ManualPaymentInput,
        beforeFinalize?: (ctx: RequestContext, payment: Payment) => Promise<void>,
    ) {
        assertOrderSalesChannel(ctx, order);
        const initialState = 'Created';
        let endState: PaymentState = 'Settled';
        // Wrapped in withTransaction so the payment create, state transition, save,
        // relation add and onTransitionEnd hooks all commit or roll back together.
        // #4686.
        return this.connection.withTransaction(ctx, async txCtx => {
            const newPayment = new Payment({
                amount,
                order,
                transactionId: input.transactionId,
                metadata: {},
                method: input.method,
                state: initialState,
            });
            newPayment.metadata = this.paymentMetadataWithRefundBudget(order, input.metadata);
            const payment = await this.connection.getRepository(txCtx, Payment).save(newPayment);
            endState = await this.validateConfirmation(txCtx, order, payment, endState, 'manual');
            const { finalize } = await this.paymentStateMachine.transition(txCtx, order, payment, endState);
            await this.connection.getRepository(txCtx, Payment).save(payment, { reload: false });
            await this.connection
                .getRepository(txCtx, Order)
                .createQueryBuilder()
                .relation('payments')
                .of(order)
                .add(payment);
            await this.eventBus.publish(
                new PaymentStateTransitionEvent(initialState, endState, txCtx, payment, order),
            );
            await beforeFinalize?.(txCtx, payment);
            await finalize();
            return payment;
        });
    }

    /** Look up a committed request while the caller holds the order's refund lock. */
    async findRefundByIdempotencyKey(
        ctx: RequestContext,
        input: RefundOrderInput,
        orderId: ID,
    ): Promise<Refund | undefined> {
        const key = refundRequestKey(input);
        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            relations: ['payments', 'payments.refunds'],
        });
        assertOrderSalesChannel(ctx, order);
        const matches = order.payments
            .flatMap(payment => payment.refunds ?? [])
            .filter(refund => refund.metadata?.refundRequest?.key === key);
        if (!matches.length) return;
        const fingerprint = refundRequestFingerprint(input);
        if (matches.some(refund => refund.metadata?.refundRequest?.fingerprint !== fingerprint)) {
            throw new UserInputError('退款请求编号已用于不同的金额或原因，请核对原申请');
        }
        // Failed and Pending are deliberately returned unchanged: replaying a request must
        // not issue another transfer or hide an uncertain provider outcome.
        return matches.find(refund => refund.metadata?.refundRequest?.primary) ?? matches[0];
    }

    /** Confirm money returned only through a provider callback or a separate receipt workflow. */
    async validateRefundSettlement(
        ctx: RequestContext,
        refund: Refund,
        transactionId: string,
        evidence?: VerifiedRefundSettlementEvidence,
    ): Promise<void> {
        assertOrderSalesChannel(ctx, refund.payment.order);
        const { handler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            refund.payment.method,
            true,
        );
        if (handler.refundSettlementMode === 'unsupported') {
            throw new UserInputError('该支付没有可退的真实款项');
        }
        const expectedSource =
            handler.refundSettlementMode === 'verified-external'
                ? 'verified-external'
                : handler.refundSettlementMode === 'automatic'
                  ? 'provider-callback'
                  : 'manual-registration';
        if (
            !evidence ||
            evidence.source !== expectedSource ||
            !idsAreEqual(evidence.paymentId, refund.payment.id) ||
            evidence.amount !== refund.total ||
            evidence.transactionId !== transactionId ||
            !evidence.evidenceReference.trim()
        ) {
            throw new UserInputError(
                handler.refundSettlementMode === 'automatic'
                    ? '该退款必须等待支付渠道回执，不能手填流水号确认成功'
                    : handler.refundSettlementMode === 'verified-external'
                      ? '请通过核验退款凭证的专用流程确认退款'
                      : '请通过登记线下退款流程填写实际付款凭证',
            );
        }
        if (!transactionId.trim()) throw new UserInputError('退款流水号不能为空');
        if (transactionId === refund.payment.transactionId)
            throw new UserInputError('退款流水号不能使用原收款流水号');
    }

    /** Read-only preflight, shared by direct refunds and order modifications. */
    async validateRefundRequest(
        ctx: RequestContext,
        input: RefundOrderInput,
        order: Order,
        selectedPayment: Payment,
        existingRefund?: Refund,
    ) {
        const orderWithRefunds = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['lines', 'payments', 'payments.refunds', 'payments.refunds.lines'],
        });
        assertOrderSalesChannel(ctx, orderWithRefunds);

        if (input.afterSalesId && this.refundRequestValidators.size === 0) {
            throw new UserInputError('售后退款关联校验尚未启用，请稍后再试');
        }
        for (const validator of this.refundRequestValidators.values())
            await validator(ctx, orderWithRefunds, input, existingRefund);
        const sourcePayment = orderWithRefunds.payments.find(p => idsAreEqual(p.id, selectedPayment.id));
        if (!sourcePayment || sourcePayment.state !== 'Settled') {
            throw new UserInputError('只能对已到账的支付申请退款');
        }
        if (!Number.isSafeInteger(sourcePayment.amount) || sourcePayment.amount <= 0)
            throw new UserInputError('来源收款金额异常，必须先核实资金记录');
        if (sourcePayment.metadata?.public?.testPayment === true) {
            throw new UserInputError('测试支付没有真实款项，不能退款');
        }
        const { handler: sourceHandler } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            sourcePayment.method,
            true,
        );
        if (sourceHandler.refundSettlementMode === 'unsupported')
            throw new UserInputError('该支付方式不支持退款');
        const reasonType =
            input.reasonType ??
            ((input.lines?.length ?? 0) > 0
                ? 'ITEMS'
                : (input.shipping ?? 0) > 0
                  ? 'SHIPPING'
                  : 'COMPENSATION');
        const group =
            modificationQuantityRefundGroup(input) ?? existingRefund?.metadata?.refundRequest?.quantityGroup;
        if (reasonType === 'ITEMS' && !input.lines?.length && !group?.key)
            throw new UserInputError('商品退款必须选择商品和退款份数');
        if (reasonType !== 'ITEMS' && input.lines?.length)
            throw new UserInputError('运费或补偿退款不能同时扣减商品份数');
        const shipping = input.shipping ?? 0;
        const shippingRemaining = this.remainingShippingRefundBudget(orderWithRefunds);
        if (!Number.isSafeInteger(shipping) || shipping < 0)
            throw new UserInputError('运费退款必须是非负整数最小货币单位');
        if (reasonType !== 'SHIPPING' && shipping !== 0)
            throw new UserInputError('商品、运费和补偿退款必须分别申请');
        if (reasonType === 'SHIPPING') {
            if (
                shipping <= 0 ||
                (input.adjustment ?? 0) !== 0 ||
                (input.amount != null && input.amount !== shipping)
            ) {
                throw new UserInputError('运费退款只能填写实际退还的运费，金额必须一致');
            }
            if (shipping > shippingRemaining) throw new UserInputError('运费退款超过原收取运费的未退余额');
        }
        const selectedLineIds = new Set<string>();
        for (const lineInput of input.lines ?? []) {
            const lineId = String(lineInput.orderLineId);
            if (selectedLineIds.has(lineId)) throw new UserInputError('同一商品行只能选择一次');
            selectedLineIds.add(lineId);
            if (!Number.isSafeInteger(lineInput.quantity) || lineInput.quantity <= 0)
                throw new UserInputError('退款份数必须是正整数');
            const line = orderWithRefunds.lines.find(candidate =>
                idsAreEqual(candidate.id, lineInput.orderLineId),
            );
            if (!line) throw new UserInputError('退款商品不属于来源支付的订单');
            const refundedQuantity = effectiveRefundLines(
                orderWithRefunds.payments.flatMap(p => p.refunds ?? []),
                existingRefund?.metadata?.refundRequest?.quantityGroup?.key,
            )
                .filter(refundLine => idsAreEqual(refundLine.orderLineId, lineInput.orderLineId))
                .reduce((sum, refundLine) => sum + refundLine.quantity, 0);
            const soldQuantity = line.orderPlacedQuantity || line.quantity;
            if (lineInput.quantity > soldQuantity - refundedQuantity)
                throw new UserInputError('退款份数超过该商品尚未退款的成交份数');
        }
        if (input.amount != null && (!Number.isSafeInteger(input.amount) || input.amount <= 0)) {
            throw new UserInputError('退款金额必须是大于 0 的整数最小货币单位');
        }
        const { total, orderLinesTotal } = await this.getRefundAmount(ctx, input);
        if (!Number.isSafeInteger(total) || total <= 0) {
            throw new UserInputError('退款金额必须大于 0，且不能超过已到账余额');
        }
        const requestKey = refundRequestKey(input);
        const fingerprint = refundRequestFingerprint(input);

        const refundableAmount = sourcePayment.amount - this.getPaymentRefundTotal(sourcePayment);
        if (refundableAmount < total) {
            return new RefundAmountError({ maximumRefundable: refundableAmount });
        }
        return {
            orderWithRefunds,
            sourcePayment,
            total,
            orderLinesTotal,
            requestKey,
            fingerprint,
            refundableAmount,
            shippingRemaining,
        };
    }

    /** Preflight all allocations together while the caller holds the order lock. */
    async validateRefundBatch(
        ctx: RequestContext,
        inputs: RefundOrderInput[],
        order: Order,
        payments: Payment[],
    ) {
        const result: Array<{ input: RefundOrderInput; payment: Payment }> = [];
        const requestedByPayment = new Map<string, { amount: number; available: number }>();
        const requestedUnits = new Map<string, { quantity: number; available: number }>();
        const requestedByAfterSales = new Map<string, RefundOrderInput>();
        let shippingTotal = 0;
        let shippingAvailable = Number.MAX_SAFE_INTEGER;
        for (const input of inputs) {
            const payment = payments.find(candidate => idsAreEqual(candidate.id, input.paymentId));
            if (!payment) throw new UserInputError('退款来源支付不属于本订单');
            const prepared = await this.validateRefundRequest(ctx, input, order, payment);
            if (prepared instanceof RefundAmountError) throw new UserInputError(prepared.message);
            const paymentId = String(payment.id);
            const budget = requestedByPayment.get(paymentId) ?? {
                amount: 0,
                available: prepared.refundableAmount,
            };
            budget.amount += prepared.total;
            requestedByPayment.set(paymentId, budget);
            shippingTotal += input.shipping ?? 0;
            shippingAvailable = Math.min(shippingAvailable, prepared.shippingRemaining);
            if (input.afterSalesId) {
                const id = String(input.afterSalesId);
                const grouped = requestedByAfterSales.get(id) ?? {
                    ...input,
                    amount: 0,
                    shipping: 0,
                    adjustment: 0,
                    lines: [],
                    reasonType: undefined,
                };
                grouped.amount = (grouped.amount ?? 0) + prepared.total;
                grouped.shipping = (grouped.shipping ?? 0) + (input.shipping ?? 0);
                const groupedLines = grouped.lines ?? [];
                grouped.lines = groupedLines;
                for (const line of input.lines ?? []) {
                    const existing = groupedLines.find(item =>
                        idsAreEqual(item.orderLineId, line.orderLineId),
                    );
                    if (existing) existing.quantity += line.quantity;
                    else groupedLines.push({ ...line });
                }
                requestedByAfterSales.set(id, grouped);
            }
            for (const lineInput of input.lines ?? []) {
                const lineId = String(lineInput.orderLineId);
                const line = prepared.orderWithRefunds.lines.find(candidate =>
                    idsAreEqual(candidate.id, lineInput.orderLineId),
                );
                if (!line) throw new UserInputError('退款商品不属于该订单');
                const alreadyRequested = effectiveRefundLines(
                    prepared.orderWithRefunds.payments.flatMap(p => p.refunds ?? []),
                )
                    .filter(refundLine => idsAreEqual(refundLine.orderLineId, lineInput.orderLineId))
                    .reduce((sum, refundLine) => sum + refundLine.quantity, 0);
                const units = requestedUnits.get(lineId) ?? {
                    quantity: 0,
                    available: (line.orderPlacedQuantity || line.quantity) - alreadyRequested,
                };
                units.quantity += lineInput.quantity;
                requestedUnits.set(lineId, units);
            }
            result.push({ input, payment });
        }
        if ([...requestedByPayment.values()].some(budget => budget.amount > budget.available)) {
            throw new UserInputError('本次退款分配合计超过来源支付的可退余额，尚未调用退款渠道');
        }
        if (shippingTotal > shippingAvailable)
            throw new UserInputError('本次运费退款合计超过未退运费，尚未调用退款渠道');
        if ([...requestedUnits.values()].some(units => units.quantity > units.available)) {
            throw new UserInputError('本次商品退款合计超过未退成交份数，尚未调用退款渠道');
        }
        // A shared approval is a batch-wide budget, even when money is allocated
        // to different source payments or separate item/shipping purposes.
        // These aggregate inputs are read-only approval checks, never transfers.
        for (const grouped of requestedByAfterSales.values()) {
            for (const validator of this.refundRequestValidators.values())
                await validator(ctx, order, grouped);
        }
        return result;
    }

    /** Caller holds the order lock; each explicit attempt reuses the original record. */
    async retryRefund(
        ctx: RequestContext,
        refund: Refund,
        attemptKey: string,
    ): Promise<Refund | RefundStateTransitionError | RefundAmountError> {
        const key = refundRequestKey({ paymentId: refund.payment.id, idempotencyKey: attemptKey });
        const attempts: any[] = Array.isArray(refund.metadata?.refundAttempts)
            ? refund.metadata.refundAttempts
            : [];
        if (attempts.some(attempt => attempt.key === key)) return refund;
        if (refund.state !== 'Failed')
            throw new UserInputError('只能重试已明确失败的退款；处理中或成功的退款不得再次发送');
        if (refund.metadata?.refundRequest?.outcomeUnknown === true)
            throw new UserInputError('原退款回执尚未核实，请先对账，不能再次发起转账');
        const original = refund.metadata?.refundRequest;
        const input: RefundOrderInput = {
            paymentId: refund.payment.id,
            amount: refund.total,
            shipping: refund.shipping ?? 0,
            adjustment: refund.adjustment ?? 0,
            lines: (refund.lines ?? []).map(line => ({
                orderLineId: line.orderLineId,
                quantity: line.quantity,
            })),
            reason: refund.reason,
            reasonType: original?.reasonType,
            afterSalesId: original?.afterSalesId ?? undefined,
        };
        const prepared = await this.validateRefundRequest(
            ctx,
            input,
            refund.payment.order,
            refund.payment,
            refund,
        );
        if (prepared instanceof RefundAmountError) return prepared;
        const { handler, paymentMethod } = await this.paymentMethodService.getMethodAndOperations(
            ctx,
            refund.method,
            true,
        );
        const providerKey = `refund-retry:${createHash('sha256')
            .update(
                JSON.stringify({
                    refundId: String(refund.id),
                    originalKey: original?.key ?? null,
                    attemptKey: key,
                }),
            )
            .digest('hex')}`;
        const audit = {
            key,
            providerKey,
            state: 'Pending',
            startedAt: new Date().toISOString(),
            operatorUserId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            previousTransactionId: refund.transactionId || null,
            outcomeUnknown: false,
        };
        const { finalize } = await this.refundStateMachine.transitionForRetry(
            ctx,
            refund.payment.order,
            refund,
        );
        refund.transactionId = '';
        refund.metadata = {
            ...refund.metadata,
            refundRequest: {
                ...original,
                key: original?.key ?? `refund-record:${String(refund.id)}`,
                fingerprint: original?.fingerprint ?? refundRequestFingerprint(input),
                primary: original?.primary ?? true,
                reasonType:
                    original?.reasonType ??
                    (input.lines?.length ? 'ITEMS' : input.shipping ? 'SHIPPING' : 'COMPENSATION'),
                afterSalesId: original?.afterSalesId ?? null,
                outcomeUnknown: false,
                requiresReconciliation: false,
            },
            refundAttempts: [...attempts, audit],
        };
        await this.connection.getRepository(ctx, Refund).save(refund);
        await finalize();
        await this.eventBus.publish(
            new RefundStateTransitionEvent('Failed', 'Pending', ctx, refund, refund.payment.order),
        );

        // Offline and verified-external channels return to their dedicated
        // receipt flow; only automatic channels initiate another provider attempt.
        if (handler.refundSettlementMode !== 'automatic') return refund;
        let result: Awaited<ReturnType<PaymentMethodHandler['createRefund']>> = false;
        try {
            result = await handler.createRefund(
                ctx,
                { ...input, idempotencyKey: providerKey },
                refund.total,
                prepared.orderWithRefunds,
                prepared.sourcePayment,
                paymentMethod.handler.args,
                paymentMethod,
            );
        } catch {
            audit.outcomeUnknown = true;
            refund.metadata.refundRequest.outcomeUnknown = true;
            refund.metadata.refundRequest.requiresReconciliation = true;
        }
        if (result) {
            refund.transactionId = result.transactionId || '';
            refund.metadata = {
                ...refund.metadata,
                ...result.metadata,
                refundRequest: refund.metadata.refundRequest,
                refundAttempts: refund.metadata.refundAttempts,
            };
            if (result.state === 'Settled' && !result.transactionId?.trim()) {
                result = { ...result, state: 'Pending' };
                refund.metadata.refundRequest.requiresReconciliation = true;
            }
        }
        let transitionError: RefundStateTransitionError | undefined;
        if (result && result.state !== refund.state) {
            try {
                const transition = await this.refundStateMachine.transition(
                    ctx,
                    refund.payment.order,
                    refund,
                    result.state,
                );
                await this.connection.getRepository(ctx, Refund).save(refund);
                await transition.finalize();
                await this.eventBus.publish(
                    new RefundStateTransitionEvent(
                        'Pending',
                        result.state,
                        ctx,
                        refund,
                        refund.payment.order,
                    ),
                );
            } catch {
                // Provider execution cannot be rolled back. Retain a reservation
                // even when a custom state hook cannot complete its bookkeeping.
                refund.state = 'Pending';
                refund.metadata.refundRequest.requiresReconciliation = true;
                transitionError = new RefundStateTransitionError({
                    fromState: 'Pending',
                    toState: result.state,
                    transitionError: '渠道已返回，退款状态处理未完成，请核验原退款记录',
                });
            }
        }
        audit.state = refund.state;
        Object.assign(audit, {
            completedAt: new Date().toISOString(),
            transactionId: refund.transactionId || null,
        });
        await this.connection.getRepository(ctx, Refund).save(refund);
        return transitionError ?? refund;
    }

    /** Creates one source-payment refund after preflight; never silently spills into another payment. */

    async createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        order: Order,
        selectedPayment: Payment,
    ): Promise<Refund | RefundStateTransitionError | RefundAmountError> {
        const existing = await this.findRefundByIdempotencyKey(ctx, input, order.id);
        if (existing) return existing;
        const prepared = await this.validateRefundRequest(ctx, input, order, selectedPayment);
        if (prepared instanceof RefundAmountError) return prepared;
        const { orderWithRefunds, total, orderLinesTotal, requestKey, fingerprint } = prepared;
        const reasonType =
            input.reasonType ??
            ((input.lines?.length ?? 0) > 0
                ? 'ITEMS'
                : (input.shipping ?? 0) > 0
                  ? 'SHIPPING'
                  : 'COMPENSATION');

        const refundsCreated: Refund[] = [];
        const refundablePayments = orderWithRefunds.payments.filter(p => {
            return (
                p.state === 'Settled' &&
                p.metadata?.public?.testPayment !== true &&
                this.getPaymentRefundTotal(p) < p.amount
            );
        });
        let primaryRefund: Refund | undefined;
        const refundedPaymentIds: ID[] = [];
        const refundMax =
            refundablePayments
                ?.map(p => p.amount - this.getPaymentRefundTotal(p))
                .reduce((sum, amount) => sum + amount, 0) ?? 0;
        if (total > refundMax) return new RefundAmountError({ maximumRefundable: refundMax });
        let refundOutstanding = Math.min(total, refundMax);
        do {
            const paymentToRefund =
                (refundedPaymentIds.length === 0 &&
                    refundablePayments.find(p => idsAreEqual(p.id, selectedPayment.id))) ||
                refundablePayments.find(p => !refundedPaymentIds.includes(p.id));
            if (!paymentToRefund) {
                throw new InternalServerError('Could not find a Payment to refund');
            }
            const amountNotRefunded = paymentToRefund.amount - this.getPaymentRefundTotal(paymentToRefund);
            const constrainedTotal = Math.min(amountNotRefunded, refundOutstanding);
            let refund = new Refund({
                payment: paymentToRefund,
                total: constrainedTotal,
                reason: input.reason,
                method: paymentToRefund.method,
                state: 'Pending',
                metadata: {},
                items: orderLinesTotal, // deprecated
                adjustment: input.adjustment ?? 0, // deprecated
                shipping: input.shipping ?? 0, // deprecated
            });
            const modificationGroup = modificationQuantityRefundGroup(input);
            refund.metadata = {
                refundRequest: {
                    key: requestKey,
                    fingerprint,
                    primary: refundsCreated.length === 0,
                    reasonType,
                    ...(modificationGroup?.key ? { quantityGroup: modificationGroup } : {}),
                    ...(modificationGroup?.modificationKey
                        ? { modificationGroupKey: modificationGroup.modificationKey }
                        : {}),
                    afterSalesId: input.afterSalesId ? String(input.afterSalesId) : null,
                },
            };
            let paymentMethod: PaymentMethod | undefined;
            let handler: PaymentMethodHandler | undefined;
            try {
                const methodAndHandler = await this.paymentMethodService.getMethodAndOperations(
                    ctx,
                    paymentToRefund.method,
                    true,
                );
                paymentMethod = methodAndHandler.paymentMethod;
                handler = methodAndHandler.handler;
            } catch (e) {
                Logger.warn(
                    'Could not find a corresponding PaymentMethodHandler ' +
                        `when creating a refund for the Payment with method "${paymentToRefund.method}"`,
                );
            }
            let createRefundResult: Awaited<ReturnType<PaymentMethodHandler['createRefund']>> = false;
            try {
                createRefundResult =
                    paymentMethod && handler
                        ? await handler.createRefund(
                              ctx,
                              { ...input, idempotencyKey: requestKey },
                              constrainedTotal,
                              order,
                              paymentToRefund,
                              paymentMethod.handler.args,
                              paymentMethod,
                          )
                        : false;
            } catch {
                // A transport error cannot establish whether the provider returned money.
                // Commit a Pending reservation so retries inspect the same request instead
                // of issuing another transfer. Do not persist provider error text/secrets.
                refund.metadata.refundRequest.outcomeUnknown = true;
                refund.metadata.refundRequest.requiresReconciliation = true;
            }
            if (createRefundResult) {
                refund.transactionId = createRefundResult.transactionId || '';
                refund.metadata = {
                    ...(createRefundResult.metadata || {}),
                    refundRequest: refund.metadata.refundRequest,
                };
                if (createRefundResult.state === 'Settled' && !createRefundResult.transactionId?.trim()) {
                    createRefundResult = { ...createRefundResult, state: 'Pending' };
                    refund.metadata.refundRequest.requiresReconciliation = true;
                }
            }
            refund = await this.connection.getRepository(ctx, Refund).save(refund);
            const refundLines: RefundLine[] = [];
            for (const { orderLineId, quantity } of input.lines || []) {
                const refundLine = await this.connection.getRepository(ctx, RefundLine).save(
                    new RefundLine({
                        refund,
                        orderLineId,
                        quantity,
                    }),
                );
                refundLines.push(refundLine);
            }
            await this.connection
                .getRepository(ctx, Fulfillment)
                .createQueryBuilder()
                .relation('lines')
                .of(refund)
                .add(refundLines);
            if (createRefundResult && createRefundResult.state !== refund.state) {
                const fromState = refund.state;
                // Each iteration's state transition is wrapped in withTransaction so
                // the save, onTransitionEnd hooks and event publish commit or roll
                // back together — same atomicity guarantee as the dedicated
                // transition methods. The surrounding loop is intentionally NOT
                // wrapped: refunds created in earlier iterations remain committed
                // if a later iteration fails. #4686.
                const transitionError = await this.connection.withTransaction(ctx, async txCtx => {
                    let finalize: () => Promise<any>;
                    try {
                        const result = await this.refundStateMachine.transition(
                            txCtx,
                            order,
                            refund,
                            createRefundResult.state,
                        );
                        finalize = result.finalize;
                    } catch (e: any) {
                        return new RefundStateTransitionError({
                            transitionError: e.message,
                            fromState,
                            toState: createRefundResult.state,
                        });
                    }
                    await this.connection.getRepository(txCtx, Refund).save(refund, { reload: false });
                    await finalize();
                    await this.eventBus.publish(
                        new RefundStateTransitionEvent(
                            fromState,
                            createRefundResult.state,
                            txCtx,
                            refund,
                            order,
                        ),
                    );
                    return undefined;
                });
                if (transitionError) {
                    return transitionError;
                }
            }
            if (primaryRefund == null) {
                primaryRefund = refund;
            }
            refundsCreated.push(refund);
            refundedPaymentIds.push(paymentToRefund.id);
            refundOutstanding = total - summate(refundsCreated, 'total');
        } while (0 < refundOutstanding);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return primaryRefund;
    }

    /**
     * @description
     * Returns the total amount of all Refunds against the given Payment.
     */
    private getPaymentRefundTotal(payment: Payment): number {
        const nonFailedRefunds = payment.refunds?.filter(refund => refund.state !== 'Failed') ?? [];
        return summate(nonFailedRefunds, 'total');
    }

    private async getRefundAmount(
        ctx: RequestContext,
        input: RefundOrderInput,
    ): Promise<{ orderLinesTotal: number; total: number }> {
        if (input.amount != null) {
            // This is the new way of getting the refund amount
            // after v2.2.0. It allows full control over the refund.
            return { orderLinesTotal: 0, total: input.amount };
        }

        // This is the pre-v2.2.0 way of getting the refund amount.
        // It calculates the refund amount based on the order lines to be refunded
        // plus shipping and adjustment amounts. It is complex and prevents full
        // control over refund amounts, especially when multiple payment methods
        // are involved.
        // It is deprecated and will be removed in a future version.
        let refundOrderLinesTotal = 0;
        const inputLines = input.lines || [];
        const orderLines = await this.connection
            .getRepository(ctx, OrderLine)
            .find({ where: { id: In(inputLines.map(l => l.orderLineId)) } });
        for (const line of inputLines) {
            const orderLine = orderLines.find(l => idsAreEqual(l.id, line.orderLineId));
            if (orderLine && 0 < orderLine.orderPlacedQuantity) {
                refundOrderLinesTotal += line.quantity * orderLine.proratedUnitPriceWithTax;
            }
        }
        const total = refundOrderLinesTotal + (input.shipping ?? 0) + (input.adjustment ?? 0);
        return { orderLinesTotal: refundOrderLinesTotal, total };
    }

    private mergePaymentMetadata(m1: PaymentMetadata, m2?: PaymentMetadata): PaymentMetadata {
        if (!m2) {
            return m1;
        }
        const merged = { ...m1, ...m2 };
        if (m1.refundBudget) merged.refundBudget = m1.refundBudget;
        if (m1.public && m1.public) {
            merged.public = { ...m1.public, ...m2.public };
        }
        return merged;
    }

    private paymentMetadataWithRefundBudget(order: Order, metadata?: PaymentMetadata): PaymentMetadata {
        return {
            ...metadata,
            refundBudget: {
                shippingWithTax: Number.isSafeInteger(order.shippingWithTax)
                    ? Math.max(0, order.shippingWithTax)
                    : 0,
                orderTotalWithTax: Number.isSafeInteger(order.totalWithTax)
                    ? Math.max(0, order.totalWithTax)
                    : 0,
                currencyCode: order.currencyCode,
            },
        };
    }

    private remainingShippingRefundBudget(order: Order): number {
        const snapshots = order.payments
            .filter(p => p.state === 'Settled' && p.metadata?.public?.testPayment !== true)
            .map(p => p.metadata?.refundBudget?.shippingWithTax)
            .filter((amount): amount is number => Number.isSafeInteger(amount) && amount >= 0);
        const collected = snapshots.length
            ? Math.max(...snapshots)
            : Number.isSafeInteger(order.shippingWithTax)
              ? Math.max(0, order.shippingWithTax)
              : 0;
        const reserved = order.payments
            .flatMap(p => p.refunds ?? [])
            .filter(refund => ['Pending', 'Settled'].includes(refund.state))
            .reduce((sum, refund) => sum + Math.max(0, refund.shipping ?? 0), 0);
        return Math.max(0, collected - reserved);
    }
}
