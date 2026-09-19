const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type EmailHandlerWithType = { type: string };

/**
 * Paid orders must not send a generic confirmation email. Customer-facing order mail is emitted
 * by the concrete delivery workflows (for example auto-card or manual digital delivery) only
 * after the purchased content is actually ready.
 */
export function deliveryOnlyEmailHandlers<T extends EmailHandlerWithType>(handlers: readonly T[]): T[] {
    return handlers.filter(handler => handler.type !== 'order-confirmation');
}

export function normalizeDeliveryEmail(value: string | null | undefined): string | undefined {
    const email = value?.trim().toLowerCase();
    return email && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : undefined;
}

export function orderConfirmationRecipient(
    containsDigitalProducts: boolean,
    deliveryEmail: string | null | undefined,
    customerEmail: string,
): string {
    return (containsDigitalProducts && normalizeDeliveryEmail(deliveryEmail)) || customerEmail;
}

export function buildOrderConfirmationUrl(storefrontUrl: string, orderCode: string, token: string): string {
    const orderId = encodeURIComponent(orderCode);
    const confirmationToken = encodeURIComponent(token);
    return `${storefrontUrl}/#/order-confirmation?id=${orderId}&token=${confirmationToken}`;
}
