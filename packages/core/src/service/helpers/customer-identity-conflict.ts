/** Only the customer namespace constraint is an idempotent registration collision. */
export function isCustomerIdentityConflict(error: unknown): boolean {
    if (typeof error !== 'object' || !error) return false;
    const value = error as { code?: string; constraint?: string; message?: string; driverError?: unknown };
    if (value.driverError && isCustomerIdentityConflict(value.driverError)) return true;
    return (
        ['ER_DUP_ENTRY', '23505', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(
            value.code ?? '',
        ) &&
        (value.constraint === 'IDX_user_customer_identifier' ||
            (value.message ?? '').includes('IDX_user_customer_identifier') ||
            (value.message ?? '').includes('user.customerIdentifier'))
    );
}
