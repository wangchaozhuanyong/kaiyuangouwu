const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type OrderFulfillmentType = 'PHYSICAL' | 'DIGITAL' | 'MIXED';

export function shouldSendOrderConfirmation(fulfillmentType: OrderFulfillmentType): boolean {
    return fulfillmentType !== 'DIGITAL';
}

export function normalizeDeliveryEmail(value: string | null | undefined): string | undefined {
    const email = value?.trim().toLowerCase();
    return email && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : undefined;
}

export function buildOrderConfirmationUrl(storefrontUrl: string, orderCode: string, token: string): string {
    const orderId = encodeURIComponent(orderCode);
    const confirmationToken = encodeURIComponent(token);
    return `${storefrontUrl}/#/order-confirmation?id=${orderId}&token=${confirmationToken}`;
}
