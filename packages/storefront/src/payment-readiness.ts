import { PaymentMethod } from './types';

export type PaymentAvailabilityStatus = 'READY' | 'NOT_CONFIGURED' | 'ORDER_INELIGIBLE';

export interface PaymentAvailability {
    status: PaymentAvailabilityStatus;
    methods: PaymentMethod[];
    eligibleMethods: PaymentMethod[];
}

const TEST_PAYMENT_PATTERN =
    /(?:^|[-_\s])(demo|dummy|mock|simulated?|simulation|test)(?:$|[-_\s])|模拟|测试/iu;

export function isTestPaymentMethod(method: PaymentMethod): boolean {
    return TEST_PAYMENT_PATTERN.test([method.code, method.name, method.description].join(' '));
}

export function paymentAvailability(methods: PaymentMethod[]): PaymentAvailability {
    const eligibleMethods = methods.filter(method => method.isEligible);

    return {
        status: eligibleMethods.length ? 'READY' : methods.length ? 'ORDER_INELIGIBLE' : 'NOT_CONFIGURED',
        methods,
        eligibleMethods,
    };
}
