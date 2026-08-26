import { LanguageCode } from '@vendure/common/lib/generated-types';
import { PaymentMethodHandler } from '@vendure/core';

import { verifyUsdtPaymentProof } from './usdt-payment-proof';
import { USDT_TRC20_PAYMENT_HANDLER_CODE } from './usdt-payment.constants';

export const usdtTrc20PaymentHandler = new PaymentMethodHandler({
    code: USDT_TRC20_PAYMENT_HANDLER_CODE,
    description: [
        { languageCode: LanguageCode.zh_Hans, value: 'USDT-TRC20 链上固化到账支付' },
        { languageCode: LanguageCode.en, value: 'USDT-TRC20 solidified on-chain payment' },
    ],
    args: {},
    createPayment: (ctx, order, outstandingAmount, _args, metadata) => {
        const proof = verifyUsdtPaymentProof(metadata?.proof);
        if (
            !proof ||
            proof.channelId !== String(ctx.channelId) ||
            proof.orderId !== String(order.id) ||
            proof.fiatCurrencyCode !== String(order.currencyCode) ||
            proof.fiatAmount !== outstandingAmount
        ) {
            return {
                amount: 0,
                state: 'Declined' as const,
                transactionId: `usdt-declined-${Date.now()}`,
                errorMessage: 'USDT 链上付款凭证无效或已过期',
                metadata: { public: { error: 'INVALID_USDT_PAYMENT_PROOF' } },
            };
        }
        return {
            amount: outstandingAmount,
            state: 'Settled' as const,
            transactionId: `tron:${proof.transactionId}`,
            metadata: {
                public: {
                    network: 'TRC20',
                    quoteId: proof.quoteId,
                    transactionId: proof.transactionId,
                    usdtAmount: proof.usdtAmount,
                    receivingAddressFingerprint: proof.receivingAddressFingerprint,
                },
            },
        };
    },
    settlePayment: () => ({ success: true }),
});
