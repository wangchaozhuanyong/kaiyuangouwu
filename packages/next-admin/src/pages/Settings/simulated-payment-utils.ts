import type { ConfigurableOperationRecord, StoreManagementResult } from '../../graphql/management.graphql';

export const SIMULATED_PAYMENT_METHOD_CODE = 'simulated-payment';
export const SIMULATED_PAYMENT_HANDLER_CODE = 'dummy-payment-handler';

type PaymentMethodItem = StoreManagementResult['paymentMethods']['items'][number];

export function isSimulatedPaymentMethod(method: {
    code: string;
    handler: Pick<ConfigurableOperationRecord, 'code'>;
}): boolean {
    return (
        method.code === SIMULATED_PAYMENT_METHOD_CODE ||
        method.code.startsWith(`${SIMULATED_PAYMENT_METHOD_CODE}-`) ||
        method.handler.code === SIMULATED_PAYMENT_HANDLER_CODE
    );
}

export function settlesSimulatedPaymentImmediately(method: PaymentMethodItem): boolean {
    if (!isSimulatedPaymentMethod(method)) return false;
    return method.handler.args.some(
        arg => arg.name === 'automaticSettle' && displayBoolean(arg.value) === true,
    );
}

export function simulatedPaymentHandlerInput() {
    return {
        code: SIMULATED_PAYMENT_HANDLER_CODE,
        arguments: [{ name: 'automaticSettle', value: 'true' }],
    };
}

export function createSimulatedPaymentInput(enabled: boolean, channelCode: string) {
    const normalizedChannelCode = channelCode
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, '-');
    return {
        code: normalizedChannelCode
            ? `${SIMULATED_PAYMENT_METHOD_CODE}-${normalizedChannelCode}`
            : SIMULATED_PAYMENT_METHOD_CODE,
        enabled,
        handler: simulatedPaymentHandlerInput(),
        translations: [
            {
                languageCode: 'zh_Hans',
                name: '模拟支付（测试）',
                description: '不会真实扣款，付款后订单会直接进入已结算状态。',
            },
            {
                languageCode: 'en',
                name: 'Simulated payment (test)',
                description: 'No real charge is made. The order is settled immediately after payment.',
            },
        ],
    };
}

function displayBoolean(value: string): boolean {
    if (value === 'true') return true;
    try {
        return JSON.parse(value) === true;
    } catch {
        return false;
    }
}
