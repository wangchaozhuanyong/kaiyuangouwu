/** Shared classification. Scope and mode never become broader because an account is SuperAdmin. */
export type AdminCapabilityScope = 'PLATFORM' | 'STORE' | 'BOTH' | 'PERSONAL';
export type AdminCommerceMode = 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
export type AdminCapabilityState = 'READY' | 'NEEDS_CONFIGURATION' | 'DISABLED' | 'UNSUPPORTED' | 'FORBIDDEN';
export interface AdminCapabilityDefinition {
    id: string;
    paths: readonly string[];
    scope: AdminCapabilityScope;
    writeScope?: 'PLATFORM' | 'STORE';
    modes?: readonly AdminCommerceMode[];
    readPermissions: readonly string[];
    readAllPermissions?: readonly string[];
    writePermissions: readonly string[];
    configurePermissions: readonly string[];
}
export interface AdminCapabilityStatus {
    id: string;
    state: AdminCapabilityState;
    canRead: boolean;
    canWrite: boolean;
    canConfigure: boolean;
}
export interface AdminCapabilitySnapshot {
    channelId: string;
    channelCode: string;
    scope: 'PLATFORM' | 'STORE';
    commerceMode: AdminCommerceMode | null;
    capabilities: readonly AdminCapabilityStatus[];
}
const physical: readonly AdminCommerceMode[] = ['PHYSICAL_ONLY', 'HYBRID'];
const digital: readonly AdminCommerceMode[] = ['DIGITAL_ONLY', 'HYBRID'];
function page(
    path: string,
    scope: AdminCapabilityScope,
    readPermissions: readonly string[],
    writePermissions: readonly string[] = [],
    modes?: readonly AdminCommerceMode[],
): AdminCapabilityDefinition {
    return {
        id: path,
        paths: [path],
        scope,
        readPermissions,
        writePermissions,
        configurePermissions: writePermissions,
        modes,
    };
}
function section(
    prefix: string,
    keys: readonly string[],
    scope: AdminCapabilityScope,
    read: readonly string[],
    write: readonly string[] = [],
    modes?: readonly AdminCommerceMode[],
) {
    return keys.map(key => page(`${prefix}/${key}`, scope, read, write, modes));
}
export const ADMIN_CAPABILITY_DEFINITIONS: readonly AdminCapabilityDefinition[] = [
    page('/dashboard', 'BOTH', []),
    page('/profile', 'PERSONAL', []),
    page('/plugins/two-factor-codes', 'PERSONAL', []),
    page('/platform/catalog', 'PLATFORM', ['ManagePlatformCatalog'], ['ManagePlatformCatalog']),
    {
        ...page('/catalog/list', 'BOTH', ['ReadProduct', 'ReadCatalog'], ['CreateProduct', 'UpdateProduct']),
        writeScope: 'STORE',
    },
    page('/catalog/products/new', 'STORE', ['CreateProduct'], ['CreateProduct']),
    {
        ...page('/catalog/products', 'BOTH', ['ReadProduct', 'ReadCatalog'], ['UpdateProduct']),
        writeScope: 'STORE',
    },
    page(
        '/catalog/assets',
        'STORE',
        ['ReadAsset', 'ReadCatalog'],
        ['CreateAsset', 'UpdateAsset', 'DeleteAsset'],
    ),
    page(
        '/catalog/categories/categories',
        'STORE',
        ['ReadCollection'],
        ['CreateCollection', 'UpdateCollection'],
    ),
    page(
        '/catalog/categories/options',
        'STORE',
        ['ReadProduct', 'ReadCatalog'],
        ['CreateProduct', 'UpdateProduct'],
    ),
    page('/catalog/categories/facets', 'STORE', ['ReadFacet'], ['CreateFacet', 'UpdateFacet']),
    ...section(
        '/catalog/inventory',
        ['all', 'skus', 'movements', 'lots', 'warehouses'],
        'STORE',
        ['ReadStockLocation', 'ReadCatalogOperations', 'ReadProduct'],
        ['UpdateProduct', 'UpdateStockLocation', 'CreateStockLocation'],
        physical,
    ),
    ...section(
        '/catalog/card-pool',
        ['pool', 'deliveries'],
        'STORE',
        ['ReadProduct', 'ReadCatalog'],
        ['UpdateProduct'],
        digital,
    ),
    page(
        '/catalog/suppliers',
        'STORE',
        ['ReadCatalogSupplier'],
        ['CreateCatalogSupplier', 'UpdateCatalogSupplier'],
    ),
    page(
        '/catalog/purchase-orders',
        'STORE',
        ['ReadCatalogSupplier', 'ReadCatalogOperations'],
        ['CreateCatalogOperations', 'UpdateCatalogOperations'],
        physical,
    ),
    page(
        '/catalog/inventory-control',
        'STORE',
        ['ReadCatalogOperations'],
        ['UpdateCatalogOperations'],
        physical,
    ),
    page('/sales/orders/draft', 'STORE', ['CreateOrder'], ['CreateOrder', 'UpdateOrder']),
    { ...page('/sales/orders', 'BOTH', ['ReadOrder'], ['UpdateOrder']), writeScope: 'STORE' },
    {
        ...page('/sales/profit', 'BOTH', ['ReadOrder'], ['UpdateCatalogOperations']),
        readAllPermissions: ['ReadOrder', 'ReadCatalogOperations'],
        writeScope: 'STORE',
    },
    page('/sales/after-sales', 'STORE', ['ReadOrder'], ['UpdateOrder']),
    page('/sales/reviews', 'STORE', ['ReadOrder'], ['UpdateOrder']),
    page('/sales/customer-service-feedback', 'BOTH', ['ReadCustomer'], ['UpdateCustomer']),
    page(
        '/customers/list',
        'STORE',
        ['ReadCustomer', 'ReadCustomerGroup'],
        ['CreateCustomer', 'UpdateCustomer'],
    ),
    page('/operations/manual-digital-delivery', 'STORE', ['ReadOrder'], ['UpdateOrder'], digital),
    ...section(
        '/marketing/promotions',
        ['coupons', 'flash-sales', 'report', 'ledger', 'attribution'],
        'STORE',
        ['ReadPromotion'],
        ['CreatePromotion', 'UpdatePromotion'],
    ),
    page(
        '/marketing/promotions/generic',
        'PLATFORM',
        ['ReadPromotion'],
        ['CreatePromotion', 'UpdatePromotion'],
    ),
    ...section(
        '/marketing/referrals',
        ['settings', 'promoters', 'relationships', 'rewards', 'ledger', 'withdrawals'],
        'STORE',
        ['ReadReferral'],
        ['UpdateReferral'],
    ),
    page('/marketing/sharing', 'STORE', ['ReadReferral'], ['UpdateReferral']),
    page('/storefront/decoration', 'STORE', ['ReadStorefrontContent'], ['UpdateStorefrontContent']),
    ...section(
        '/storefront/content',
        ['pages', 'landing'],
        'STORE',
        ['ReadStorefrontContent'],
        ['UpdateStorefrontContent'],
    ),
    page(
        '/storefront/content/announcements',
        'BOTH',
        ['ReadStorefrontContent'],
        ['CreateStorefrontContent', 'UpdateStorefrontContent'],
    ),
    page(
        '/storefront/business-services-copy',
        'STORE',
        ['ReadStorefrontContent'],
        ['UpdateStorefrontContent'],
    ),
    page('/plugins/client-plugins', 'STORE', ['ReadStorefrontContent'], ['UpdateStorefrontContent']),
    ...section(
        '/plugins/ai-settings',
        ['config', 'jobs', 'usage'],
        'STORE',
        ['ReadSettings', 'ReadImageGeneration'],
        ['UpdateSettings', 'UpdateStoreProfile'],
    ),
    {
        ...page(
            '/plugins/ai-settings/skills',
            'PLATFORM',
            ['ReadSettings', 'ReadImageGeneration'],
            ['UpdateSettings'],
        ),
        writeScope: 'PLATFORM',
    },
    page(
        '/plugins/ai-access',
        'PLATFORM',
        ['ReviewStoreGovernance', 'SuperAdmin'],
        ['ReviewStoreGovernance', 'SuperAdmin'],
    ),
    page('/plugins/translations', 'BOTH', ['ReadSettings', 'ReadCatalog'], ['UpdateSettings']),
    page('/plugins/icloud-relay', 'PLATFORM', ['SuperAdmin'], ['SuperAdmin']),
    page('/settings/incident-response', 'PLATFORM', ['ReadSettings'], ['UpdateSettings']),
    ...section(
        '/settings/team',
        ['members', 'roles'],
        'BOTH',
        ['ReadAdministrator', 'ManageStoreTeam', 'ManagePlatformTeam'],
        ['ManageStoreTeam', 'ManagePlatformTeam'],
    ),
    ...section(
        '/settings/system-ops',
        ['health', 'jobs', 'schedules', 'settings'],
        'PLATFORM',
        ['ReadSystem'],
        ['UpdateSystem'],
    ),
    page('/settings/system-ops/telegram', 'PLATFORM', ['SuperAdmin'], ['SuperAdmin']),
    page('/settings/system-ops/api-keys', 'PLATFORM', ['ReadApiKey'], ['CreateApiKey', 'UpdateApiKey']),
    ...section(
        '/settings/governance-risk',
        ['rules', 'approvals', 'cases', 'report-schedule', 'audit', 'reports'],
        'PLATFORM',
        ['SuperAdmin'],
        ['SuperAdmin'],
    ),
    page(
        '/settings/store-profile/stores',
        'BOTH',
        ['ReadStoreProfile', 'ManageStoreLifecycle'],
        ['UpdateStoreProfile', 'ManageStoreLifecycle'],
    ),
    page(
        '/settings/store-profile/review',
        'PLATFORM',
        ['ReviewStoreGovernance', 'ManageStoreLifecycle'],
        ['ReviewStoreGovernance'],
    ),
    page('/settings/store-profile/commerce', 'STORE', ['ReadStoreProfile'], ['UpdateStoreProfile']),
    page(
        '/settings/store-profile/domains',
        'BOTH',
        ['ReadStoreDomain', 'ReadStoreProfile', 'ManageStoreLifecycle'],
        ['UpdateStoreDomain', 'ManageStoreLifecycle'],
    ),
    page(
        '/settings/store-profile/sellers',
        'BOTH',
        ['ReadSeller', 'ReadStoreProfile'],
        ['UpdateStoreProfile'],
    ),
    page(
        '/settings/store-profile/shipping',
        'BOTH',
        ['ReadShippingMethod', 'ReadStoreProfile'],
        ['CreateShippingMethod', 'UpdateShippingMethod'],
        physical,
    ),
    page(
        '/settings/store-profile/payment',
        'BOTH',
        ['ReadPaymentMethod', 'ReadStoreProfile'],
        ['UpdatePaymentMethod', 'UpdateStoreProfile'],
    ),
    ...section(
        '/settings/store-profile',
        ['payout', 'currency', 'usdt', 'usdt-payments', 'usdt-refunds', 'usdt-intents'],
        'BOTH',
        ['ReadStoreProfile', 'ManageStoreLifecycle'],
        ['UpdateStoreProfile'],
    ),
    page('/settings/store-profile/audits', 'PLATFORM', ['ManagePlatformTeam', 'SuperAdmin']),
    page('/settings/store-profile/business-global', 'PLATFORM', ['ReadSettings'], ['UpdateSettings']),
    page(
        '/settings/store-profile/business-language',
        'BOTH',
        ['ReadChannel', 'ReadStoreProfile'],
        ['UpdateStoreProfile', 'UpdateChannel'],
    ),
    page(
        '/settings/store-profile/business-taxes',
        'BOTH',
        ['ReadTaxCategory', 'ReadTaxRate', 'ReadStoreProfile'],
        ['UpdateStoreProfile'],
    ),
    page(
        '/settings/store-profile/business-regions',
        'BOTH',
        ['ReadCountry', 'ReadZone', 'ReadStoreProfile'],
        ['UpdateStoreProfile'],
    ),
    ...section(
        '/settings/usdt-payments',
        ['wallets', 'payments', 'intents', 'refunds'],
        'PLATFORM',
        ['SuperAdmin'],
        ['SuperAdmin'],
    ),
    ...section(
        '/settings/data-management',
        ['retention', 'exports', 'account-closures', 'consents'],
        'PLATFORM',
        ['SuperAdmin'],
        ['SuperAdmin'],
    ),
    ...[
        ['catalog.import', ['CreateCatalogImport']],
        ['catalog.export', ['ReadCatalogExport']],
        ['catalog.operations', ['ReadCatalogOperations']],
        ['catalog.bulk-sales', ['ManagePlatformCatalog']],
        ['catalog.packaging', ['ReadProduct']],
        ['dashboard.traffic', ['ReadReferral']],
        ['dashboard.referrals', ['ReadCustomer', 'ReadOrder']],
        ['dashboard.translations', ['ReadSettings', 'ReadCatalog']],
    ].map(([id, permissions]) => ({
        ...page(
            String(id),
            id === 'catalog.bulk-sales' ? 'PLATFORM' : 'STORE',
            permissions as string[],
            permissions as string[],
            id === 'catalog.packaging' ? physical : undefined,
        ),
        paths: [],
    })),
];

