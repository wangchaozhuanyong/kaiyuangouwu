import type { CustomerAddressInput, StorefrontCart, StorefrontCheckoutSession } from '../types';

export interface CartChanges {
    add?: Array<{ productVariantId: string; quantity: number }>;
    lines?: Array<{ lineId: string; quantity?: number; selected?: boolean }>;
    remove?: string[];
}
export type CartOperation =
    | { changes: CartChanges }
    | { buyNow: { productVariantId: string; quantity: number } }
    | { beginCheckout: true }
    | { preparePayment: true }
    | { reopen: true }
    | {
          order:
              | { note: string }
              | { currencyCode: string }
              | { shippingAddress: CustomerAddressInput }
              | { shippingMethodId: string }
              | { customer: Record<string, string> };
      }
    | {
          coupon: {
              action: 'APPLY' | 'REMOVE' | 'BEST' | 'APPLY_CODE' | 'REMOVE_CODE';
              couponId?: string;
              code?: string;
          };
      }
    | {
          deliveryEmail: {
              contactId?: string;
              emailAddress?: string;
              confirmEmailAddress?: string;
              label?: string;
              saveToAddressBook?: boolean;
              isDefault?: boolean;
          };
      };
export type CartCommand = CartOperation & { commandId: string; cartId: string; expectedRevision: number };
export interface CartCommandResult {
    commandId: string;
    status: 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'NOT_FOUND';
    appliedRevision: number | null;
    errorCode: string | null;
    message: string | null;
    cart: StorefrontCart;
    session: StorefrontCheckoutSession | null;
}

/** Only adjacent, unsent line edits coalesce. Additions and order operations are barriers. */
export function mergeChanges(previous: CartChanges, incoming: CartChanges): CartChanges {
    const remove = new Set([...(previous.remove ?? []), ...(incoming.remove ?? [])]);
    const lines = new Map((previous.lines ?? []).map(line => [line.lineId, { ...line }]));
    for (const line of incoming.lines ?? []) lines.set(line.lineId, { ...lines.get(line.lineId), ...line });
    return { lines: [...lines.values()].filter(line => !remove.has(line.lineId)), remove: [...remove] };
}

export function cartView(
    confirmed: StorefrontCart | null,
    operations: CartOperation[],
): StorefrontCart | null {
    if (!confirmed) return null;
    let lines = confirmed.lines;
    for (const operation of operations) {
        if (!('changes' in operation)) continue;
        const { changes } = operation;
        const remove = new Set(changes.remove);
        const updates = new Map(changes.lines?.map(line => [line.lineId, line]));
        lines = lines
            .filter(line => !remove.has(line.id))
            .map(line => {
                const update = updates.get(line.id);
                return update
                    ? {
                          ...line,
                          quantity: update.quantity ?? line.quantity,
                          selected: update.selected ?? line.selected,
                      }
                    : line;
            });
    }
    const selected = lines.filter(line => line.selected);
    return {
        ...confirmed,
        lines,
        totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
        selectedQuantity: selected.reduce((total, line) => total + line.quantity, 0),
        selectedLineCount: selected.length,
        selectionState: !selected.length ? 'NONE' : selected.length === lines.length ? 'ALL' : 'PARTIAL',
    };
}
