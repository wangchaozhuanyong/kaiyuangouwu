/**
 * Source-controlled parity contract for all local Dashboard extension surfaces.
 * A legacy capability may only be removed after an explicit approved-deprecation
 * record is added. Redirecting an old URL to an unrelated landing page is not a
 * valid migrated state, so every entry also declares its exact destination.
 */
export interface LegacyRouteCapability {
    id: string;
    legacyPath: `/${string}`;
    target: `/${string}`;
    status: 'MIGRATED';
}

export const LEGACY_ROUTE_CAPABILITIES: LegacyRouteCapability[] = [
    { id: 'after-sales', legacyPath: '/after-sales', target: '/sales/after-sales', status: 'MIGRATED' },
    {
        id: 'auth-visuals',
        legacyPath: '/auth-visuals',
        target: '/storefront/content?tab=pages',
        status: 'MIGRATED',
    },
    { id: 'auto-card', legacyPath: '/auto-card', target: '/catalog/card-pool', status: 'MIGRATED' },
    {
        id: 'business-services-copy',
        legacyPath: '/business-services-copy',
        target: '/storefront/business-services-copy',
        status: 'MIGRATED',
    },
    {
        id: 'catalog-suppliers',
        legacyPath: '/catalog-suppliers',
        target: '/catalog/suppliers',
        status: 'MIGRATED',
    },
    {
        id: 'image-generation-access',
        legacyPath: '/image-generation-access',
        target: '/plugins/ai-access',
        status: 'MIGRATED',
    },
    {
        id: 'image-generation-settings',
        legacyPath: '/image-generation-settings',
        target: '/plugins/ai-settings',
        status: 'MIGRATED',
    },
    {
        id: 'manual-digital-delivery',
        legacyPath: '/manual-digital-delivery',
        target: '/operations/manual-digital-delivery',
        status: 'MIGRATED',
    },
    {
        id: 'my-store-domains',
        legacyPath: '/my-store-domains',
        target: '/settings/store-profile?tab=domains',
        status: 'MIGRATED',
    },
    {
        id: 'my-store-profile',
        legacyPath: '/my-store-profile',
        target: '/settings/store-profile',
        status: 'MIGRATED',
    },
    {
        id: 'referral-rewards',
        legacyPath: '/referral-rewards',
        target: '/marketing/referrals',
        status: 'MIGRATED',
    },
    {
        id: 'review-moderation',
        legacyPath: '/review-moderation',
        target: '/sales/reviews',
        status: 'MIGRATED',
    },
    {
        id: 'store-commerce-settings',
        legacyPath: '/store-commerce-settings',
        target: '/settings/store-profile?tab=stores',
        status: 'MIGRATED',
    },
    {
        id: 'store-coupons',
        legacyPath: '/store-coupons',
        target: '/marketing/promotions?tab=coupons',
        status: 'MIGRATED',
    },
    {
        id: 'store-currency-settings',
        legacyPath: '/store-currency-settings',
        target: '/settings/store-profile?tab=payment-shipping',
        status: 'MIGRATED',
    },
    {
        id: 'store-flash-sales',
        legacyPath: '/store-flash-sales',
        target: '/marketing/promotions?tab=flash-sales',
        status: 'MIGRATED',
    },
    {
        id: 'store-management',
        legacyPath: '/store-management',
        target: '/settings/store-profile',
        status: 'MIGRATED',
    },
    {
        id: 'store-promotion-campaigns',
        legacyPath: '/store-promotion-campaigns',
        target: '/marketing/promotions?tab=coupons',
        status: 'MIGRATED',
    },
    {
        id: 'store-provisioning',
        legacyPath: '/store-provisioning',
        target: '/settings/store-profile?tab=stores',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-carousel',
        legacyPath: '/storefront-carousel',
        target: '/storefront/decoration',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-client-plugins',
        legacyPath: '/storefront-client-plugins',
        target: '/plugins/client-plugins',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-content',
        legacyPath: '/storefront-content',
        target: '/storefront/content?tab=pages',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-navigation',
        legacyPath: '/storefront-navigation',
        target: '/storefront/decoration',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-promotion',
        legacyPath: '/storefront-promotion',
        target: '/storefront/content?tab=landing',
        status: 'MIGRATED',
    },
    {
        id: 'storefront-site-content',
        legacyPath: '/storefront-site-content',
        target: '/storefront/content?tab=pages',
        status: 'MIGRATED',
    },
    {
        id: 'system-announcements',
        legacyPath: '/system-announcements',
        target: '/storefront/content?tab=announcements',
        status: 'MIGRATED',
    },
    {
        id: 'two-factor-codes',
        legacyPath: '/two-factor-codes',
        target: '/plugins/two-factor-codes',
        status: 'MIGRATED',
    },
    {
        id: 'usdt-payment-management',
        legacyPath: '/usdt-payment-management',
        target: '/settings/usdt-payments',
        status: 'MIGRATED',
    },
];

