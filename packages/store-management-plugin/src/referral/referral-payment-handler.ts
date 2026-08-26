import { LanguageCode } from '@vendure/common/lib/generated-types';
import { PaymentMethodHandler } from '@vendure/core';

import { verifyReferralPaymentProof } from './referral-payment-proof';
import { REFERRAL_BALANCE_PAYMENT_HANDLER_CODE } from './referral.constants';

export const referralBalancePaymentHandler = new PaymentMethodHandler({
    code: REFERRAL_BALANCE_PAYMENT_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '邀请返利余额支付' },
        { languageCode: LanguageCode.en, value: 'Referral reward balance payment' },
    ],
    args: {},
    createPayment: (_ctx, order, outstandingAmount, _args, metadata) => {
        const proof = verifyReferralPaymentProof(metadata?.proof);
        const orderCustomerId = order.customer?.id?.toString();
        if (
            !proof ||
            proof.orderId !== order.id.toString() ||
            proof.customerId !== orderCustomerId ||
            proof.currencyCode !== String(order.currencyCode) ||
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
        return {
            amount: proof.amount,
            state: 'Settled' as const,
            transactionId: `referral-${proof.reservationId}`,
            metadata: {
                public: {
                    reservationId: proof.reservationId,
                    referralBalance: true,
                },
            },
        };
    },
    settlePayment: () => ({ success: true }),
    createRefund: (_ctx, _input, amount, _order, _payment) => ({
        state: 'Settled' as const,
        transactionId: `referral-refund-${Date.now()}`,
        metadata: { public: { referralBalanceRefund: true, amount } },
    }),
});
