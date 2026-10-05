import { getStandaloneAdminPage } from '../navigation/admin-navigation';
const BUILT_IN_MENU_ROUTES = [
    ['/catalog/inventory', 'physical-inventory'],
    ['/catalog/card-pool', 'digital-delivery'],
    ['/operations/manual-digital-delivery', 'digital-delivery'],
    ['/catalog', 'catalog'],
    ['/sales', 'sales'],
    ['/marketing', 'marketing'],
    ['/storefront', 'storefront'],
    ['/plugins', 'plugins'],
    ['/settings', 'settings'],
] as const;

const PLATFORM_BLOCKED_BUSINESS_PREFIXES = [
    '/catalog',
    '/sales',
    '/customers',
    '/marketing',
    '/storefront',
] as const;

export function isPlatformManagementChannel(code?: string | null) {
    return /^_+default_channel_+$/iu.test(code?.trim() ?? '');
}

export function isPlatformBusinessPath(pathname: string) {
    return PLATFORM_BLOCKED_BUSINESS_PREFIXES.some(
        prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export function isPlatformOwnerPath(pathname: string) {
    return ['/plugins/ai-access', '/plugins/icloud-relay', '/icloud-relay'].some(
        prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

interface AppShellPermissionSnapshot {
    activeChannel?: { id: string } | null;
    me?: {
        channels: ReadonlyArray<{
            id: string;
            permissions: readonly string[];
        }>;
    } | null;
}

interface ChannelIdentity {
    id: string;
}

export function filterAccessibleAdminChannels<T extends ChannelIdentity>(
    channels: readonly T[],
    administratorChannels: ReadonlyArray<ChannelIdentity>,
    isSuperAdmin = false,
) {
    if (isSuperAdmin) return [...channels];
    const accessibleChannelIds = new Set(administratorChannels.map(channel => channel.id));
    return channels.filter(channel => accessibleChannelIds.has(channel.id));
}

export function resolveAppShellOpenMenu(pathname: string, extensionSectionId?: string) {
    if (pathname.startsWith('/operations/manual-digital-delivery')) return 'digital-delivery';
    const extensionMenu = extensionSectionId?.trim();
    if (extensionMenu) return extensionMenu;
    const page = getStandaloneAdminPage(pathname);
    if (page) return page.section;
    if (
        ['/sales/after-sales', '/sales/reviews', '/sales/customer-service-feedback'].some(
            path => pathname === path || pathname.startsWith(path + '/'),
        )
    )
        return 'after-sales';
    if (pathname === '/dashboard' || pathname.startsWith('/customers')) return null;
    return BUILT_IN_MENU_ROUTES.find(([prefix]) => pathname.startsWith(prefix))?.[1];
}

export function hasAppShellPermissionSnapshot(data?: AppShellPermissionSnapshot) {
    const activeChannelId = data?.activeChannel?.id;
    return Boolean(activeChannelId && data?.me?.channels.some(channel => channel.id === activeChannelId));
}

export function isAppShellPermissionLoading(data: AppShellPermissionSnapshot | undefined, loading: boolean) {
    return loading && !hasAppShellPermissionSnapshot(data);
}
