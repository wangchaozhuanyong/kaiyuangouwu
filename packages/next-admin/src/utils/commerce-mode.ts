import type {
    DigitalDeliveryMode,
    DigitalStockPolicy,
    FulfillmentType,
    StoreCommerceMode,
} from '../graphql/commerce.graphql';

export const fulfillmentTypeForMode = (mode: StoreCommerceMode): FulfillmentType | null =>
    mode === 'DIGITAL_ONLY' ? 'digital' : mode === 'PHYSICAL_ONLY' ? 'physical' : null;

export const commerceModeAllowsPath = (mode: StoreCommerceMode, path: string) => {
    if (mode === 'DIGITAL_ONLY' && path.startsWith('/catalog/inventory')) return false;
    if (mode === 'PHYSICAL_ONLY' && path.startsWith('/catalog/card-pool')) return false;
    return true;
};

export const stockPolicyForDeliveryMode = (
    mode: DigitalDeliveryMode,
    current: DigitalStockPolicy = 'limited',
): DigitalStockPolicy => {
    if (mode === 'auto_card') return 'pool_derived';
    if (mode === 'manual_service') return 'limited';
    return current === 'unlimited' ? 'unlimited' : 'limited';
};

export const trackInventoryForDigitalVariant = (mode: DigitalDeliveryMode, policy: DigitalStockPolicy) =>
    mode === 'auto_card' || policy === 'unlimited' ? 'FALSE' : 'TRUE';

export const collectionSummary = (collections: ReadonlyArray<{ name: string }> | undefined) => {
    if (!collections?.length) return { primary: '未分类', extraCount: 0 };
    return { primary: collections[0].name, extraCount: Math.max(0, collections.length - 1) };
};
