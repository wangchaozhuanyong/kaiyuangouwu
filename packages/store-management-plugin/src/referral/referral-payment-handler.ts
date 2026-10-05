import { LanguageCode } from '@vendure/common/lib/generated-types';
import { PaymentMethodHandler, TransactionalConnection } from '@vendure/core';
import { createHash } from 'node:crypto';

import { ReferralWalletUsage } from '../entities/referral-wallet-usage.entity';

import { verifyReferralPaymentProof } from './referral-payment-proof';
import { ReferralWalletSpendService } from './referral-wallet-spend.service';
import { REFERRAL_BALANCE_PAYMENT_HANDLER_CODE } from './referral.constants';

let walletSpend: ReferralWalletSpendService;
let connection: TransactionalConnection;

export const referralBalancePaymentHandler = new PaymentMethodHandler({
    code: REFERRAL_BALANCE_PAYMENT_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '邀请返利余额支付' },
        { languageCode: LanguageCode.en, value: 'Referral reward balance payment' },
    ],
    args: {},
    init: injector => {
        walletSpend = injector.get(ReferralWalletSpendService);
        connection = injector.get(TransactionalConnection);
    },
    createPayment: async (ctx, order, outstandingAmount, _args, metadata) => {
        const proof = verifyReferralPaymentProof(metadata?.proof);
        const orderCustomerId = order.customer?.id?.toString();
        if (
            !proof ||
            proof.orderId !== order.id.toString() ||
            proof.customerId !== orderCustomerId ||
            proof.currencyCode !== String(order.currencyCode) ||
            (proof.walletUsage && proof.channelId !== String(ctx.channelId)) ||
            proof.amount > outstandingAmount
        ) {
            return {
                amount: 0,
                state: 'Declined' as const,
                transactionId: `referral-declined-${Date.now()}`,
                errorMessage: '返利余额支付凭证无效或已过期',
                metadata: { public: { error: 'INVALID_REFERRAL_BALANCE_PROOF' } },
            };
        }
        if (proof.walletUsage) {
            const usage = await connection.getRepository(ctx, ReferralWalletUsage).findOne({
                where: { id: proof.reservationId, channelId: ctx.channelId },
            });
            if (
                !usage ||
                usage.status !== 'RESERVED' ||
                usage.amount !== proof.amount ||
                String(usage.customerId) !== orderCustomerId ||
                usage.currencyCode !== order.currencyCode ||
                usage.resourceType !== 'ORDER_ADDITIONAL_PAYMENT' ||
                usage.metadata?.orderId !== String(order.id)
            ) {
                return { amount: 0, state: 'Declined' as const, errorMessage: '余额预占记录无效或已处理' };
            }
            await walletSpend.capture(ctx, {
                usageId: usage.id,
                amount: proof.amount,
                operationKey: `payment:${order.id}`,
                actorId: ctx.activeUserId,
                actorType: 'CUSTOMER',
            });
        }
        return {
            amount: proof.amount,
            state: 'Settled' as const,
            transactionId: proof.walletUsage
                ? `wallet-usage:${proof.reservationId}`
                : `referral-${proof.reservationId}`,
            metadata: {
                public: {
                    reservationId: proof.reservationId,
                    referralBalance: true,
                    ...(proof.walletUsage ? { walletUsageId: proof.reservationId } : {}),
                },
            },
        };
    },
    settlePayment: () => ({ success: true }),
    createRefund: async (ctx, input, amount, order, payment) => {
        const usageId = payment.metadata?.public?.walletUsageId;
        if (usageId) {
            const usage = await connection.getRepository(ctx, ReferralWalletUsage).findOne({
                where: { id: usageId, channelId: ctx.channelId },
            });
            if (
                !usage ||
                usage.resourceType !== 'ORDER_ADDITIONAL_PAYMENT' ||
                usage.metadata?.orderId !== String(order.id) ||
                usage.currencyCode !== order.currencyCode ||
                usage.amount !== payment.amount
            )
                throw new Error('余额退款来源与原订单付款不一致');
            const key = createHash('sha256')
                .update(input.idempotencyKey ?? JSON.stringify(input))
                .digest('hex');
            await walletSpend.refundCaptured(ctx, {
                usageId,
                amount,
                operationKey: `refund:${key}`,
                actorId: ctx.activeUserId,
                actorType: 'ADMIN',
            });
            return {
                state: 'Settled' as const,
                transactionId: `wallet-refund:${usageId}:${key.slice(0, 16)}`,
                metadata: { public: { referralBalanceRefund: true, walletUsageId: usageId, amount } },
            };
        }
        return {
            state: 'Settled' as const,
            transactionId: `referral-refund-${Date.now()}`,
            metadata: { public: { referralBalanceRefund: true, amount } },
        };
    },
});
