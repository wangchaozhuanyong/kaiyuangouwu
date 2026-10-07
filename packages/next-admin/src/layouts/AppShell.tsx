import {
    adminCapabilityAllows,
    adminCapabilityForPath,
    adminCapabilityScopeAllows,
} from '../../../common/src/admin-capabilities';
import { AdminButton, AdminInput, AdminSelect } from '../components/AdminControls';
import { AdminField } from '../components/AdminField';
import {
    ADMIN_NAV_SECTIONS,
    CORE_ADMIN_NAV_ITEMS as coreNavItems,
    getAdminSectionLabel,
    getStandaloneAdminRedirect,
    localizeAdminNavigationTitle,
} from '../navigation/admin-navigation';
import { getAdminDisplayLanguage } from '../utils/admin-language';
import { getChannelDisplayName } from '../utils/channel-display';
/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
    Blocks,
    Boxes,
    ChevronDown,
    CircleDollarSign,
    Command,
    CornerDownLeft,
    Database,
    LayoutDashboard,
    LogOut,
    Menu,
    Monitor,
    Moon,
    Palette,
    Percent,
    RotateCcw,
    Search,
    Settings2,
    ShieldCheck,
    ShoppingBag,
    Store,
    Sun,
    User,
    Users,
    X,
} from 'lucide-react';
import React, {
    startTransition,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    NavLink as RouterNavLink,
    useLocation,
    useNavigate,
    type NavigateOptions,
    type NavLinkProps,
} from 'react-router-dom';
// eslint-disable-next-line import/order -- Prettier keeps this type-only relative import with the external type group.
import type { ThemePreference } from '../theme/theme';

import { logoutAdministrator, switchActiveChannel } from '../apollo';
import { AccessibleDialogSurface } from '../components/AccessibleDialogSurface';
import { AdminPermissionsProvider } from '../components/admin-permissions-context';
import { AdminPageWorkspace, PageSkeleton } from '../components/AdminPageWorkspace';
import { OrderNotifications } from '../components/OrderNotifications';
import { ThemeToggleButton } from '../components/ThemeToggleButton';
import { CustomFieldsProvider } from '../custom-fields/CustomFieldsProvider';
import {
    getNextAdminExtensionNavItems,
    getNextAdminExtensionRoute,
    preloadNextAdminExtensionRoute,
} from '../extensions/extension-api';
import {
    APP_SHELL_BOOTSTRAP_QUERY,
    APP_SHELL_PROFILE_CONTEXT_QUERY,
    type AppShellBootstrapData,
    type AppShellProfileContextData,
} from '../graphql/auth.graphql';
import { useMobileLayout } from '../hooks/use-mobile-layout';
import { useActiveInterval } from '../hooks/use-page-activity';
import { requestAppNavigation, requestAppTabsClose } from '../hooks/use-unsaved-changes-warning';
import { allowsBackgroundRoutePreload, preloadCommonRoutes, preloadRoute } from '../route-modules';
import { getQueryRuntime } from '../runtime/admin-query-runtime';
import { pendingAdminWrites, RESOURCE_INVALIDATION_EVENT } from '../runtime/admin-resource-events';
import { useTheme } from '../theme/theme-context';
import { hasAnyAdminPermission } from '../utils/admin-permissions';
import { getChannelDisplayLabel } from '../utils/channel-display';
import { isInputMethodKey } from '../utils/input-method';
import { toUserFacingError } from '../utils/user-facing-error';

import '../extensions/installed-extensions';
import {
    filterAccessibleAdminChannels,
    hasAppShellPermissionSnapshot,
    isPlatformManagementChannel,
    resolveAppShellOpenMenu,
} from './app-shell-navigation';
import { TabbedOutlet } from './TabbedOutlet';

const adminBrandIcon = `${import.meta.env.BASE_URL}brand-icon-180.png`;

interface OpenTab {
    path: string;
    href: string;
    label: string;
}

function NavLink({
    allowed = true,
    onFocus,
    onMouseEnter,
    onPointerDown,
    to,
    ...props
}: NavLinkProps & { allowed?: boolean }) {
    if (!allowed) return null;
    const preload = () => {
        if (typeof to === 'string') {
            preloadRoute(to);
            preloadNextAdminExtensionRoute(to);
        }
    };

    return (
        <RouterNavLink
            {...props}
            to={to}
            onMouseEnter={event => {
                preload();
                onMouseEnter?.(event);
            }}
            onFocus={event => {
                preload();
                onFocus?.(event);
            }}
            onPointerDown={event => {
                preload();
                onPointerDown?.(event);
            }}
        />
    );
}

const extensionSectionLabel = getAdminSectionLabel;
const navIcons = {
    LayoutDashboard,
    Boxes,
    ShoppingBag,
    RotateCcw,
    Users,
    Percent,
    Palette,
    Blocks,
    CircleDollarSign,
    Database,
    ShieldCheck,
    Settings2,
};

const THEME_OPTIONS: Array<{
    value: ThemePreference;
    label: string;
    Icon: typeof Monitor;
}> = [
    { value: 'system', label: '自动', Icon: Monitor },
    { value: 'light', label: '浅色', Icon: Sun },
    { value: 'dark', label: '深色', Icon: Moon },
];

// 768–1279px 保留完整内容宽度，导航通过抽屉按需展开；
// 仅在宽桌面上常驻侧栏，避免横屏平板的数据表被压缩到窄视区。
const PERSISTENT_SIDEBAR_MEDIA_QUERY = '(min-width: 1280px)';
const OVERLAY_SIDEBAR_MEDIA_QUERY = '(max-width: 1279px)';

function RouteLoadingFallback() {
    return (
        <div
            className="flex h-full min-h-0 flex-col bg-slate-50"
            role="status"
            aria-live="polite"
            aria-label="正在打开页面"
        >
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex items-center justify-between gap-4" aria-hidden="true">
                    <div className="space-y-2">
                        <div className="h-5 w-40 rounded bg-slate-200" />
                        <div className="h-3 w-64 max-w-[70vw] rounded bg-slate-100" />
                    </div>
                    <div className="h-9 w-24 rounded-lg bg-slate-100" />
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-hidden p-5 sm:p-8">
                <div className="h-full min-h-[32rem] space-y-4" aria-hidden="true">
                    <div className="h-10 w-80 max-w-full rounded-lg border border-slate-200 bg-white" />
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2].map(item => (
                            <div key={item} className="h-28 rounded-xl border border-slate-200 bg-white" />
                        ))}
                    </div>
                    <div className="h-64 rounded-xl border border-slate-200 bg-white" />
                </div>
            </main>
            <span className="sr-only">正在打开页面…</span>
        </div>
    );
}

