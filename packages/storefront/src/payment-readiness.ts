import { PaymentMethod } from './types';

export type PaymentAvailabilityStatus = 'READY' | 'NOT_CONFIGURED' | 'ORDER_INELIGIBLE';

export interface PaymentAvailability {
    status: PaymentAvailabilityStatus;
    methods: PaymentMethod[];
    eligibleMethods: PaymentMethod[];
}

const TEST_PAYMENT_PATTERN = /(?:^|[-_\s])(demo|dummy|mock|test)(?:$|[-_\s])|测试/iu;

export function isTestPaymentMethod(method: PaymentMethod): boolean {
    return TEST_PAYMENT_PATTERN.test([method.code, method.name, method.description].join(' '));
}

export function isControlledTestPaymentMethod(method: PaymentMethod): boolean {
    return method.code.startsWith('controlled-test-payment-');
}

export function paymentAvailability(
    methods: PaymentMethod[],
    options: { allowTestMethods: boolean },
): PaymentAvailability {
    const visibleMethods = methods.filter(method => {
        if (isControlledTestPaymentMethod(method)) return method.isEligible;
        return !isTestPaymentMethod(method) || options.allowTestMethods;
    });
    const eligibleMethods = visibleMethods.filter(method => method.isEligible);

    return {
        status: eligibleMethods.length
            ? 'READY'
            : visibleMethods.length
              ? 'ORDER_INELIGIBLE'
              : 'NOT_CONFIGURED',
        methods: visibleMethods,
        eligibleMethods,
    };
}
