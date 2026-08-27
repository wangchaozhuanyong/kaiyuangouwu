export type FulfillmentType = 'physical' | 'digital';
export type DigitalDeliveryMode = 'manual_service' | 'file_download' | 'auto_card';

export type ProductFulfillmentType = FulfillmentType | 'mixed';

export interface VariantWithFulfillmentType {
    customFields?: unknown;
}

export function getNewVariantInventoryInput(stockOnHand: number) {
    return {
        stockOnHand,
        trackInventory: 'INHERIT' as const,
    };
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

export function getVariantDigitalDeliveryMode(variant: VariantWithFulfillmentType): DigitalDeliveryMode {
    if (variant.customFields && typeof variant.customFields === 'object') {
        const deliveryMode =
            'digitalDeliveryMode' in variant.customFields
                ? variant.customFields.digitalDeliveryMode
                : undefined;
        if (
            deliveryMode === 'manual_service' ||
            deliveryMode === 'file_download' ||
            deliveryMode === 'auto_card'
        ) {
            return deliveryMode;
        }
    }
    return 'manual_service';
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
    digitalDeliveryMode?: DigitalDeliveryMode,
): Record<string, unknown> {
    const currentCustomFields = customFields && typeof customFields === 'object' ? customFields : {};
    const wasDigital =
        'fulfillmentType' in currentCustomFields && currentCustomFields.fulfillmentType === 'digital';
    return {
        ...currentCustomFields,
        fulfillmentType,
        ...(fulfillmentType === 'digital'
            ? {
                  digitalDeliveryMode:
                      digitalDeliveryMode ??
                      (wasDigital
                          ? getVariantDigitalDeliveryMode({ customFields: currentCustomFields })
                          : 'manual_service'),
              }
            : {}),
    };
}
