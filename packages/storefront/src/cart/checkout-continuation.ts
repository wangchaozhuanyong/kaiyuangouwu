import type { StorefrontCart, StorefrontCheckoutSession } from '../types';
import type { CartCheckoutIntent } from './cart-intents';

const consumedCommands = new WeakMap<object, Set<string>>();
const commandOwners = new WeakMap<object, Map<string, object>>();

export function registerCheckoutContinuationOwner(
    controller: object,
    commandId: string | null | undefined,
    apiOwner: object,
): void {
    if (!commandId) return;
    let owners = commandOwners.get(controller);
    if (!owners) {
        owners = new Map();
        commandOwners.set(controller, owners);
    }
    if (!owners.has(commandId)) owners.set(commandId, apiOwner);
}

export function checkoutContinuationOwnerMatches(
    controller: object,
    commandId: string | undefined,
    apiOwner: object,
): boolean {
    const owner = commandId && commandOwners.get(controller)?.get(commandId);
    return !owner || owner === apiOwner;
}

/** A recovery may continue only the current customer's current order projection. */
export function checkoutContinuationIsCurrent(
    session: StorefrontCheckoutSession,
    cart: StorefrontCart | null,
    customerId: string | undefined,
    intent: CartCheckoutIntent,
): boolean {
    if (
        !customerId ||
        !cart ||
        session.cart.id !== cart.id ||
        session.cart.revision !== cart.revision ||
        session.order.id !== cart.checkoutOrder?.id ||
        session.cart.checkoutOrder?.id !== session.order.id ||
        session.order.state !== cart.checkoutOrder.state ||
        session.order.currencyCode !== cart.checkoutOrder.currencyCode ||
        session.order.currencyCode !== session.cart.checkoutOrder.currencyCode ||
        session.order.customer?.id !== customerId ||
        cart.checkoutOrder.customer?.id !== customerId
    )
        return false;

    return intent === 'preparePayment'
        ? cart.state === 'PAYMENT_PENDING' &&
              session.checkout?.state === 'PREPARED' &&
              session.checkout.cartRevision === cart.revision &&
              session.order.state === 'ArrangingPayment'
        : cart.state === 'OPEN' && session.checkout == null && session.order.state === 'AddingItems';
}

/** Auth completion and controller recovery share one navigation claim, never another write. */
export function claimCheckoutContinuation(controller: object, commandId?: string): boolean {
    if (!commandId) return true;
    let consumed = consumedCommands.get(controller);
    if (!consumed) {
        consumed = new Set();
        consumedCommands.set(controller, consumed);
    }
    if (consumed.has(commandId)) return false;
    consumed.add(commandId);
    return true;
}
