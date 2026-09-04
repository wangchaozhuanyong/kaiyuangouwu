export const routeModuleLoaders = {
    profile: () => import('./pages/Auth/ProfileModule'),
    dashboard: () => import('./pages/Dashboard/DashboardModule'),
    catalog: () => import('./pages/Catalog/CatalogModule'),
    suppliers: () => import('./pages/Catalog/SuppliersModule'),
    productEditor: () => import('./pages/Catalog/ProductEditor'),
    categories: () => import('./pages/Catalog/CategoriesModule'),
    inventory: () => import('./pages/Catalog/InventoryWarehouseModule'),
    cardPool: () => import('./pages/Sales/CardPoolModule'),
    assets: () => import('./pages/Catalog/AssetsModule'),
    sales: () => import('./pages/Sales/SalesModule'),
    orderEditor: () => import('./pages/Sales/OrderEditor'),
    orderWorkflow: () => import('./pages/Sales/OrderWorkflowEditor'),
    afterSales: () => import('./pages/Sales/AfterSalesModule'),
    reviews: () => import('./pages/Storefront/ReviewsModule'),
    customers: () => import('./pages/Customers/CustomersModule'),
    promotions: () => import('./pages/Marketing/PromotionsModule'),
    referrals: () => import('./pages/Marketing/ReferralsModule'),
    storefront: () => import('./pages/Storefront/StorefrontModule'),
    storefrontContent: () => import('./pages/Storefront/StorefrontContentModule'),
    businessServicesCopy: () => import('./pages/Storefront/BusinessServicesCopyModule'),
    clientPlugins: () => import('./pages/Plugins/ClientPluginsModule'),
    twoFactorCodes: () => import('./pages/Plugins/TwoFactorCodesModule'),
    aiImageSettings: () => import('./pages/Plugins/AiImageSettingsModule'),
    aiImageAccess: () => import('./pages/Plugins/AiImageAccessModule'),
    translations: () => import('./pages/Settings/TranslationsModule'),
    storeSettings: () => import('./pages/Settings/StoreSettingsModule'),
    usdtPayments: () => import('./pages/Settings/UsdtPaymentManagementModule'),
    roles: () => import('./pages/Settings/RolesModule'),
    systemOps: () => import('./pages/Settings/SystemOpsModule'),
} as const;

export type RouteModuleKey = keyof typeof routeModuleLoaders;

export function getRouteModuleKey(target: string): RouteModuleKey | null {
    const pathname = target.split(/[?#]/, 1)[0] || '/';

    if (pathname === '/dashboard' || pathname === '/') return 'dashboard';
    if (pathname === '/profile') return 'profile';
    if (pathname.startsWith('/catalog/products/')) return 'productEditor';
    if (pathname === '/catalog/suppliers') return 'suppliers';
    if (pathname === '/catalog/categories') return 'categories';
    if (pathname === '/catalog/inventory') return 'inventory';
    if (pathname === '/catalog/card-pool') return 'cardPool';
    if (pathname === '/catalog/assets') return 'assets';
    if (pathname.startsWith('/catalog')) return 'catalog';
    if (/^\/sales\/orders\/draft\/[^/]+$/.test(pathname)) return 'orderWorkflow';
    if (/^\/sales\/orders\/[^/]+\/modify$/.test(pathname)) return 'orderWorkflow';
    if (/^\/sales\/orders\/[^/]+$/.test(pathname)) return 'orderEditor';
    if (pathname === '/sales/after-sales') return 'afterSales';
    if (pathname === '/sales/reviews') return 'reviews';
    if (pathname.startsWith('/sales')) return 'sales';
    if (pathname.startsWith('/customers')) return 'customers';
    if (pathname === '/marketing/referrals') return 'referrals';
    if (pathname.startsWith('/marketing')) return 'promotions';
    if (pathname === '/storefront/content') return 'storefrontContent';
    if (pathname === '/storefront/business-services-copy') return 'businessServicesCopy';
    if (pathname.startsWith('/storefront')) return 'storefront';
    if (pathname === '/plugins/ai-settings') return 'aiImageSettings';
    if (pathname === '/plugins/ai-access') return 'aiImageAccess';
    if (pathname === '/plugins/translations') return 'translations';
    if (pathname === '/plugins/two-factor-codes') return 'twoFactorCodes';
    if (pathname.startsWith('/plugins')) return 'clientPlugins';
    if (pathname === '/settings/team') return 'roles';
    if (pathname === '/settings/system-ops') return 'systemOps';
    if (pathname === '/settings/usdt-payments') return 'usdtPayments';
    if (pathname.startsWith('/settings')) return 'storeSettings';
    return null;
}

export function preloadRoute(target: string) {
    const moduleKey = getRouteModuleKey(target);
    if (!moduleKey) return;
    void routeModuleLoaders[moduleKey]().catch(() => undefined);
}

export function preloadCommonRoutes() {
    preloadRoute('/dashboard');
    preloadRoute('/catalog/list');
    preloadRoute('/sales/orders');
    preloadRoute('/customers/list');
}

export const SETTINGS_ROUTE_PRELOAD_TARGETS = [
    '/settings/store-profile',
    '/settings/team',
    '/settings/system-ops',
    '/settings/usdt-payments',
] as const;

export function preloadSettingsRoutes() {
    SETTINGS_ROUTE_PRELOAD_TARGETS.forEach(preloadRoute);
}
