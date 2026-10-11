import { Injectable } from '@nestjs/common';
import {
    ForbiddenError,
    ID,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { totalCoveredByPayments } from '@vendure/core/dist/service/helpers/utils/order-utils';

import { PaymentAttemptStatus, StorefrontPaymentAttempt } from './entities/storefront-payment-attempt.entity';
import { StorefrontCartService } from './storefront-cart.service';

export interface StorefrontPaymentAttemptInput {
    requestId: string;
    orderId: ID;
    kind: 'payment' | 'balance';
    method: string;
    currencyCode: string;
    amount: number;
}

const rejectedCodes = new Set([
    'NO_ACTIVE_ORDER_ERROR',
    'ORDER_PAYMENT_STATE_ERROR',
    'INELIGIBLE_PAYMENT_METHOD_ERROR',
    'PAYMENT_DECLINED_ERROR',
    'COUPON_REMOVED_DURING_CHECKOUT_ERROR',
]);

@Injectable()
export class StorefrontPaymentAttemptService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly carts: StorefrontCartService,
    ) {}

    // Deliberately autocommitted outside the payment transaction: a rollback or lost response
    // must not erase the claim. All access is explicitly bound to the current owned cart/channel.
    private get receipts() {
        return this.connection.rawConnection.getRepository(StorefrontPaymentAttempt);
    }

    async execute<T>(
        ctx: RequestContext,
        input: StorefrontPaymentAttemptInput,
        work: () => Promise<T>,
    ): Promise<T> {
        this.validate(input);
        const cartId = await this.ownedCart(ctx);
        const existing = await this.receipts.findOneBy({ cartId, requestId: input.requestId });
        if (existing) return this.replay<T>(ctx, existing, input);
        await this.assertCurrentOrder(ctx, input);
        const receipt = new StorefrontPaymentAttempt({
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
            cartId,
            channelId: ctx.channelId,
            status: 'PROCESSING',
            errorCode: null,
            activeOrderKey: this.orderKey(ctx, input.orderId),
        });
        try {
            await this.receipts.insert(receipt);
        } catch (error) {
            // Only a real uniqueness collision may become a replay; storage failures fail closed.
            const raced = await this.receipts.findOneBy({ cartId, requestId: input.requestId });
            if (raced) return this.replay<T>(ctx, raced, input);
            if (await this.receipts.existsBy({ activeOrderKey: this.orderKey(ctx, input.orderId) }))
                throw new UserInputError('PAYMENT_ATTEMPT_REVIEW_REQUIRED');
            throw error;
        }
        let result: T;
        try {
            await this.assertCurrentOrder(ctx, input);
        } catch (error) {
            await this.finish(receipt, 'REJECTED', 'PAYMENT_REQUEST_SCOPE_CHANGED');
            throw error;
        }
        try {
            result = await work();
        } catch (error) {
            await this.finish(receipt, 'UNKNOWN', 'PAYMENT_ATTEMPT_REVIEW_REQUIRED');
            throw error;
        }
        const code = this.resultErrorCode(result);
        const returnedOrder =
            result && typeof result === 'object' && 'order' in result ? result.order : result;
        const applied =
            returnedOrder &&
            typeof returnedOrder === 'object' &&
            'id' in returnedOrder &&
            String(returnedOrder.id) === String(input.orderId);
        await this.finish(
            receipt,
            code ? (rejectedCodes.has(code) ? 'REJECTED' : 'UNKNOWN') : applied ? 'APPLIED' : 'UNKNOWN',
            code ?? (applied ? null : 'PAYMENT_ATTEMPT_REVIEW_REQUIRED'),
            input.kind === 'payment' && !!applied && !this.completedOrder(returnedOrder),
        );
        return result;
    }

    async read(ctx: RequestContext, input: StorefrontPaymentAttemptInput) {
        this.validate(input);
        const cartId = await this.ownedCart(ctx);
        const receipt = await this.receipts.findOneBy({ cartId, requestId: input.requestId });
        if (!receipt) {
            await this.assertOwnedOrder(ctx, input.orderId);
            return { requestId: input.requestId, status: 'NOT_FOUND', errorCode: null };
        }
        this.assertMatches(ctx, receipt, input);
        // A crashed worker cannot be inferred to have failed before a provider side effect.
        const needsReview =
            receipt.status === 'UNKNOWN' ||
            (receipt.status === 'PROCESSING' && Date.now() - receipt.updatedAt.getTime() > 120_000);
        return {
            requestId: receipt.requestId,
            status: needsReview ? 'UNKNOWN' : receipt.status,
            errorCode: needsReview ? 'PAYMENT_ATTEMPT_REVIEW_REQUIRED' : receipt.errorCode,
        };
    }

    async fenceUnstarted(ctx: RequestContext, input: StorefrontPaymentAttemptInput) {
        this.validate(input);
        const cartId = await this.ownedCart(ctx);
        const existing = await this.receipts.findOneBy({ cartId, requestId: input.requestId });
        if (existing) return this.read(ctx, input);
        await this.assertOwnedOrder(ctx, input.orderId);
        try {
            await this.receipts.insert(
                new StorefrontPaymentAttempt({
                    ...input,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    cartId,
                    channelId: ctx.channelId,
                    status: 'NOT_EXECUTED',
                    errorCode: null,
                    activeOrderKey: null,
                }),
            );
        } catch (error) {
            if (!(await this.receipts.existsBy({ cartId, requestId: input.requestId }))) throw error;
        }
        // The unique row is a permanent fence: a late original request cannot execute afterwards.
        return this.read(ctx, input);
    }

    async assertNoUnresolvedAttempt(ctx: RequestContext) {
        if (
            ctx.session?.activeOrderId &&
            (await this.receipts.existsBy({
                activeOrderKey: this.orderKey(ctx, ctx.session.activeOrderId),
            }))
        )
            throw new UserInputError('PAYMENT_ATTEMPT_REVIEW_REQUIRED');
    }

    private replay<T>(
        ctx: RequestContext,
        receipt: StorefrontPaymentAttempt,
        input: StorefrontPaymentAttemptInput,
    ): Promise<T> {
        this.assertMatches(ctx, receipt, input);
        // The canonical receipt, not another payment call, supplies the result after a replay.
        throw new UserInputError(
            receipt.status === 'APPLIED'
                ? 'PAYMENT_REQUEST_ALREADY_APPLIED'
                : receipt.status === 'NOT_EXECUTED'
                  ? 'PAYMENT_REQUEST_NOT_EXECUTED'
                  : 'PAYMENT_REQUEST_ALREADY_RECEIVED',
        );
    }

    private async ownedCart(ctx: RequestContext): Promise<ID> {
        const cart = await this.carts.findOwnedCart(ctx);
        if (!cart) throw new ForbiddenError();
        return cart.id;
    }

    private async assertOwnedOrder(ctx: RequestContext, orderId: ID): Promise<Order> {
        const cart = await this.carts.findOwnedCart(ctx);
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId },
            relations: ['payments', 'payments.refunds'],
        });
        if (
            !cart ||
            !order ||
            String(order.salesChannelId) !== String(ctx.channelId) ||
            String(cart.checkoutOrderId) !== String(orderId)
        )
            throw new ForbiddenError();
        return order;
    }

    private async assertCurrentOrder(ctx: RequestContext, input: StorefrontPaymentAttemptInput) {
        const order = await this.assertOwnedOrder(ctx, input.orderId);
        const outstanding = Math.max(0, order.totalWithTax - totalCoveredByPayments(order));
        if (
            String(ctx.session?.activeOrderId) !== String(order.id) ||
            !order.active ||
            order.state !== 'ArrangingPayment' ||
            String(order.currencyCode) !== input.currencyCode ||
            (input.kind === 'payment'
                ? input.amount !== outstanding
                : input.amount <= 0 || input.amount > outstanding)
        )
            throw new UserInputError('PAYMENT_REQUEST_SCOPE_CHANGED');
    }

    private assertMatches(
        ctx: RequestContext,
        receipt: StorefrontPaymentAttempt,
        input: StorefrontPaymentAttemptInput,
    ) {
        if (
            String(receipt.channelId) !== String(ctx.channelId) ||
            String(receipt.orderId) !== String(input.orderId) ||
            receipt.kind !== input.kind ||
            receipt.method !== input.method ||
            receipt.currencyCode !== input.currencyCode ||
            receipt.amount !== input.amount
        )
            throw new UserInputError('PAYMENT_REQUEST_SCOPE_CHANGED');
    }

    private validate(input: StorefrontPaymentAttemptInput) {
        if (
            !input ||
            typeof input.requestId !== 'string' ||
            !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId) ||
            !['string', 'number'].includes(typeof input.orderId) ||
            !input.orderId ||
            !['payment', 'balance'].includes(input.kind) ||
            typeof input.method !== 'string' ||
            !input.method.length ||
            input.method.length > 100 ||
            typeof input.currencyCode !== 'string' ||
            !/^[A-Z]{3,4}$/.test(input.currencyCode) ||
            !Number.isSafeInteger(input.amount) ||
            input.amount < 0 ||
            input.amount > 2_147_483_647
        )
            throw new UserInputError('INVALID_PAYMENT_REQUEST');
    }

    private orderKey(ctx: RequestContext, orderId: ID) {
        return `${ctx.channelId}:${orderId}`;
    }

    private resultErrorCode(result: unknown): string | null {
        if (result && typeof result === 'object' && 'errorCode' in result) {
            const code = String(result.errorCode);
            return /^[A-Z_]{1,100}$/.test(code) ? code : 'PAYMENT_ATTEMPT_REVIEW_REQUIRED';
        }
        return null;
    }

    private completedOrder(result: unknown): boolean {
        return (
            !!result &&
            typeof result === 'object' &&
            'state' in result &&
            [
                'PaymentAuthorized',
                'PaymentSettled',
                'PartiallyShipped',
                'Shipped',
                'PartiallyDelivered',
                'Delivered',
                'Cancelled',
            ].includes(String(result.state))
        );
    }

    private async finish(
        receipt: StorefrontPaymentAttempt,
        status: PaymentAttemptStatus,
        errorCode: string | null,
        keepOrderFence = false,
    ) {
        await this.receipts.update(
            { cartId: receipt.cartId, requestId: receipt.requestId, status: 'PROCESSING' },
            {
                status,
                errorCode,
                activeOrderKey: status === 'UNKNOWN' || keepOrderFence ? receipt.activeOrderKey : null,
            },
        );
    }
}
