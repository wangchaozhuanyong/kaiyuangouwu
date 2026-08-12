import { LanguageCode } from '@vendure/common/lib/generated-types';

import { CreatePaymentResult, PaymentMethodHandler } from './payment-method-handler';

/**
 * A dummy API to simulate an SDK provided by a popular payments service.
 */
const gripeSDK = {
    charges: {
        create: (options: any) => {
            return Promise.resolve({
                id: Math.random().toString(36).substr(3),
            });
        },
        capture: async (transactionId: string) => {
            return true;
        },
    },
};

/**
 * An example of a payment method which sets up and authorizes the payment on the client side and then
 * requires a further step on the server side to charge the card.
 */
export const examplePaymentHandler = new PaymentMethodHandler({
    code: 'example-payment-provider',
    description: [
        { languageCode: LanguageCode.en, value: 'Example payment service integration' },
        { languageCode: LanguageCode.zh_Hans, value: '示例支付服务' },
    ],
    args: {
        automaticCapture: {
            type: 'boolean',
            required: false,
            label: [
                { languageCode: LanguageCode.en, value: 'Capture immediately' },
                { languageCode: LanguageCode.zh_Hans, value: '立即扣款' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Capture the authorized payment immediately.' },
                { languageCode: LanguageCode.zh_Hans, value: '开启后，付款授权成功时立即完成扣款。' },
            ],
        },
        apiKey: {
            type: 'string',
            required: false,
            label: [
                { languageCode: LanguageCode.en, value: 'API key' },
                { languageCode: LanguageCode.zh_Hans, value: 'API 密钥' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Credential issued by the payment service.' },
                { languageCode: LanguageCode.zh_Hans, value: '填写支付服务商提供的接口密钥。' },
            ],
        },
    },
    createPayment: async (ctx, order, amount, args, metadata, method): Promise<CreatePaymentResult> => {
        try {
            const result = await gripeSDK.charges.create({
                apiKey: args.apiKey,
                amount,
                source: metadata.authToken,
            });
            return {
                amount,
                state: args.automaticCapture ? 'Settled' : 'Authorized',
                transactionId: result.id.toString(),
                metadata,
            };
        } catch (err: any) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: {
                    errorMessage: err.message,
                },
            };
        }
    },
    settlePayment: async (ctx, order, payment, args, method) => {
        const result = await gripeSDK.charges.capture(payment.transactionId);
        return {
            success: result,
            metadata: {
                captureId: '1234567',
            },
        };
    },
});
