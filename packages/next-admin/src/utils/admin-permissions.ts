export type AdminPermission = string;

interface RoutePermissionRule {
    prefix: string;
    permissions: AdminPermission[];
}

// More-specific prefixes must be declared before their parent sections.
const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
    { prefix: '/plugins/ai-access', permissions: ['SuperAdmin'] },
    {
        prefix: '/sales/orders/draft',
        permissions: ['CreateOrder', 'UpdateOrder', 'DeleteOrder'],
    },
    { prefix: '/settings/system-ops', permissions: ['ReadSystem', 'ReadApiKey'] },
    {
        prefix: '/settings/store-profile',
        permissions: ['ReadSettings', 'ReadChannel', 'ReadSeller', 'ReadPaymentMethod', 'ReadShippingMethod'],
    },
    { prefix: '/settings/team', permissions: ['ReadAdministrator'] },
    { prefix: '/catalog/inventory', permissions: ['ReadStockLocation', 'ReadCatalog'] },
    { prefix: '/catalog/assets', permissions: ['ReadAsset', 'ReadCatalog'] },
    { prefix: '/catalog/card-pool', permissions: ['ReadCatalog', 'ReadProduct'] },
    {
        prefix: '/catalog',
        permissions: ['ReadCatalog', 'ReadProduct', 'ReadCollection', 'ReadFacet'],
    },
    { prefix: '/sales', permissions: ['ReadOrder'] },
    { prefix: '/customers', permissions: ['ReadCustomer', 'ReadCustomerGroup'] },
    { prefix: '/marketing/promotions', permissions: ['ReadPromotion'] },
    {
        prefix: '/marketing/referrals',
        permissions: ['ReadPromotion', 'ReadCustomer', 'ReadOrder'],
    },
    { prefix: '/storefront', permissions: ['ReadSettings', 'ReadCatalog'] },
    { prefix: '/plugins/client-plugins', permissions: ['ReadSettings'] },
    { prefix: '/plugins/ai-settings', permissions: ['ReadSettings'] },
    { prefix: '/plugins/translations', permissions: ['ReadSettings', 'ReadCatalog'] },
    { prefix: '/operations', permissions: ['ReadSystem'] },
];

export function getRequiredPermissionsForAdminPath(pathname: string): AdminPermission[] {
    if (/^\/sales\/orders\/[^/]+\/modify$/.test(pathname)) return ['UpdateOrder'];
    return (
        ROUTE_PERMISSION_RULES.find(
            rule => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
        )?.permissions ?? []
    );
}

export function hasAnyAdminPermission(
    grantedPermissions: readonly AdminPermission[],
    requiredPermissions: readonly AdminPermission[],
): boolean {
    if (requiredPermissions.length === 0) return true;
    if (grantedPermissions.includes('SuperAdmin')) return true;
    return requiredPermissions.some(permission => grantedPermissions.includes(permission));
}

export function canAccessAdminPath(
    pathname: string,
    grantedPermissions: readonly AdminPermission[],
): boolean {
    return hasAnyAdminPermission(grantedPermissions, getRequiredPermissionsForAdminPath(pathname));
}