export function AppShell() {
    const queryClient = useApolloClient();
    const isMobileLayout = useMobileLayout();
    const location = useLocation();
    const routerNavigate = useNavigate();
    const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme();
    const completeNavigation = (target: string, options?: NavigateOptions) => {
        preloadRoute(target);
        preloadNextAdminExtensionRoute(target);
        startTransition(() => void routerNavigate(target, options));
    };
    const navigate = (target: string, options?: NavigateOptions) => {
        if (!requestAppNavigation(target)) return false;
        completeNavigation(target, options);
        return true;
    };
    const [isDesktop, setIsDesktop] = useState(
        () => window.matchMedia(PERSISTENT_SIDEBAR_MEDIA_QUERY).matches,
    );
    const [isSidebarOpen, setIsSidebarOpen] = useState(
        () => window.matchMedia(PERSISTENT_SIDEBAR_MEDIA_QUERY).matches,
    );
    const sidebarRef = useRef<HTMLElement>(null);
    const sidebarToggleRef = useRef<HTMLButtonElement>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const wasMobileSidebarOpenRef = useRef(false);
    const [isCmdKOpen, setIsCmdKOpen] = useState(false);
    const [cmdSearchQuery, setCmdSearchQuery] = useState('');
    const [cmdSelectedIndex, setCmdSelectedIndex] = useState(0);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isChannelSwitching, setIsChannelSwitching] = useState(false);
    const [channelError, setChannelError] = useState('');
    const appShellQuery = useQuery<AppShellBootstrapData>(APP_SHELL_BOOTSTRAP_QUERY, {
        fetchPolicy: 'cache-first',
    });
    const {
        data: channelData,
        error: appShellError,
        loading: appShellLoading,
        refetch: refetchAppShell,
    } = appShellQuery;
    const activeAdministrator = channelData?.activeAdministrator;
    const administratorName = activeAdministrator
        ? [activeAdministrator.lastName, activeAdministrator.firstName].filter(Boolean).join('') ||
          activeAdministrator.user.identifier
        : '管理员';
    const administratorInitial = activeAdministrator
        ? activeAdministrator.lastName.charAt(0) || activeAdministrator.firstName.charAt(0) || '管'
        : '管';
    const isSuperAdmin =
        activeAdministrator?.user.roles.some(role => role.code === '__super_admin_role__') ?? false;
    const isPlatformContext = isPlatformManagementChannel(channelData?.activeChannel.code);
    const accessibleChannels = useMemo(
        () =>
            filterAccessibleAdminChannels(
                channelData?.manageableChannels ?? [],
                channelData?.me?.channels ?? [],
                isSuperAdmin,
            ),
        [channelData?.manageableChannels, channelData?.me?.channels, isSuperAdmin],
    );
    const activePermissions = useMemo(() => {
        const permissions =
            channelData?.me?.channels.find(channel => channel.id === channelData.activeChannel?.id)
                ?.permissions ?? [];
        return isSuperAdmin && !permissions.includes('SuperAdmin')
            ? [...permissions, 'SuperAdmin']
            : permissions;
    }, [channelData, isSuperAdmin]);
    const profileContextQuery = useQuery<AppShellProfileContextData>(APP_SHELL_PROFILE_CONTEXT_QUERY, {
        fetchPolicy: 'cache-first',
        errorPolicy: 'ignore',
        skip:
            !channelData ||
            isPlatformContext ||
            !hasAnyAdminPermission(activePermissions, ['ReadStoreProfile']),
    });
    const storeLogoUrl =
        !isPlatformContext &&
        profileContextQuery.data?.myStoreProfile?.channelId === channelData?.activeChannel.id
            ? profileContextQuery.data?.myStoreProfile?.logoAsset?.preview
            : undefined;
    const adminLogoUrl = storeLogoUrl || (isPlatformContext ? adminBrandIcon : undefined);
    const displayLanguage = getAdminDisplayLanguage();
    const adminBrandName = isPlatformContext
        ? getChannelDisplayName('__default_channel__', displayLanguage)
        : `${channelData?.activeChannel ? getChannelDisplayName(channelData.activeChannel) : displayLanguage === 'en' ? 'Loading store…' : '读取店铺中…'} · ${displayLanguage === 'en' ? 'Admin' : '管理后台'}`;
    const capabilitySnapshot =
        channelData?.currentAdminCapabilities?.channelId === channelData?.activeChannel.id
            ? channelData?.currentAdminCapabilities
            : null;
    const canAccessPath = useCallback(
        (path: string) => {
            const canonical = getStandaloneAdminRedirect(path) ?? path;
            const definition = adminCapabilityForPath(canonical);
            if (!definition || !capabilitySnapshot) return false;
            const operation = /^\/sales\/orders\/[^/]+\/modify$/u.test(canonical) ? 'write' : 'read';
            return adminCapabilityAllows(capabilitySnapshot, definition.id, operation);
        },
        [capabilitySnapshot],
    );
    const currentDefinition = adminCapabilityForPath(location.pathname);
    const currentRouteRequiresPermission = currentDefinition?.scope !== 'PERSONAL';
    const currentRouteUnsupported = Boolean(
        capabilitySnapshot &&
        (!currentDefinition ||
            !adminCapabilityScopeAllows(
                currentDefinition,
                capabilitySnapshot.scope,
                capabilitySnapshot.commerceMode,
            ) ||
            capabilitySnapshot.capabilities.find(item => item.id === currentDefinition.id)?.state ===
                'UNSUPPORTED'),
    );
    const canAccessCurrentRoute = canAccessPath(location.pathname);
    const hasPermissionSnapshot = hasAppShellPermissionSnapshot(channelData) && Boolean(capabilitySnapshot);
    const channelControlsLoading = !channelData && appShellLoading;
    // Apollo 在 fetchMore/refetch 期间也会报 loading。权限快照已存在时不应用后台请求遮住当前页面。
    const profileError = hasPermissionSnapshot
        ? undefined
        : (appShellError ?? (!appShellLoading ? new Error('店铺功能信息暂时无法读取，请重试。') : undefined));
    const profileLoading = !hasPermissionSnapshot && appShellLoading;
    const refetchProfile = refetchAppShell;
    useActiveInterval(() => {
        if (!isChannelSwitching) void refetchAppShell().catch(() => undefined);
    }, 30_000);
    useEffect(() => {
        const refreshCapabilities = (event: Event) => {
            const domains = (event as CustomEvent<{ domains: string[] }>).detail?.domains ?? [];
            if (domains.some(domain => ['settings', 'plugins'].includes(domain)))
                void refetchAppShell().catch(() => undefined);
        };
        window.addEventListener(RESOURCE_INVALIDATION_EVENT, refreshCapabilities);
        return () => window.removeEventListener(RESOURCE_INVALIDATION_EVENT, refreshCapabilities);
    }, [refetchAppShell]);

    const preloadState = useRef({ path: location.pathname, loading: appShellLoading });
    useLayoutEffect(() => {
        preloadState.current = { path: location.pathname, loading: appShellLoading };
    }, [location.pathname, appShellLoading]);
    useEffect(
        () =>
            preloadCommonRoutes(() => {
                const connection = (
                    navigator as Navigator & {
                        connection?: { effectiveType?: string; saveData?: boolean };
                    }
                ).connection;
                const page = getQueryRuntime(queryClient).state(preloadState.current.path);
                return (
                    document.visibilityState === 'visible' &&
                    navigator.onLine &&
                    allowsBackgroundRoutePreload(connection) &&
                    !preloadState.current.loading &&
                    !page.loading &&
                    !page.refreshing
                );
            }),
        [queryClient],
    );

    useEffect(() => {
        if (currentRouteUnsupported && location.pathname !== '/dashboard')
            void routerNavigate('/dashboard', { replace: true });
    }, [currentRouteUnsupported, location.pathname, routerNavigate]);

    const [openMenu, setOpenMenu] = useState<string | null>('catalog');

    const [storedTabs, setTabs] = useState<OpenTab[]>([
        { path: '/dashboard', href: '/dashboard', label: localizeAdminNavigationTitle('网站总览') },
    ]);
    const tabs = useMemo(
        () => (capabilitySnapshot ? storedTabs.filter(tab => canAccessPath(tab.path)) : []),
        [capabilitySnapshot, storedTabs, canAccessPath],
    );
    useEffect(() => {
        if (!capabilitySnapshot) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setTabs(previous => {
                const allowed = previous.filter(tab => canAccessPath(tab.path));
                return allowed.length === previous.length ? previous : allowed;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [capabilitySnapshot, canAccessPath]);

    const [isMoreTabsOpen, setIsMoreTabsOpen] = useState(false);
    const tabListRef = useRef<HTMLDivElement>(null);
    const tabMeasurementRefs = useRef(new Map<string, HTMLDivElement>());
    const [visibleTabPaths, setVisibleTabPaths] = useState(() => tabs.map(tab => tab.path));
    const tabLayout = useMemo(() => tabs.map(({ path, label }) => ({ path, label })), [tabs]);

    useLayoutEffect(() => {
        const tabList = tabListRef.current;
        if (!tabList) return;

        const gap = 4;
        const recalculateVisibleTabs = () => {
            const availableWidth = tabList.clientWidth;
            const measuredTabs = tabLayout.map(tab => ({
                path: tab.path,
                width: tabMeasurementRefs.current.get(tab.path)?.offsetWidth ?? 0,
            }));
            if (!availableWidth || measuredTabs.some(tab => !tab.width)) return;

            const fittingPaths: string[] = [];
            let usedWidth = 0;
            for (const tab of measuredTabs) {
                const nextWidth = usedWidth + (fittingPaths.length ? gap : 0) + tab.width;
                if (nextWidth > availableWidth) break;
                fittingPaths.push(tab.path);
                usedWidth = nextWidth;
            }

            // Keep the current page reachable from the tab strip after navigation.
            const activePath = location.pathname;
            if (activePath && !fittingPaths.includes(activePath)) {
                const activeTab = measuredTabs.find(tab => tab.path === activePath);
                if (activeTab && activeTab.width <= availableWidth) {
                    while (fittingPaths.length > 0 && usedWidth + gap + activeTab.width > availableWidth) {
                        const removedPath = fittingPaths.pop();
                        const removedTab = measuredTabs.find(tab => tab.path === removedPath);
                        usedWidth -= (removedTab?.width ?? 0) + (fittingPaths.length ? gap : 0);
                    }
                    fittingPaths.push(activePath);
                }
            }

            const fittingPathSet = new Set(fittingPaths);
            const nextVisiblePaths = tabLayout.map(tab => tab.path).filter(path => fittingPathSet.has(path));
            setVisibleTabPaths(previousPaths =>
                previousPaths.length === nextVisiblePaths.length &&
                previousPaths.every((path, index) => path === nextVisiblePaths[index])
                    ? previousPaths
                    : nextVisiblePaths,
            );
        };

        recalculateVisibleTabs();
        const observer =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recalculateVisibleTabs) : null;
        observer?.observe(tabList);

        return () => {
            observer?.disconnect();
        };
    }, [tabLayout, location.pathname]);

    const visibleTabs = tabs.filter(tab =>
        isMobileLayout ? tab.path === location.pathname : visibleTabPaths.includes(tab.path),
    );
    const overflowTabs = isMobileLayout ? tabs : tabs.filter(tab => !visibleTabPaths.includes(tab.path));

    // 全局 ⌘K 键盘快捷键与方向键/回车监听
    // 当前路由是外部导航状态，需要同步手风琴分组和已打开标签。
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isInputMethodKey(e)) return;
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsCmdKOpen(prev => !prev);
            } else if (e.key === 'Escape') {
                setIsCmdKOpen(false);
                setIsUserMenuOpen(false);
                setIsMoreTabsOpen(false);
                if (!isDesktop) setIsSidebarOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDesktop]);

    useEffect(() => {
        const mediaQuery = window.matchMedia(PERSISTENT_SIDEBAR_MEDIA_QUERY);
        const handleViewportChange = (event: MediaQueryListEvent) => {
            setIsDesktop(event.matches);
            setIsSidebarOpen(event.matches);
        };
        mediaQuery.addEventListener('change', handleViewportChange);
        return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }, []);

    useEffect(() => {
        if (isDesktop) {
            wasMobileSidebarOpenRef.current = false;
            return;
        }

        if (isSidebarOpen) {
            window.requestAnimationFrame(() => {
                sidebarRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
            });
        } else if (wasMobileSidebarOpenRef.current && !isCmdKOpen) {
            sidebarToggleRef.current?.focus();
        }

        wasMobileSidebarOpenRef.current = isSidebarOpen;
    }, [isDesktop, isSidebarOpen, isCmdKOpen]);

    useLayoutEffect(() => {
        // 扩展页面可以挂在与 URL 前缀不同的导航分组，应优先遵循注册信息。
        const extensionRoute = getNextAdminExtensionRoute(location.pathname);
        const nextOpenMenu = resolveAppShellOpenMenu(location.pathname, extensionRoute?.navItem?.sectionId);
        if (nextOpenMenu !== undefined) setOpenMenu(nextOpenMenu);

        const routeTitles: Record<string, string> = {
            '/dashboard': '网站总览',
            '/profile': '个人中心',
            '/catalog/list': '商品列表',
            '/platform/catalog': '平台商品分配中心',
            '/catalog/products/new': '发布新商品',
            '/catalog/categories': '分类与属性',
            '/catalog/inventory': '库存与仓库',
            '/catalog/card-pool': '发卡记录与异常',
            '/catalog/assets': '素材媒体库',
            '/sales/orders': '订单列表',
            '/sales/profit': '利润统计',
            '/sales/after-sales': '售后与退款',
            '/sales/reviews': '买家评价管理',
            '/sales/customer-service-feedback': '客服服务评价',
            '/customers/list': '客户管理',
            '/marketing/promotions': '优惠与促销',
            '/marketing/referrals': '分销与返利',
            '/storefront/decoration': '商城装修',
            '/storefront/content': '内容与页面',
            '/settings/store-profile': '店铺综合设置',
            '/settings/team': '员工与权限',
            '/settings/system-ops': '系统运维 [超管]',
        };

        let currentTitle =
            extensionRoute?.title ??
            localizeAdminNavigationTitle(
                coreNavItems.find(item => item.path === location.pathname)?.title ??
                    routeTitles[location.pathname] ??
                    '',
            );
        if (!currentTitle) {
            if (location.pathname.startsWith('/catalog/products/')) {
                currentTitle = '编辑商品详情';
            } else if (location.pathname.startsWith('/sales/orders/')) {
                currentTitle = '订单履约详情';
            }
        }

        if (currentTitle) {
            document.title = `${currentTitle} · ${adminBrandName}`;
            const currentHref = `${location.pathname}${location.search}`;
            setTabs(prev => {
                const existing = prev.find(tab => tab.path === location.pathname);
                if (!existing) {
                    return [...prev, { path: location.pathname, href: currentHref, label: currentTitle }];
                }
                if (existing.href === currentHref && existing.label === currentTitle) return prev;
                return prev.map(tab =>
                    tab.path === location.pathname ? { ...tab, href: currentHref, label: currentTitle } : tab,
                );
            });
        }
    }, [location.pathname, location.search, adminBrandName, displayLanguage]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            mainContentRef.current?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [location.pathname]);
    /* oxlint-enable react/set-state-in-effect */

    const toggleMenu = (menu: string) => {
        if (!isSidebarOpen) setIsSidebarOpen(true);
        setOpenMenu(prev => (prev === menu ? null : menu));
    };

    const handleLogout = async () => {
        if (isLoggingOut || !requestAppNavigation('/login')) return;
        setIsLoggingOut(true);
        try {
            await logoutAdministrator();
        } finally {
            setIsUserMenuOpen(false);
            setIsLoggingOut(false);
            completeNavigation('/login', { replace: true });
        }
    };

    const handleChannelChange = async (channelToken: string) => {
        if (pendingAdminWrites()) {
            setChannelError('有操作正在提交，请等待结果返回后再切换店铺');
            return;
        }
        if (!accessibleChannels.some(channel => channel.token === channelToken)) {
            setChannelError('当前账号没有管理该店铺的权限');
            return;
        }
        if (
            isChannelSwitching ||
            channelToken === channelData?.activeChannel.token ||
            !requestAppTabsClose(tabs.map(tab => tab.path))
        )
            return;
        setIsChannelSwitching(true);
        setChannelError('');
        try {
            await switchActiveChannel(channelToken);
            // clearStore does not refetch mounted queries. Refresh the shell's active Channel
            // before returning to the dashboard so its selector and permissions match page data.
            await refetchAppShell();
            setTabs([
                { path: '/dashboard', href: '/dashboard', label: localizeAdminNavigationTitle('网站总览') },
            ]);
            completeNavigation('/dashboard', { replace: true });
        } catch (error) {
            setChannelError(toUserFacingError(error, '店铺切换失败，请稍后重试'));
        } finally {
            setIsChannelSwitching(false);
        }
    };

    const closeTab = (e: React.MouseEvent, path: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!requestAppTabsClose([path])) return;
        const newTabs = tabs.filter(t => t.path !== path);
        if (location.pathname === path && newTabs.length > 0) {
            if (!navigate(newTabs[newTabs.length - 1].href)) return;
        } else if (newTabs.length === 0) {
            if (!navigate('/dashboard')) return;
        }
        setTabs(newTabs);
    };

    const closeOtherTabs = () => {
        if (!requestAppTabsClose(tabs.filter(tab => tab.path !== location.pathname).map(tab => tab.path)))
            return;
        const currentTab = tabs.find(t => t.path === location.pathname) || {
            path: '/dashboard',
            href: '/dashboard',
            label: localizeAdminNavigationTitle('网站总览'),
        };
        setTabs([currentTab]);
        setIsMoreTabsOpen(false);
    };

    const navigationItems = useMemo(() => {
        const items = [
            ...coreNavItems,
            ...getNextAdminExtensionNavItems()
                .filter(route => !getStandaloneAdminRedirect(route.path))
                .map(route => ({
                    path: route.path,
                    title: route.navItem?.label ?? route.title,
                    section:
                        route.path === '/operations/manual-digital-delivery'
                            ? 'digital-delivery'
                            : (route.navItem?.sectionId ?? 'settings'),
                    order:
                        route.path === '/storefront/business-services-copy'
                            ? 1000
                            : (route.navItem?.order ?? 500),
                })),
        ];
        return [...new Map(items.map(item => [item.path, item])).values()]
            .filter(item => canAccessPath(item.path))
            .filter(
                item =>
                    !item.path.startsWith('/settings/store-profile/usdt-') ||
                    !items.some(
                        other =>
                            other.title === item.title &&
                            other.path.startsWith('/settings/usdt-payments/') &&
                            canAccessPath(other.path),
                    ),
            )
            .map(item => ({ ...item, title: localizeAdminNavigationTitle(item.title, displayLanguage) }))
            .sort((a, b) => a.order - b.order);
    }, [canAccessPath, displayLanguage]);
    const allCmdItems = useMemo(
        () =>
            navigationItems
                .filter(item => getNextAdminExtensionRoute(item.path)?.commandPalette !== false)
                .map(item => ({
                    title: item.title,
                    path: item.path,
                    cat: extensionSectionLabel(item.section),
                    icon: navIcons[ADMIN_NAV_SECTIONS.find(([id]) => id === item.section)?.[2] ?? 'Blocks'],
                })),
        [navigationItems],
    );

    const filteredCmdItems = useMemo(() => {
        if (!cmdSearchQuery.trim()) return allCmdItems.slice(0, 8);
        const q = cmdSearchQuery.toLowerCase();
        return allCmdItems.filter(
            item =>
                item.title.toLowerCase().includes(q) ||
                item.cat.toLowerCase().includes(q) ||
                item.path.toLowerCase().includes(q),
        );
    }, [allCmdItems, cmdSearchQuery]);

    // ⌘K 键盘上下键与回车处理
    const handleCmdKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (isInputMethodKey(e.nativeEvent)) return;
        if (filteredCmdItems.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCmdSelectedIndex(prev => (prev + 1) % filteredCmdItems.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCmdSelectedIndex(prev => (prev - 1 + filteredCmdItems.length) % filteredCmdItems.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredCmdItems[cmdSelectedIndex]) {
                navigate(filteredCmdItems[cmdSelectedIndex].path);
                setIsCmdKOpen(false);
                setCmdSearchQuery('');
            }
        }
    };

    const activeNavigationSection = resolveAppShellOpenMenu(
        location.pathname,
        getNextAdminExtensionRoute(location.pathname)?.navItem?.sectionId,
    );

    return (
        <div className="admin-app-shell flex h-screen overflow-hidden bg-slate-50">
            <a
                href="#main-content"
                className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-lg transition-transform focus:translate-y-0"
            >
                跳到主要内容
            </a>
            {isSidebarOpen && (
                <AdminButton
                    type="button"
                    className="fixed inset-0 z-30 bg-slate-950/50 xl:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label="关闭侧边栏"
                />
            )}

            {/* 侧边栏：精准 8 大一级分类 */}
            <aside
                id="app-sidebar"
                ref={sidebarRef}
                aria-hidden={!isDesktop && !isSidebarOpen}
                inert={!isDesktop && !isSidebarOpen ? true : undefined}
                className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 flex-col transition-[transform,width] duration-150 ease-out xl:relative xl:z-20 ${isSidebarOpen ? 'translate-x-0 xl:w-56' : '-translate-x-full xl:w-16 xl:translate-x-0'}`}
            >
                <div className="admin-sidebar-brand flex h-auto min-h-14 shrink-0 items-center justify-center border-b px-3 py-3 xl:h-14 xl:py-0">
                    <div className="flex min-w-0 max-w-full items-center gap-2">
                        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-blue-600 font-bold text-white shadow-lg shadow-blue-900/20">
                            <span aria-hidden="true">{adminBrandName.charAt(0)}</span>
                            {adminLogoUrl && (
                                <img
                                    key={adminLogoUrl}
                                    src={adminLogoUrl}
                                    alt=""
                                    className="absolute inset-0 h-full w-full bg-white object-contain"
                                    onError={event => {
                                        event.currentTarget.style.display = 'none';
                                    }}
                                />
                            )}
                        </div>
                        {isSidebarOpen && (
                            <span
                                className="min-w-0 break-words font-bold text-sm leading-tight line-clamp-2"
                                title={adminBrandName}
                            >
                                {adminBrandName}
                            </span>
                        )}
                    </div>
                </div>

                <nav
                    aria-label={displayLanguage === 'en' ? 'Administration navigation' : '管理导航'}
                    className="custom-scrollbar flex-1 space-y-1 overflow-x-hidden overflow-y-auto p-2"
                    onClick={event => {
                        if (
                            (event.target as HTMLElement).closest('a') &&
                            window.matchMedia(OVERLAY_SIDEBAR_MEDIA_QUERY).matches
                        ) {
                            setIsSidebarOpen(false);
                        }
                    }}
                >
                    <AdminButton
                        type="button"
                        className="admin-sidebar-nav-item mb-2 flex w-full items-center gap-3 px-3 py-2 text-xs md:hidden"
                        onClick={() => {
                            setIsSidebarOpen(false);
                            setIsCmdKOpen(true);
                            setCmdSelectedIndex(0);
                        }}
                    >
                        <Search className="h-4 w-4" aria-hidden="true" />
                        {displayLanguage === 'en' ? 'Search functions' : '搜索管理功能'}
                    </AdminButton>
                    {ADMIN_NAV_SECTIONS.map(([section, label, iconName]) => {
                        const items = navigationItems.filter(item => item.section === section);
                        if (!items.length) return null;
                        const Icon = navIcons[iconName];
                        const single = section === 'dashboard' || section === 'customers';
                        const labelText =
                            displayLanguage === 'en'
                                ? {
                                      dashboard: 'Website overview',
                                      catalog: 'Products',
                                      'digital-delivery': 'Digital delivery',
                                      'physical-inventory': 'Physical inventory',
                                      sales: 'Orders',
                                      'after-sales': 'After-sales',
                                      customers: 'Customers',
                                      marketing: 'Marketing',
                                      storefront: 'Store design',
                                      plugins: 'Plugins',
                                      payments: 'Payments',
                                      data: 'Data',
                                      permissions: 'Permissions',
                                      settings: 'System settings',
                                  }[section]
                                : label;
                        if (single)
                            return (
                                <NavLink
                                    key={section}
                                    to={items[0].path}
                                    aria-label={labelText}
                                    title={!isSidebarOpen ? labelText : undefined}
                                    className={`admin-sidebar-nav-item flex min-h-10 items-center ${isSidebarOpen ? 'px-3' : 'mx-auto w-12 justify-center'}`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    {isSidebarOpen && <span className="ml-3 text-xs">{labelText}</span>}
                                </NavLink>
                            );
                        return (
                            <div key={section} data-admin-nav-section={section}>
                                <AdminButton
                                    type="button"
                                    aria-label={labelText}
                                    aria-expanded={isSidebarOpen && openMenu === section}
                                    aria-controls={
                                        isSidebarOpen && openMenu === section
                                            ? `admin-nav-${section}`
                                            : undefined
                                    }
                                    title={!isSidebarOpen ? labelText : undefined}
                                    data-current={activeNavigationSection === section ? 'true' : undefined}
                                    onClick={() => toggleMenu(section)}
                                    className={`admin-sidebar-nav-item admin-sidebar-section flex min-h-10 w-full items-center text-left ${isSidebarOpen ? 'px-3' : 'justify-center'}`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    {isSidebarOpen && (
                                        <>
                                            <span className="ml-3 min-w-0 flex-1 break-words text-xs">
                                                {labelText}
                                            </span>
                                            <ChevronDown
                                                className={`h-3.5 w-3.5 transition-transform ${openMenu === section ? 'rotate-180' : ''}`}
                                            />
                                        </>
                                    )}
                                </AdminButton>
                                {isSidebarOpen && openMenu === section && (
                                    <div
                                        id={`admin-nav-${section}`}
                                        className="admin-sidebar-submenu mt-1 space-y-0.5"
                                    >
                                        {items.map(item => (
                                            <NavLink
                                                key={item.path}
                                                to={item.path}
                                                className="admin-sidebar-nav-item block px-3 py-2 text-xs"
                                            >
                                                {item.title}
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>
            </aside>

            {/* 主工作区 */}
            <div
                aria-hidden={!isDesktop && isSidebarOpen}
                inert={!isDesktop && isSidebarOpen ? true : undefined}
                className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative"
            >
                <header className="admin-app-header relative z-30 shrink-0 bg-white px-3 shadow-2xs sm:px-6">
                    <AdminButton
                        ref={sidebarToggleRef}
                        type="button"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                        aria-label="切换侧边栏展开折叠"
                        aria-expanded={isSidebarOpen}
                        aria-controls="app-sidebar"
                    >
                        <Menu className="w-5 h-5" />
                    </AdminButton>

                    <div className="admin-header-actions flex min-w-0 items-center justify-end gap-2 sm:gap-4">
                        {activeAdministrator &&
                            channelData?.activeChannel &&
                            !isChannelSwitching &&
                            !isLoggingOut &&
                            hasAnyAdminPermission(activePermissions, ['ReadOrder']) && (
                                <OrderNotifications
                                    key={`${activeAdministrator.id}:${channelData.activeChannel.id}`}
                                    administratorId={activeAdministrator.id}
                                    channelId={channelData.activeChannel.id}
                                    channelToken={channelData.activeChannel.token}
                                />
                            )}
                        <AdminField
                            className="admin-store-selector relative flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-600"
                            label={
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                    <Store className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                                    <span className="sr-only lg:not-sr-only">当前店铺</span>
                                </span>
                            }
                        >
                            {' '}
                            <AdminSelect
                                value={channelData?.activeChannel.token ?? ''}
                                onChange={event => void handleChannelChange(event.target.value)}
                                disabled={
                                    channelControlsLoading ||
                                    isChannelSwitching ||
                                    !channelData ||
                                    accessibleChannels.length <= 1
                                }
                                aria-label="切换当前店铺"
                                title={
                                    channelError ||
                                    `${channelData?.activeChannel ? getChannelDisplayLabel(channelData.activeChannel) : '读取店铺中…'}；切换后商品、订单、库存等数据将按所选店铺重新加载`
                                }
                                className={`admin-store-select h-8 min-w-0 rounded-lg border bg-white pl-2 pr-6 text-xs font-bold outline-none ${channelError ? 'border-rose-300 text-rose-700' : 'border-slate-200 text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'}`}
                            >
                                {!channelData && <option value="">读取店铺…</option>}
                                {accessibleChannels.map(channel => (
                                    <option key={channel.id} value={channel.token}>
                                        {getChannelDisplayLabel(channel)}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                        <AdminButton
                            type="button"
                            className="relative hidden w-64 items-center rounded-lg bg-slate-100 py-1.5 pl-9 pr-2 text-xs text-slate-400 transition-colors hover:bg-blue-50 lg:flex"
                            onClick={() => {
                                setIsCmdKOpen(true);
                                setCmdSelectedIndex(0);
                            }}
                        >
                            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                            <span className="flex-1 text-left">搜索功能</span>
                            <span className="flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500 shadow-2xs">
                                <Command className="h-3 w-3" />K
                            </span>
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => {
                                setIsCmdKOpen(true);
                                setCmdSelectedIndex(0);
                            }}
                            className="hidden rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 md:flex lg:hidden"
                            aria-label="搜索管理功能"
                        >
                            <Search className="h-4 w-4" />
                        </AdminButton>
                        <ThemeToggleButton className="hidden md:flex" />
                        {/* 右上角用户菜单 (包含个人中心与退出) */}
                        <div className="relative">
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setIsMoreTabsOpen(false);
                                    setIsUserMenuOpen(current => !current);
                                }}
                                className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-xs cursor-pointer hover:ring-2 hover:ring-blue-400 transition-colors"
                                aria-label="打开管理员菜单"
                                aria-expanded={isUserMenuOpen}
                                aria-haspopup="menu"
                                aria-controls="administrator-menu"
                            >
                                {administratorInitial}
                            </AdminButton>

                            {isUserMenuOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-20"
                                        onClick={() => setIsUserMenuOpen(false)}
                                    ></div>
                                    <div
                                        id="administrator-menu"
                                        role="menu"
                                        className="absolute right-0 top-11 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-30 animate-fadeIn text-xs"
                                    >
                                        <div className="px-4 py-2.5 border-b border-slate-100">
                                            <div className="truncate font-bold text-slate-800">
                                                {administratorName}
                                            </div>
                                            <div className="truncate font-mono text-[11px] text-slate-400">
                                                {activeAdministrator?.emailAddress ?? '正在读取账号信息'}
                                            </div>
                                        </div>

                                        <div className="py-1">
                                            <AdminButton
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    navigate('/profile');
                                                    setIsUserMenuOpen(false);
                                                }}
                                                className="w-full px-4 py-2 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2.5 cursor-pointer font-medium"
                                            >
                                                <User className="w-4 h-4 text-slate-400" />
                                                <span>个人中心与密码</span>
                                            </AdminButton>
                                            <AdminButton
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    navigate('/settings/store-profile');
                                                    setIsUserMenuOpen(false);
                                                }}
                                                className="w-full px-4 py-2 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2.5 cursor-pointer font-medium"
                                            >
                                                <Settings2 className="w-4 h-4 text-slate-400" />
                                                <span>店铺综合设置</span>
                                            </AdminButton>
                                        </div>

                                        <div className="border-t border-slate-100 px-3 py-3">
                                            <div className="mb-2 flex items-center justify-between px-1 text-slate-600">
                                                <span className="flex items-center gap-2 font-medium">
                                                    <Palette className="h-4 w-4 text-slate-400" />
                                                    界面外观
                                                </span>
                                                <span className="text-[10px] text-slate-400">
                                                    {resolvedTheme === 'dark' ? '深色生效中' : '浅色生效中'}
                                                </span>
                                            </div>
                                            <div
                                                className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
                                                role="group"
                                                aria-label="选择界面外观"
                                            >
                                                {THEME_OPTIONS.map(option => {
                                                    const isSelected = themePreference === option.value;
                                                    const optionClassName = [
                                                        'flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5',
                                                        'text-[10px] font-medium transition-colors focus:outline-none',
                                                        'focus:ring-2 focus:ring-blue-500',
                                                        isSelected
                                                            ? 'bg-white text-blue-600 shadow-sm'
                                                            : 'text-slate-500 hover:bg-white/70 hover:text-slate-800',
                                                    ].join(' ');
                                                    return (
                                                        <AdminButton
                                                            key={option.value}
                                                            type="button"
                                                            role="menuitemradio"
                                                            aria-checked={isSelected}
                                                            onClick={() => setThemePreference(option.value)}
                                                            className={optionClassName}
                                                        >
                                                            <option.Icon
                                                                className="h-3.5 w-3.5"
                                                                aria-hidden="true"
                                                            />
                                                            <span>{option.label}</span>
                                                        </AdminButton>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="border-t border-slate-100 pt-1">
                                            <AdminButton
                                                type="button"
                                                role="menuitem"
                                                disabled={isLoggingOut}
                                                onClick={() => void handleLogout()}
                                                className="w-full px-4 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 cursor-pointer font-medium disabled:opacity-50"
                                            >
                                                {isLoggingOut ? (
                                                    <RotateCcw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <LogOut className="w-4 h-4 text-rose-500" />
                                                )}
                                                <span>{isLoggingOut ? '正在退出...' : '退出系统登录'}</span>
                                            </AdminButton>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </header>

                {/* 标签栏 */}
                <div className="admin-tab-strip relative z-20 h-10 shrink-0 select-none border-b border-t border-slate-200 bg-white flex items-center justify-between">
                    {/* 左侧标签列表 */}
                    <div
                        ref={tabListRef}
                        className="flex-1 min-w-0 h-full flex items-center px-3 gap-1 overflow-hidden"
                    >
                        {visibleTabs.map(tab => {
                            const isActive = location.pathname === tab.path;
                            return (
                                <div
                                    key={tab.path}
                                    className={`admin-tab-item inline-flex shrink-0 items-center rounded-md border text-xs transition-colors ${isActive ? 'border-blue-200 bg-blue-50 font-bold text-blue-600 shadow-2xs' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                                >
                                    <NavLink
                                        to={tab.href}
                                        className="admin-tab-link px-3 py-1"
                                        title={tab.label}
                                    >
                                        {tab.label}
                                    </NavLink>
                                    {tabs.length > 1 && (
                                        <AdminButton
                                            type="button"
                                            onClick={event => closeTab(event, tab.path)}
                                            aria-label={`关闭${tab.label}标签`}
                                            className="mr-1 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                                        >
                                            <X className="h-3 w-3" />
                                        </AdminButton>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* 用同样的样式测量所有标签，避免隐藏标签影响可见区宽度。 */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -z-10 flex h-px w-max overflow-hidden opacity-0"
                    >
                        {tabs.map(tab => (
                            <div
                                key={tab.path}
                                ref={element => {
                                    if (element) tabMeasurementRefs.current.set(tab.path, element);
                                    else tabMeasurementRefs.current.delete(tab.path);
                                }}
                                className="inline-flex shrink-0 items-center rounded-md border text-xs"
                            >
                                <span className="px-3 py-1">{tab.label}</span>
                                {tabs.length > 1 && (
                                    <span className="mr-1 rounded-full p-0.5">
                                        <X className="h-3 w-3" />
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* 右侧【更多 (N) ▾】下拉按钮 */}
                    <div className="relative z-20 flex h-full shrink-0 items-center justify-center border-l border-slate-200 bg-white px-3">
                        <AdminButton
                            type="button"
                            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${overflowTabs.length ? 'cursor-pointer' : 'cursor-default'} ${isMoreTabsOpen ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-600 hover:text-blue-600 hover:bg-slate-100'}`}
                            onClick={() => {
                                if (!overflowTabs.length) return;
                                setIsUserMenuOpen(false);
                                setIsMoreTabsOpen(current => !current);
                            }}
                            aria-expanded={overflowTabs.length > 0 && isMoreTabsOpen}
                            aria-controls={overflowTabs.length ? 'open-tabs-menu' : undefined}
                            aria-haspopup="menu"
                            disabled={!overflowTabs.length}
                        >
                            <span>更多</span>
                            {overflowTabs.length > 0 && (
                                <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1 rounded">
                                    {overflowTabs.length}
                                </span>
                            )}
                            <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${isMoreTabsOpen ? 'rotate-180 text-blue-600' : ''}`}
                            />
                        </AdminButton>

                        {/* 更多标签下拉弹窗 */}
                        {isMoreTabsOpen && overflowTabs.length > 0 && (
                            <>
                                <div
                                    className="fixed inset-0 z-30"
                                    onClick={() => setIsMoreTabsOpen(false)}
                                ></div>
                                <div
                                    id="open-tabs-menu"
                                    role="menu"
                                    className="absolute top-10 right-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-40 max-h-96 overflow-y-auto animate-scaleIn"
                                >
                                    <div className="px-4 pb-2 mb-1 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-600">
                                        <span>更多标签 ({overflowTabs.length})</span>
                                        <div className="flex gap-2 text-[11px]">
                                            {tabs.length > 1 && (
                                                <AdminButton
                                                    type="button"
                                                    role="menuitem"
                                                    className="text-slate-500 hover:text-blue-600 cursor-pointer"
                                                    onClick={closeOtherTabs}
                                                >
                                                    关闭其他
                                                </AdminButton>
                                            )}
                                            <AdminButton
                                                type="button"
                                                role="menuitem"
                                                className="text-rose-600 hover:text-rose-700 font-normal cursor-pointer"
                                                onClick={() => {
                                                    if (
                                                        !requestAppTabsClose(
                                                            tabs
                                                                .filter(tab => tab.path !== '/dashboard')
                                                                .map(tab => tab.path),
                                                        )
                                                    )
                                                        return;
                                                    if (!navigate('/dashboard')) return;
                                                    setTabs([
                                                        {
                                                            path: '/dashboard',
                                                            href: '/dashboard',
                                                            label: localizeAdminNavigationTitle('网站总览'),
                                                        },
                                                    ]);
                                                    setIsMoreTabsOpen(false);
                                                }}
                                            >
                                                关闭全部
                                            </AdminButton>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-slate-50">
                                        {overflowTabs.map(tab => {
                                            const isActive = location.pathname === tab.path;
                                            return (
                                                <div
                                                    key={tab.path}
                                                    className={`flex items-center justify-between text-xs transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                                                >
                                                    <AdminButton
                                                        type="button"
                                                        role="menuitem"
                                                        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left"
                                                        onClick={() => {
                                                            navigate(tab.href);
                                                            setIsMoreTabsOpen(false);
                                                        }}
                                                    >
                                                        <span
                                                            className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-blue-600' : 'bg-slate-300'}`}
                                                        ></span>
                                                        <span className="truncate">{tab.label}</span>
                                                    </AdminButton>
                                                    {tabs.length > 1 && (
                                                        <AdminButton
                                                            type="button"
                                                            role="menuitem"
                                                            className="mr-3 shrink-0 cursor-pointer rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                            aria-label={`关闭${tab.label}标签`}
                                                            onClick={e => {
                                                                closeTab(e, tab.path);
                                                                if (overflowTabs.length === 1)
                                                                    setIsMoreTabsOpen(false);
                                                            }}
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </AdminButton>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div
                    id="main-content"
                    ref={mainContentRef}
                    tabIndex={-1}
                    className="flex-1 overflow-hidden relative outline-none"
                >
                    {isChannelSwitching ? (
                        <RouteLoadingFallback />
                    ) : currentRouteUnsupported ? (
                        <RouteLoadingFallback />
                    ) : currentRouteRequiresPermission && profileLoading ? (
                        <div className="flex h-full items-center justify-center text-xs font-medium text-slate-500">
                            正在核验访问权限…
                        </div>
                    ) : currentRouteRequiresPermission && profileError ? (
                        <div className="flex h-full items-center justify-center overflow-y-auto p-6">
                            <section
                                className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"
                                role="alert"
                            >
                                <ShieldCheck className="mx-auto h-10 w-10 text-rose-500" />
                                <h1 className="mt-4 text-base font-bold text-slate-900">权限信息读取失败</h1>
                                <p className="mt-2 text-xs leading-5 text-rose-600">
                                    {toUserFacingError(
                                        profileError,
                                        '暂时无法核验平台级访问权限，请重新加载。',
                                    )}
                                </p>
                                <AdminButton
                                    type="button"
                                    onClick={() => void refetchProfile()}
                                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                >
                                    重新核验权限
                                </AdminButton>
                            </section>
                        </div>
                    ) : currentRouteRequiresPermission && !canAccessCurrentRoute ? (
                        <div className="flex h-full items-center justify-center overflow-y-auto p-6">
                            <section className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
                                <ShieldCheck className="mx-auto h-10 w-10 text-amber-500" />
                                <h1 className="mt-4 text-base font-bold text-slate-900">当前账号无权访问</h1>
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                    当前账号在所选店铺中缺少访问该页面所需的权限。
                                </p>
                                <AdminButton
                                    type="button"
                                    onClick={() => navigate('/dashboard')}
                                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                >
                                    返回网站总览
                                </AdminButton>
                            </section>
                        </div>
                    ) : (
                        <AdminPermissionsProvider
                            permissions={activePermissions}
                            capabilities={capabilitySnapshot}
                        >
                            {/* Keep store-scoped queries separate while retaining pages within one store. */}
                            <CustomFieldsProvider key={channelData?.activeChannel.token}>
                                <TabbedOutlet
                                    key={`${activeAdministrator?.id}:${channelData?.activeChannel.id}`}
                                    openPaths={tabs
                                        .filter(tab => canAccessPath(tab.path))
                                        .map(tab => tab.path)}
                                    fallback={<PageSkeleton />}
                                    pageFrame={AdminPageWorkspace}
                                />
                            </CustomFieldsProvider>
                        </AdminPermissionsProvider>
                    )}
                </div>
            </div>

            {/* ⌘K 全局搜索弹窗 (Command Palette) */}
            {isCmdKOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/60 z-50 flex items-start justify-center pt-24"
                    onClick={() => setIsCmdKOpen(false)}
                >
                    <AccessibleDialogSurface
                        accessibleName="全局功能搜索"
                        mobilePresentation="sheet"
                        onRequestClose={() => setIsCmdKOpen(false)}
                        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-scaleIn border border-slate-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center px-4 border-b border-slate-100">
                            <Search className="w-5 h-5 text-blue-500" />
                            <AdminInput
                                type="search"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                data-1p-ignore="true"
                                data-bwignore="true"
                                data-lpignore="true"
                                data-form-type="other"
                                value={cmdSearchQuery}
                                onChange={e => {
                                    setCmdSearchQuery(e.target.value);
                                    setCmdSelectedIndex(0);
                                }}
                                onKeyDown={handleCmdKeyDown}
                                aria-label="搜索后台功能"
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="command-search-results"
                                aria-activedescendant={
                                    filteredCmdItems[cmdSelectedIndex]
                                        ? `command-result-${cmdSelectedIndex}`
                                        : undefined
                                }
                                placeholder="搜索商品、订单、售后、营销、插件与设置... (↑↓ 导航, Enter 选择, ESC 退出)"
                                className="w-full px-3 py-4 focus:outline-none text-sm text-slate-700 placeholder-slate-400"
                                autoFocus
                            />
                            <div className="hidden md:block text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                                ESC
                            </div>
                            <AdminButton
                                type="button"
                                className="shrink-0 rounded-lg px-2 text-slate-500 md:hidden"
                                aria-label="关闭功能搜索"
                                onClick={() => setIsCmdKOpen(false)}
                            >
                                关闭
                            </AdminButton>
                        </div>

                        <div
                            id="command-search-results"
                            role="listbox"
                            className="p-3 max-h-96 overflow-y-auto space-y-1"
                        >
                            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                {cmdSearchQuery
                                    ? `匹配的功能项 (${filteredCmdItems.length})`
                                    : '常用功能直达 (按 ↑↓ 选择，Enter 直达)'}
                            </div>

                            {filteredCmdItems.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs">
                                    未找到与 “{cmdSearchQuery}” 相关的管理功能页面
                                </div>
                            ) : (
                                filteredCmdItems.map((item, idx) => {
                                    const Icon = item.icon;
                                    const isSelected = idx === cmdSelectedIndex;
                                    return (
                                        <AdminButton
                                            type="button"
                                            key={idx}
                                            id={`command-result-${idx}`}
                                            role="option"
                                            aria-selected={isSelected}
                                            onMouseEnter={() => setCmdSelectedIndex(idx)}
                                            onClick={() => {
                                                navigate(item.path);
                                                setIsCmdKOpen(false);
                                                setCmdSearchQuery('');
                                            }}
                                            className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-left text-slate-700 transition-colors ${isSelected ? 'bg-blue-50 text-blue-600 shadow-2xs ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className={`p-2 rounded-lg transition-colors shadow-2xs ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                                                >
                                                    <Icon className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <div
                                                        className={`text-xs font-bold ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}
                                                    >
                                                        {item.title}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                        {item.path}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                                                    {item.cat}
                                                </span>
                                                <CornerDownLeft
                                                    className={`w-3.5 h-3.5 text-blue-500 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                                                />
                                            </div>
                                        </AdminButton>
                                    );
                                })
                            )}
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
