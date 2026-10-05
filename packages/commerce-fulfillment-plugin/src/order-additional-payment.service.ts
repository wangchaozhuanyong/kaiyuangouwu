import { Injectable, Optional } from '@nestjs/common';
import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import type { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    ID,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    assertOrderSalesChannel,
    totalCoveredByActualPayments,
} from '@vendure/core';
import { ReferralService, StoreCurrencySettingsService } from '@vendure/store-management-plugin';

import { CheckoutResourcesService } from './checkout-resources.service';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';

/** A placed order is never reactivated as a cart merely to collect its price difference. */
@Injectable()
export class OrderAdditionalPaymentService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly orders: OrderService,
        private readonly tokens: OrderConfirmationTokenService,
        private readonly resources: CheckoutResourcesService,
        @Optional() private readonly currency?: StoreCurrencySettingsService,
        @Optional() private readonly referral?: ReferralService,
    ) {}

    private async owned(ctx: RequestContext, id: ID, token?: string) {
        const order = await this.connection.getEntityOrThrow(ctx, Order, id, {
            relations: ['customer', 'customer.user', 'payments', 'payments.refunds'],
        });
        assertOrderSalesChannel(ctx, order);
        const proof = token ? this.tokens.verifyToken(token) : undefined;
        if (
            !(ctx.activeUserId && String(order.customer?.user?.id) === String(ctx.activeUserId)) &&
            !(proof && proof.orderId === String(order.id) && proof.channelId === String(ctx.channelId))
        ) {
            throw new UserInputError('无权处理该订单的补款');
        }
        return order;
    }

    private due(order: Order) {
        const covered = totalCoveredByActualPayments(order);
        // A historical order with no actual money is not a price-difference checkout.
        return Number.isSafeInteger(covered) ? Math.max(0, order.totalWithTax - covered) : 0;
    }

    async quote(ctx: RequestContext, id: ID, token?: string) {
        return this.quoteForOwned(ctx, await this.owned(ctx, id, token));
    }

    private async quoteForOwned(ctx: RequestContext, order: Order) {
        const amount = this.due(order);
        const hold = await this.resources.hold(ctx, order.id);
        const usdtPayment = this.currency ? await this.currency.existingOrderUsdtQuote(ctx, order.id) : null;
        const awaitingUsdt = usdtPayment && ['PENDING', 'MANUAL_REVIEW'].includes(usdtPayment.paymentStatus);
        const blockedReason =
            order.active || !order.orderPlacedAt || order.state !== 'ArrangingAdditionalPayment'
                ? '订单当前无需补款'
                : hold && ['PAYING', 'REVIEW', 'RELEASED'].includes(hold.state)
                  ? '订单付款或交付资源尚待核验，请联系商家，不要重复支付'
                  : order.payments.some(
                          payment => payment.state === 'Created' || payment.metadata?.manualReview?.required,
                      )
                    ? '已有待确认付款，请联系商家核对原付款结果，不要重复支付'
                    : amount <= 0
                      ? '待补款金额已覆盖，请联系商家核对订单状态'
                      : null;
        const configuredMethods = blockedReason
            ? []
            : (await this.orders.getEligiblePaymentMethods(ctx, order.id)).filter(
                  method => !isControlledTestPaymentMethod(method.code),
              );
        const walletAvailableAmount =
            this.referral && configuredMethods.some(method => method.code === 'referral-balance')
                ? await this.referral.additionalBalanceAvailability(ctx, order)
                : 0;
        const usdtConfiguration =
            this.currency &&
            configuredMethods.some(method => method.code === 'usdt-trc20' && method.isEligible)
                ? await this.currency.get(ctx)
                : null;
        const methods = configuredMethods.map(method => {
            const reason =
                awaitingUsdt && method.code !== 'usdt-trc20'
                    ? '已有 USDT 付款请求，确认原付款结果前不能使用其他方式'
                    : method.code === 'usdt-trc20' &&
                        !(usdtConfiguration?.usdtRateAvailable && usdtConfiguration?.usdtPaymentConfigured)
                      ? '当前店铺 USDT 钱包或报价尚未就绪'
                      : method.code === 'referral-balance' && walletAvailableAmount <= 0
                        ? '请登录订单所属账户，并确认有可用返利余额'
                        : method.code === 'referral-balance-payment'
                          ? '请使用店铺正式配置的余额方式'
                          : null;
            return reason ? { ...method, isEligible: false, eligibilityMessage: reason } : method;
        });
        return {
            orderId: order.id,
            state: order.state,
            outstandingAmount: amount,
            blockedReason,
            methods,
            walletAvailableAmount,
            usdtPayment,
        };
    }

    async pay(
        ctx: RequestContext,
        input: {
            orderId: ID;
            confirmationToken?: string;
            expectedAmount: number;
            payment: PaymentInput;
        },
    ) {
        return this.orders.withOrderMutationTransaction(ctx, async txCtx => {
            await this.owned(txCtx, input.orderId, input.confirmationToken);
            await this.orders.lockOrderForRefund(txCtx, input.orderId);
            const order = await this.owned(txCtx, input.orderId, input.confirmationToken);
            const quote = await this.quoteForOwned(txCtx, order);
            if (quote.blockedReason) throw new UserInputError(quote.blockedReason);
            if (
                !Number.isSafeInteger(input.expectedAmount) ||
                input.expectedAmount <= 0 ||
                input.expectedAmount !== quote.outstandingAmount
            )
                throw new UserInputError('补款金额已变化，请重新核对后支付');
            if (!quote.methods.some(method => method.code === input.payment.method && method.isEligible))
                throw new UserInputError('该支付方式当前不允许补款，请重新选择或联系商家');
            if (['usdt-trc20', 'referral-balance', 'referral-balance-payment'].includes(input.payment.method))
                throw new UserInputError('请使用对应的 USDT 报价或余额补款入口');
            return this.orders.addPaymentToOrder(txCtx, order.id, input.payment);
        });
    }

    async usdtQuote(
        ctx: RequestContext,
        input: { orderId: ID; confirmationToken?: string; expectedAmount: number },
    ) {
        return this.orders.withOrderMutationTransaction(ctx, async txCtx => {
            await this.owned(txCtx, input.orderId, input.confirmationToken);
            await this.orders.lockOrderForRefund(txCtx, input.orderId);
            const quote = await this.quoteForOwned(
                txCtx,
                await this.owned(txCtx, input.orderId, input.confirmationToken),
            );
            if (quote.blockedReason) throw new UserInputError(quote.blockedReason);
            this.assertAmount(input.expectedAmount, quote.outstandingAmount);
            if (
                !this.currency ||
                !quote.methods.some(method => method.code === 'usdt-trc20' && method.isEligible)
            )
                throw new UserInputError('当前店铺尚未开放 USDT 补款');
            if (quote.usdtPayment && ['PENDING', 'MANUAL_REVIEW'].includes(quote.usdtPayment.paymentStatus)) {
                if (
                    quote.usdtPayment.paymentStatus === 'PENDING' &&
                    quote.usdtPayment.fiatAmount === input.expectedAmount &&
                    quote.usdtPayment.expiresAt > new Date()
                )
                    return quote.usdtPayment;
                throw new UserInputError('原 USDT 付款请求尚待核验，请确认原付款结果，不要重复转账');
            }
            return this.currency.createAdditionalOrderUsdtQuote(txCtx, input.orderId, input.expectedAmount);
        });
    }

    async useBalance(
        ctx: RequestContext,
        input: { orderId: ID; expectedAmount: number; amount: number; idempotencyKey: string },
    ) {
        return this.orders.withOrderMutationTransaction(ctx, async txCtx => {
            await this.owned(txCtx, input.orderId);
            await this.orders.lockOrderForRefund(txCtx, input.orderId);
            const quote = await this.quoteForOwned(txCtx, await this.owned(txCtx, input.orderId));
            if (quote.blockedReason) throw new UserInputError(quote.blockedReason);
            this.assertAmount(input.expectedAmount, quote.outstandingAmount);
            if (
                !this.referral ||
                !quote.methods.some(method => method.code === 'referral-balance' && method.isEligible)
            )
                throw new UserInputError('余额支付尚未就绪，或有其他待核验付款');
            if (
                !Number.isSafeInteger(input.amount) ||
                input.amount <= 0 ||
                input.amount > quote.outstandingAmount ||
                input.amount > quote.walletAvailableAmount
            )
                throw new UserInputError('余额抵扣金额无效或余额不足');
            return this.referral.useAdditionalBalance(
                txCtx,
                input.orderId,
                input.amount,
                input.expectedAmount,
                input.idempotencyKey,
            );
        });
    }

    private assertAmount(expected: number, actual: number) {
        if (!Number.isSafeInteger(expected) || expected <= 0 || expected !== actual)
            throw new UserInputError('补款金额已变化，请重新核对后支付');
    }
}
