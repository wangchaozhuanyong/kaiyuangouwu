const BUILT_IN_MENU_ROUTES = [
    ['/catalog', 'catalog'],
    ['/sales', 'sales'],
    ['/marketing', 'marketing'],
    ['/storefront', 'storefront'],
    ['/plugins', 'plugins'],
    ['/settings', 'settings'],
] as const;

interface AppShellPermissionSnapshot {
    activeChannel?: { id: string } | null;
    me?: {
        channels: ReadonlyArray<{
            id: string;
            permissions: readonly string[];
        }>;
    } | null;
}

export function resolveAppShellOpenMenu(pathname: string, extensionSectionId?: string) {
    const extensionMenu = extensionSectionId?.trim();
    if (extensionMenu) return extensionMenu;
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
