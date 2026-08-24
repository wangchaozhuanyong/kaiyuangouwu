export type FulfillmentType = 'physical' | 'digital';

export type ProductFulfillmentType = FulfillmentType | 'mixed';

export interface VariantWithFulfillmentType {
    customFields?: unknown;
}

export function getVariantFulfillmentType(variant: VariantWithFulfillmentType): FulfillmentType {
    if (
        variant.customFields &&
        typeof variant.customFields === 'object' &&
        'fulfillmentType' in variant.customFields &&
        variant.customFields.fulfillmentType === 'digital'
    ) {
        return 'digital';
    }
    return 'physical';
}

export function getProductFulfillmentType(
    variants: ReadonlyArray<VariantWithFulfillmentType>,
): ProductFulfillmentType {
    if (variants.length === 0) {
        return 'physical';
    }

    const firstType = getVariantFulfillmentType(variants[0]);
    return variants.every(variant => getVariantFulfillmentType(variant) === firstType) ? firstType : 'mixed';
}

export function getUpdatedFulfillmentCustomFields(
    customFields: unknown,
    fulfillmentType: FulfillmentType,
): Record<string, unknown> {
    return {
        ...(customFields && typeof customFields === 'object' ? customFields : {}),
        fulfillmentType,
    };
}
