/** Scoped checkout simulation. Its settled records are audit evidence, not collected revenue. */
export const CONTROLLED_TEST_PAYMENT_METHOD_PREFIX = 'controlled-test-payment-';
export const CONTROLLED_TEST_PAYMENT_METHOD_SQL_LIKE = `${CONTROLLED_TEST_PAYMENT_METHOD_PREFIX}%`;

export function isControlledTestPaymentMethod(method?: string | null): boolean {
    return method?.startsWith(CONTROLLED_TEST_PAYMENT_METHOD_PREFIX) ?? false;
}

/** Only the handler-owned method and its server-written marker can establish a simulated payment. */
export function isConfirmedControlledTestPayment(payment: {
    method?: string | null;
    metadata?: { public?: { testPayment?: unknown } } | null;
}): boolean {
    return isControlledTestPaymentMethod(payment.method) && payment.metadata?.public?.testPayment === true;
}
