import { describe, expect, it } from 'vitest';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import {
    SIMULATED_PAYMENT_HANDLER_CODE,
    SIMULATED_PAYMENT_METHOD_CODE,
    createSimulatedPaymentInput,
    isSimulatedPaymentMethod,
    settlesSimulatedPaymentImmediately,
    simulatedPaymentHandlerInput,
} from './simulated-payment-utils';

type PaymentMethodItem = StoreManagementResult['paymentMethods']['items'][number];

describe('simulated payment helpers', () => {
    it('recognizes both the dedicated method and legacy dummy-handler methods', () => {
        expect(isSimulatedPaymentMethod(method())).toBe(true);
        expect(
            isSimulatedPaymentMethod(method({ code: `${SIMULATED_PAYMENT_METHOD_CODE}-my-malaysia` })),
        ).toBe(true);
        expect(
            isSimulatedPaymentMethod(
                method({
                    code: 'standard-payment',
                    handler: { code: SIMULATED_PAYMENT_HANDLER_CODE, args: [] },
                }),
            ),
        ).toBe(true);
        expect(
            isSimulatedPaymentMethod(method({ code: 'card', handler: { code: 'stripe-handler', args: [] } })),
        ).toBe(false);
    });

    it('always configures simulated checkout to settle immediately', () => {
        expect(simulatedPaymentHandlerInput()).toEqual({
            code: SIMULATED_PAYMENT_HANDLER_CODE,
            arguments: [{ name: 'automaticSettle', value: 'true' }],
        });
        expect(createSimulatedPaymentInput(true, 'my-malaysia')).toMatchObject({
            code: `${SIMULATED_PAYMENT_METHOD_CODE}-my-malaysia`,
            enabled: true,
            handler: simulatedPaymentHandlerInput(),
        });
        expect(
            settlesSimulatedPaymentImmediately(
                method({
                    handler: {
                        code: SIMULATED_PAYMENT_HANDLER_CODE,
                        args: [{ name: 'automaticSettle', value: 'true' }],
                    },
                }),
            ),
        ).toBe(true);
    });

    it('detects legacy authorization-only configuration that needs repair', () => {
        expect(
            settlesSimulatedPaymentImmediately(
                method({
                    handler: {
                        code: SIMULATED_PAYMENT_HANDLER_CODE,
                        args: [{ name: 'automaticSettle', value: 'false' }],
                    },
                }),
            ),
        ).toBe(false);
    });
});

function method(overrides: Partial<PaymentMethodItem> = {}): PaymentMethodItem {
    return {
        id: 'payment-1',
        name: '模拟支付（测试）',
        description: '',
        code: SIMULATED_PAYMENT_METHOD_CODE,
        enabled: false,
        updatedAt: '2026-09-04T00:00:00.000Z',
        translations: [],
        checker: null,
        handler: {
            code: SIMULATED_PAYMENT_HANDLER_CODE,
            args: [{ name: 'automaticSettle', value: 'true' }],
        },
        ...overrides,
    };
}
