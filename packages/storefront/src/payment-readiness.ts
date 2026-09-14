import { Order, PaymentMethod } from './types';

/** A payment response is newer than the cart snapshot for the same checkout. */
export function resolveCurrentCheckoutOrder(
    cartOrder: Order | null | undefined,
    latestOrder: Order | null,
): Order | null {
    if (latestOrder && cartOrder?.id === latestOrder.id) return latestOrder;
    return cartOrder ?? latestOrder;
}

export type PaymentAvailabilityStatus = 'READY' | 'NOT_CONFIGURED' | 'ORDER_INELIGIBLE';

export interface PaymentAvailability {
    status: PaymentAvailabilityStatus;
    methods: PaymentMethod[];
    eligibleMethods: PaymentMethod[];
}

/** Automatic fulfillment can finish before the payment response reaches the browser. */
export function isPaymentCompletedOrderState(state: string): boolean {
    return [
        'PaymentAuthorized',
        'PaymentSettled',
        'TestPaymentSettled',
        'PartiallyShipped',
        'Shipped',
        'PartiallyDelivered',
        'Delivered',
    ].includes(state);
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