/** Longest matching route wins, including create routes before broad detail/list rules. */
export function adminCapabilityForPath(pathname: string) {
    const path = pathname.split(/[?#]/u, 1)[0].replace(/\/+$/u, '');
    return ADMIN_CAPABILITY_DEFINITIONS.filter(definition =>
        definition.paths.some(prefix => path === prefix || path.startsWith(prefix + '/')),
    ).sort((a, b) => Math.max(...b.paths.map(p => p.length)) - Math.max(...a.paths.map(p => p.length)))[0];
}
export function adminCapabilityScopeAllows(
    definition: AdminCapabilityDefinition,
    scope: 'PLATFORM' | 'STORE',
    mode: AdminCommerceMode | null,
) {
    if (definition.scope !== 'PERSONAL' && definition.scope !== 'BOTH' && definition.scope !== scope)
        return false;
    // A platform template can be maintained without a sales mode. Store mode must be known.
    return scope === 'PLATFORM' || !definition.modes || (mode !== null && definition.modes.includes(mode));
}
export function adminCapabilityAllows(
    snapshot: AdminCapabilitySnapshot | null | undefined,
    id: string,
    operation: 'read' | 'write' | 'configure' = 'read',
) {
    const status = snapshot?.capabilities.find(item => item.id === id);
    if (!status || status.state === 'UNSUPPORTED' || status.state === 'FORBIDDEN') return false;
    return operation === 'write'
        ? status.canWrite
        : operation === 'configure'
          ? status.canConfigure
          : status.canRead;
}
