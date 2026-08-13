// Digital fulfillment is created automatically after payment and is not a shipping method.
const NON_SHIPPING_FULFILLMENT_HANDLER_CODES = new Set(['digital-fulfillment']);

interface FulfillmentHandlerOption {
    code: string;
}

export function getShippingMethodFulfillmentHandlers<T extends FulfillmentHandlerOption>(
    handlers: readonly T[],
): T[] {
    return handlers.filter(handler => !NON_SHIPPING_FULFILLMENT_HANDLER_CODES.has(handler.code));
}

export function isShippingMethodFulfillmentHandler(code: string): boolean {
    return !NON_SHIPPING_FULFILLMENT_HANDLER_CODES.has(code);
}
