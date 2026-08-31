import { StoreCommerceMode } from './store-commerce.graphql';

const navigationIdsByMode: Record<Exclude<StoreCommerceMode, 'HYBRID'>, readonly string[]> = {
    DIGITAL_ONLY: ['product-variants', 'stock-locations', 'shipping-methods'],
    PHYSICAL_ONLY: ['auto-card-delivery', 'manual-digital-delivery'],
};

export function hiddenNavigationIds(mode: StoreCommerceMode): readonly string[] {
    return mode === 'HYBRID' ? [] : navigationIdsByMode[mode];
}
