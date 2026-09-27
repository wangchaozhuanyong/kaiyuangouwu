/** Scoped checkout simulation. Its settled records are audit evidence, not collected revenue. */
export const CONTROLLED_TEST_PAYMENT_METHOD_PREFIX = 'controlled-test-payment-';
export const CONTROLLED_TEST_PAYMENT_METHOD_SQL_LIKE = `${CONTROLLED_TEST_PAYMENT_METHOD_PREFIX}%`;

export function isControlledTestPaymentMethod(method?: string | null): boolean {
    return method?.startsWith(CONTROLLED_TEST_PAYMENT_METHOD_PREFIX) ?? false;
}