export const LEGACY_EXTENSION_SURFACES = {
    actions: ['catalog-safe-import', 'catalog-standard-export', 'catalog-bulk-channels'],
    pageBlocks: [
        'catalog-product-operations',
        'product-variant-multi-currency-prices',
        'product-variant-custom-fields',
        'product-packaging',
        'order-payment-coupons-sellers',
    ],
    dashboardWidgets: ['referral-today-widget'],
    alerts: ['stale-content-translations'],
} as const;

export const LEGACY_SOURCE_SURFACE_CAPABILITIES = [
    { kind: 'action', legacyId: 'catalog-safe-import', targetId: 'catalog-safe-import', status: 'MIGRATED' },
    {
        kind: 'action',
        legacyId: 'catalog-browser-export',
        targetId: 'catalog-standard-export',
        status: 'MIGRATED',
    },
    {
        kind: 'pageBlock',
        legacyId: 'catalog-product-workspace',
        targetId: 'catalog-product-operations',
        status: 'MIGRATED',
    },
    { kind: 'pageBlock', legacyId: 'product-packaging', targetId: 'product-packaging', status: 'MIGRATED' },
    {
        kind: 'pageBlock',
        legacyId: 'store-coupon-order-allocations',
        targetId: 'order-payment-coupons-sellers',
        status: 'MIGRATED',
    },
    {
        kind: 'pageBlock',
        legacyId: 'store-domains',
        targetId: '/settings/store-profile?tab=domains',
        status: 'MIGRATED',
    },
    { kind: 'widget', legacyId: 'store-overview-widget', targetId: '/dashboard#metrics', status: 'MIGRATED' },
    { kind: 'widget', legacyId: 'operations-todo-widget', targetId: '/dashboard#todos', status: 'MIGRATED' },
    {
        kind: 'widget',
        legacyId: 'referral-today-widget',
        targetId: 'referral-today-widget',
        status: 'MIGRATED',
    },
    {
        kind: 'alert',
        legacyId: 'stale-content-translations',
        targetId: 'stale-content-translations',
        status: 'MIGRATED',
    },
] as const;

export const NATIVE_PARITY_CAPABILITIES = [
    { id: 'customer-create-delete-bulk-groups', route: '/customers/list', status: 'MIGRATED' },
    {
        id: 'generic-promotion-condition-action-editor',
        route: '/marketing/promotions?tab=generic',
        status: 'MIGRATED',
    },
    { id: 'product-variant-multi-currency-prices', route: '/catalog/products/:id', status: 'MIGRATED' },
    { id: 'product-bulk-channel-operations', route: '/catalog/list', status: 'MIGRATED' },
    { id: 'collection-filter-rules-preview', route: '/catalog/categories', status: 'MIGRATED' },
    { id: 'shipping-method-test', route: '/settings/store-profile?tab=payment-shipping', status: 'MIGRATED' },
    {
        id: 'api-key-name-role-custom-fields-editor',
        route: '/settings/system-ops?tab=api-keys',
        status: 'MIGRATED',
    },
    { id: 'asset-bulk-delete', route: '/catalog/assets', status: 'MIGRATED' },
    { id: 'inventory-bulk-price-and-state', route: '/catalog/inventory', status: 'MIGRATED' },
    {
        id: 'stock-location-bulk-delete-and-transfer',
        route: '/catalog/inventory?tab=warehouses',
        status: 'MIGRATED',
    },
    { id: 'dynamic-custom-fields-customer', route: '/customers/list', status: 'MIGRATED' },
    { id: 'dynamic-custom-fields-product-variant', route: '/catalog/products/:id', status: 'MIGRATED' },
    { id: 'dynamic-custom-fields-asset', route: '/catalog/assets', status: 'MIGRATED' },
    { id: 'dynamic-custom-fields-collection', route: '/catalog/categories', status: 'MIGRATED' },
    {
        id: 'dynamic-custom-fields-payment-method',
        route: '/settings/store-profile?tab=payment-shipping',
        status: 'MIGRATED',
    },
    {
        id: 'dynamic-custom-fields-shipping-method',
        route: '/settings/store-profile?tab=payment-shipping',
        status: 'MIGRATED',
    },
    { id: 'dynamic-custom-fields-seller', route: '/settings/store-profile?tab=sellers', status: 'MIGRATED' },
    { id: 'dynamic-custom-fields-api-key', route: '/settings/system-ops?tab=api-keys', status: 'MIGRATED' },
] as const;
