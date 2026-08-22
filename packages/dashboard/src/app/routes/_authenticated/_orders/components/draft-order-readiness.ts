export interface DraftOrderReadinessInput {
    hasCustomer: boolean;
    hasLines: boolean;
    requiresShipping: boolean;
    hasCompleteShippingAddress: boolean;
    hasShippingMethod: boolean;
    isDraftState: boolean;
}

export type DraftOrderIncompleteReason =
    'customer' | 'lines' | 'shippingAddress' | 'shippingMethod' | 'state';

export function getDraftOrderIncompleteReason({
    hasCustomer,
    hasLines,
    requiresShipping,
    hasCompleteShippingAddress,
    hasShippingMethod,
    isDraftState,
}: DraftOrderReadinessInput): DraftOrderIncompleteReason | null {
    if (!hasCustomer) {
        return 'customer';
    }
    if (!hasLines) {
        return 'lines';
    }
    if (requiresShipping && !hasCompleteShippingAddress) {
        return 'shippingAddress';
    }
    if (requiresShipping && !hasShippingMethod) {
        return 'shippingMethod';
    }
    if (!isDraftState) {
        return 'state';
    }
    return null;
}

export function orderLinesRequireShipping<T extends object>(lines: ReadonlyArray<T>): boolean {
    return lines.some(line => {
        const customFields = 'customFields' in line ? line.customFields : undefined;
        return (
            !customFields ||
            typeof customFields !== 'object' ||
            !('fulfillmentTypeSnapshot' in customFields) ||
            customFields.fulfillmentTypeSnapshot !== 'digital'
        );
    });
}

export function hasCompletePhysicalShippingAddress(
    address:
        | {
              fullName?: string | null;
              streetLine1?: string | null;
              city?: string | null;
              province?: string | null;
              postalCode?: string | null;
              countryCode?: string | null;
              phoneNumber?: string | null;
          }
        | null
        | undefined,
): boolean {
    return !!(
        address &&
        [
            address.fullName,
            address.streetLine1,
            address.city,
            address.province,
            address.postalCode,
            address.countryCode,
            address.phoneNumber,
        ].every(value => value?.trim())
    );
}
