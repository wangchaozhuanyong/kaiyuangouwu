/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useQuery } from '@apollo/client/react';
import {
    Blocks,
    Boxes,
    ChevronDown,
    Command,
    CornerDownLeft,
    FolderTree,
    KeyRound,
    LayoutDashboard,
    LogOut,
    Megaphone,
    Menu,
    MessageSquare,
    Monitor,
    Moon,
    Package,
    Palette,
    Percent,
    RotateCcw,
    Search,
    Settings2,
    ShieldCheck,
    ShoppingBag,
    Store,
    Sun,
    Terminal,
    Ticket,
    User,
    Users,
    X,
} from 'lucide-react';
import React, {
    startTransition,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Outlet,
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
import { ThemeToggleButton } from '../components/ThemeToggleButton';
import { CustomFieldsProvider } from '../custom-fields/CustomFieldsProvider';
import {
    getNextAdminExtensionNavItems,
    getNextAdminExtensionRoute,
    preloadNextAdminExtensionRoute,
} from '../extensions/extension-api';
import {
    APP_SHELL_BOOTSTRAP_QUERY,
    APP_SHELL_STORE_CONTEXT_QUERY,
    type AppShellBootstrapData,
    type AppShellStoreContextData,
} from '../graphql/auth.graphql';
import { requestAppNavigation } from '../hooks/use-unsaved-changes-warning';
import { preloadCommonRoutes, preloadRoute, preloadSettingsRoutes } from '../route-modules';
import { useTheme } from '../theme/theme-context';
import {
    canAccessAdminPath,
    getRequiredPermissionsForAdminPath,
    hasAnyAdminPermission,
} from '../utils/admin-permissions';
import { getChannelDisplayLabel } from '../utils/channel-display';
import { commerceModeAllowsPath } from '../utils/commerce-mode';
import { toUserFacingError } from '../utils/user-facing-error';

import {
    hasAppShellPermissionSnapshot,
    isAppShellPermissionLoading,
    resolveAppShellOpenMenu,
} from './app-shell-navigation';

const adminBrandIcon = `${import.meta.env.BASE_URL}favicon.png`;

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

function extensionSectionLabel(sectionId?: string) {
    const labels: Record<string, string> = {
        catalog: '商品',
        sales: '订单与售后',
        customers: '客户',
        marketing: '营销',
        storefront: '店铺',
        plugins: '插件与服务',
        settings: '系统与权限',
    };
    return labels[sectionId ?? ''] ?? '扩展功能';
}

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
    const loadingAllChannelsRef = useRef(false);
    const appShellQuery = useQuery<AppShellBootstrapData>(APP_SHELL_BOOTSTRAP_QUERY, {
        variables: { options: { skip: 0, take: 100, sort: { code: 'ASC' } } },
        fetchPolicy: 'cache-first',
    });
    const storeContextQuery = useQuery<AppShellStoreContextData>(APP_SHELL_STORE_CONTEXT_QUERY, {
        fetchPolicy: 'cache-first',
        errorPolicy: 'ignore',
    });
    const {
        data: channelData,
        error: appShellError,
        fetchMore: fetchMoreChannels,
        loading: appShellLoading,
        refetch: refetchAppShell,
    } = appShellQuery;
    const activeAdministrator = channelData?.activeAdministrator;
    const storeLogoUrl = storeContextQuery.data?.myStoreProfile?.logoAsset?.preview;
    const commerceMode = storeContextQuery.data?.myStoreCommerceMode?.mode ?? 'HYBRID';
    const showsPhysicalCatalog = commerceMode !== 'DIGITAL_ONLY';
    const showsDigitalCatalog = commerceMode !== 'PHYSICAL_ONLY';
    const administratorName = activeAdministrator
        ? [activeAdministrator.lastName, activeAdministrator.firstName].filter(Boolean).join('') ||
          activeAdministrator.user.identifier
        : '管理员';
    const administratorInitial = activeAdministrator
        ? activeAdministrator.lastName.charAt(0) || activeAdministrator.firstName.charAt(0) || '管'
        : '管';
    const isSuperAdmin =
        activeAdministrator?.user.roles.some(role => role.code === '__super_admin_role__') ?? false;
    const activePermissions = useMemo(() => {
        const permissions =
            channelData?.me?.channels.find(channel => channel.id === channelData.activeChannel?.id)
                ?.permissions ?? [];
        return isSuperAdmin && !permissions.includes('SuperAdmin')
            ? [...permissions, 'SuperAdmin']
            : permissions;
    }, [channelData, isSuperAdmin]);
    const canAccessPath = useCallback(
        (path: string) => {
            const extensionRoute = getNextAdminExtensionRoute(path);
            return extensionRoute
                ? hasAnyAdminPermission(activePermissions, extensionRoute.permissions ?? [])
                : canAccessAdminPath(path, activePermissions);
        },
        [activePermissions],
    );
    const currentRoutePermissions =
        getNextAdminExtensionRoute(location.pathname)?.permissions ??
        getRequiredPermissionsForAdminPath(location.pathname);
    const currentRouteRequiresPermission = currentRoutePermissions.length > 0;
    const canAccessCurrentRoute = canAccessPath(location.pathname);
    const hasPermissionSnapshot = hasAppShellPermissionSnapshot(channelData);
    const channelsError = appShellError;
    const channelsLoading = appShellLoading;
    const channelControlsLoading = !channelData && appShellLoading;
    // Apollo 在 fetchMore/refetch 期间也会报 loading。权限快照已存在时不应用后台请求遮住当前页面。
    const profileError = hasPermissionSnapshot ? undefined : appShellError;
    const profileLoading = isAppShellPermissionLoading(channelData, appShellLoading);
    const refetchProfile = refetchAppShell;

    useEffect(() => {
        preloadSettingsRoutes();
        const timer = window.setTimeout(preloadCommonRoutes, 1200);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (
            !storeContextQuery.data?.myStoreCommerceMode ||
            commerceModeAllowsPath(commerceMode, location.pathname)
        ) {
            return;
        }
        void routerNavigate('/catalog/list', { replace: true });
    }, [storeContextQuery.data?.myStoreCommerceMode, commerceMode, location.pathname, routerNavigate]);

    useEffect(() => {
        const channels = channelData?.channels;
        if (!channels || channelsLoading || channelsError || loadingAllChannelsRef.current) return;
        const loadedCount = channels.items.length;
        if (loadedCount >= channels.totalItems) return;
        loadingAllChannelsRef.current = true;
        void fetchMoreChannels({
            variables: { options: { skip: loadedCount, take: 100, sort: { code: 'ASC' } } },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                channels: {
                    ...fetchMoreResult.channels,
                    items: [
                        ...new Map(
                            [...previous.channels.items, ...fetchMoreResult.channels.items].map(channel => [
                                channel.id,
                                channel,
                            ]),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setChannelError(toUserFacingError(fetchError, '店铺列表未能全部加载'));
            })
            .finally(() => {
                loadingAllChannelsRef.current = false;
            });
    }, [channelData, channelsError, channelsLoading, fetchMoreChannels]);

    const [openMenu, setOpenMenu] = useState<string | null>('catalog');

    const [tabs, setTabs] = useState<OpenTab[]>([
        { path: '/dashboard', href: '/dashboard', label: '工作台' },
    ]);

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

    const visibleTabs = tabs.filter(tab => visibleTabPaths.includes(tab.path));
    const overflowTabs = tabs.filter(tab => !visibleTabPaths.includes(tab.path));

    // 全局 ⌘K 键盘快捷键与方向键/回车监听
    // 当前路由是外部导航状态，需要同步手风琴分组和已打开标签。
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
        } else if (wasMobileSidebarOpenRef.current) {
            sidebarToggleRef.current?.focus();
        }

        wasMobileSidebarOpenRef.current = isSidebarOpen;
    }, [isDesktop, isSidebarOpen]);

    useLayoutEffect(() => {
        // 扩展页面可以挂在与 URL 前缀不同的导航分组，应优先遵循注册信息。
        const extensionRoute = getNextAdminExtensionRoute(location.pathname);
        const nextOpenMenu = resolveAppShellOpenMenu(location.pathname, extensionRoute?.navItem?.sectionId);
        if (nextOpenMenu !== undefined) setOpenMenu(nextOpenMenu);

        const routeTitles: Record<string, string> = {
            '/dashboard': '工作台',
            '/profile': '个人中心',
            '/catalog/list': '商品列表',
            '/catalog/products/new': '发布新商品',
            '/catalog/categories': '分类与属性',
            '/catalog/inventory': '库存与仓库',
            '/catalog/card-pool': '发卡记录与异常',
            '/catalog/assets': '素材媒体库',
            '/sales/orders': '订单列表',
            '/sales/after-sales': '售后与退款',
            '/sales/reviews': '买家评价管理',
            '/customers/list': '客户管理',
            '/marketing/promotions': '优惠与促销',
            '/marketing/referrals': '分销与返利',
            '/storefront/decoration': '商城装修',
            '/storefront/content': '内容与页面',
            '/settings/store-profile': '店铺综合设置',
            '/settings/team': '员工与权限',
            '/settings/system-ops': '系统运维 [超管]',
        };

        let currentTitle = extensionRoute?.title ?? routeTitles[location.pathname];
        if (!currentTitle) {
            if (location.pathname.startsWith('/catalog/products/')) {
                currentTitle = '编辑商品详情';
            } else if (location.pathname.startsWith('/sales/orders/')) {
                currentTitle = '订单履约详情';
            }
        }

        if (currentTitle) {
            document.title = `${currentTitle} · MOYAO AI｜模钥管理后台`;
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
    }, [location.pathname, location.search]);

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
        if (
            isChannelSwitching ||
            channelToken === channelData?.activeChannel.token ||
            !requestAppNavigation('/dashboard')
        )
            return;
        setIsChannelSwitching(true);
        setChannelError('');
        try {
            await switchActiveChannel(channelToken);
            setTabs([{ path: '/dashboard', href: '/dashboard', label: '工作台' }]);
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
        const newTabs = tabs.filter(t => t.path !== path);
        if (location.pathname === path && newTabs.length > 0) {
            if (!navigate(newTabs[newTabs.length - 1].href)) return;
        } else if (newTabs.length === 0) {
            if (!navigate('/dashboard')) return;
        }
        setTabs(newTabs);
    };

    const closeOtherTabs = () => {
        const currentTab = tabs.find(t => t.path === location.pathname) || {
            path: '/dashboard',
            href: '/dashboard',
            label: '工作台',
        };
        setTabs([currentTab]);
        setIsMoreTabsOpen(false);
    };

    // ⌘K 快捷检索字典
    const allCmdItems = useMemo(
        () =>
            [
                { title: '工作台经营大盘与待办', path: '/dashboard', cat: '工作台', icon: LayoutDashboard },
                { title: '商品列表与多条件筛选', path: '/catalog/list', cat: '商品', icon: Package },
                {
                    title: '分类树、多规格模板与标签',
                    path: '/catalog/categories',
                    cat: '商品',
                    icon: FolderTree,
                },
                ...(showsPhysicalCatalog
                    ? [
                          {
                              title: '多仓库存总盘与出入库流水',
                              path: '/catalog/inventory',
                              cat: '商品',
                              icon: Boxes,
                          },
                      ]
                    : []),
                ...(showsDigitalCatalog
                    ? [
                          {
                              title: '发卡记录与异常',
                              path: '/catalog/card-pool',
                              cat: '商品',
                              icon: KeyRound,
                          },
                      ]
                    : []),
                { title: '素材媒体库管理', path: '/catalog/assets', cat: '商品', icon: Palette },
                {
                    title: '全量交易订单与待发货打单',
                    path: '/sales/orders',
                    cat: '订单与售后',
                    icon: ShoppingBag,
                },
                {
                    title: '售后退款工单审核流',
                    path: '/sales/after-sales',
                    cat: '订单与售后',
                    icon: RotateCcw,
                },
                {
                    title: '买家评价审核与官方回复',
                    path: '/sales/reviews',
                    cat: '订单与售后',
                    icon: MessageSquare,
                },
                { title: '客户资料、分组与订单关系', path: '/customers/list', cat: '客户', icon: Users },
                {
                    title: '优惠券、促销规则与秒杀专场',
                    path: '/marketing/promotions',
                    cat: '营销',
                    icon: Ticket,
                },
                { title: '分销返利团队与提现审批', path: '/marketing/referrals', cat: '营销', icon: Users },
                {
                    title: '可视化首页装修与移动端视口',
                    path: '/storefront/decoration',
                    cat: '店铺',
                    icon: Palette,
                },
                {
                    title: '全站公告、法律页面与推广落地页',
                    path: '/storefront/content',
                    cat: '店铺',
                    icon: Megaphone,
                },
                ...getNextAdminExtensionNavItems()
                    .filter(route => route.commandPalette !== false)
                    .map(route => ({
                        title: route.title,
                        path: route.path,
                        cat: extensionSectionLabel(route.navItem?.sectionId),
                        icon: route.navItem?.icon ?? Blocks,
                    })),
                {
                    title: '店铺设置 (多店铺/支付/运费/税率/域名)',
                    path: '/settings/store-profile',
                    cat: '系统与权限',
                    icon: Settings2,
                },
                {
                    title: '员工账号列表与角色权限矩阵',
                    path: '/settings/team',
                    cat: '系统与权限',
                    icon: ShieldCheck,
                },
                ...(isSuperAdmin
                    ? [
                          {
                              title: '系统运维、任务队列与全局配置',
                              path: '/settings/system-ops',
                              cat: '系统与权限',
                              icon: Terminal,
                          },
                      ]
                    : []),
            ].filter(item => canAccessPath(item.path)),
        [canAccessPath, isSuperAdmin, showsDigitalCatalog, showsPhysicalCatalog],
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

    const navItemClass = ({ isActive }: { isActive: boolean }) =>
        `pl-11 pr-3 py-2 rounded text-xs transition-colors block ${isActive ? 'text-blue-400 font-bold bg-white/5' : 'text-slate-400 hover:text-white hover:bg-white/5'}`;

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50">
            <a
                href="#main-content"
                className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-lg transition-transform focus:translate-y-0"
            >
                跳到主要内容
            </a>
            {isSidebarOpen && (
                <button
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
                className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-[#1c2128] text-slate-300 transition-[transform,width] duration-150 ease-out xl:relative xl:z-20 ${isSidebarOpen ? 'translate-x-0 xl:w-64' : '-translate-x-full xl:w-16 xl:translate-x-0'}`}
            >
                <div className="h-14 border-b border-white/10 flex items-center justify-center shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-blue-600 font-bold text-white shadow-lg shadow-blue-900/20">
                            <img
                                key={storeLogoUrl ?? 'moyao-ai'}
                                src={storeLogoUrl ?? adminBrandIcon}
                                alt=""
                                className="absolute inset-0 h-full w-full bg-white object-contain"
                                onError={event => {
                                    if (!event.currentTarget.src.endsWith(adminBrandIcon)) {
                                        event.currentTarget.src = adminBrandIcon;
                                    }
                                }}
                            />
                        </div>
                        {isSidebarOpen && (
                            <span className="font-bold text-white text-base tracking-wide">
                                MOYAO AI｜模钥管理后台
                            </span>
                        )}
                    </div>
                </div>

                <nav
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
                    {/* 1. 📊 工作台 */}
                    <NavLink
                        to="/dashboard"
                        aria-label="工作台"
                        className={({ isActive }) =>
                            `h-10 rounded-lg flex items-center transition-all ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} ${isActive ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`
                        }
                    >
                        <LayoutDashboard className="w-4 h-4 shrink-0" />
                        <span
                            className={`ml-3 text-xs whitespace-nowrap ${isSidebarOpen ? 'block' : 'hidden'}`}
                        >
                            工作台
                        </span>
                    </NavLink>

                    <div className="pt-2 pb-1">
                        {isSidebarOpen ? (
                            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                核心经营
                            </span>
                        ) : (
                            <div className="h-px bg-white/10 mx-4"></div>
                        )}
                    </div>

                    {/* 2. 🛍️ 商品 */}
                    <div>
                        <button
                            type="button"
                            aria-label="商品管理"
                            aria-expanded={openMenu === 'catalog'}
                            onClick={() => toggleMenu('catalog')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <Package className="w-4 h-4 shrink-0 text-blue-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                商品
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'catalog' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'catalog' ? 'max-h-96 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            <NavLink
                                allowed={canAccessPath('/catalog/list')}
                                to="/catalog/list"
                                className={navItemClass}
                            >
                                商品列表
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/catalog/categories')}
                                to="/catalog/categories"
                                className={navItemClass}
                            >
                                分类与属性
                            </NavLink>
                            <NavLink
                                allowed={showsPhysicalCatalog && canAccessPath('/catalog/inventory')}
                                to="/catalog/inventory"
                                className={navItemClass}
                            >
                                库存与仓库
                            </NavLink>
                            <NavLink
                                allowed={showsDigitalCatalog && canAccessPath('/catalog/card-pool')}
                                to="/catalog/card-pool"
                                className={navItemClass}
                            >
                                发卡记录与异常
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/catalog/assets')}
                                to="/catalog/assets"
                                className={navItemClass}
                            >
                                素材媒体库
                            </NavLink>
                            {getNextAdminExtensionNavItems('catalog').map(route => (
                                <NavLink
                                    key={route.id}
                                    allowed={canAccessPath(route.path)}
                                    to={route.path}
                                    className={navItemClass}
                                >
                                    {route.navItem?.label ?? route.title}
                                </NavLink>
                            ))}
                        </div>
                    </div>

                    {/* 3. 📦 订单与售后 */}
                    <div>
                        <button
                            type="button"
                            aria-label="订单与售后"
                            aria-expanded={openMenu === 'sales'}
                            onClick={() => toggleMenu('sales')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <ShoppingBag className="w-4 h-4 shrink-0 text-amber-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                订单与售后
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'sales' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'sales' ? 'max-h-60 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            <NavLink
                                allowed={canAccessPath('/sales/orders')}
                                to="/sales/orders"
                                className={navItemClass}
                            >
                                订单列表
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/sales/after-sales')}
                                to="/sales/after-sales"
                                className={navItemClass}
                            >
                                售后与退款
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/sales/reviews')}
                                to="/sales/reviews"
                                className={navItemClass}
                            >
                                买家评价管理
                            </NavLink>
                        </div>
                    </div>

                    {/* 4. 👥 客户 */}
                    <NavLink
                        allowed={canAccessPath('/customers/list')}
                        to="/customers/list"
                        aria-label="客户管理"
                        className={({ isActive }) =>
                            `h-10 rounded-lg flex items-center transition-all ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} ${isActive ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`
                        }
                    >
                        <Users className="w-4 h-4 shrink-0 text-violet-400" />
                        <span
                            className={`ml-3 text-xs whitespace-nowrap ${isSidebarOpen ? 'block' : 'hidden'}`}
                        >
                            客户
                        </span>
                    </NavLink>

                    {/* 5. 🎯 营销 */}
                    <div>
                        <button
                            type="button"
                            aria-label="营销管理"
                            aria-expanded={openMenu === 'marketing'}
                            onClick={() => toggleMenu('marketing')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <Percent className="w-4 h-4 shrink-0 text-rose-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                营销
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'marketing' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'marketing' ? 'max-h-60 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            <NavLink
                                allowed={canAccessPath('/marketing/promotions')}
                                to="/marketing/promotions"
                                className={navItemClass}
                            >
                                优惠与促销
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/marketing/referrals')}
                                to="/marketing/referrals"
                                className={navItemClass}
                            >
                                分销与返利
                            </NavLink>
                        </div>
                    </div>

                    {/* 5. 🎨 店铺 */}
                    <div>
                        <button
                            type="button"
                            aria-label="店铺管理"
                            aria-expanded={openMenu === 'storefront'}
                            onClick={() => toggleMenu('storefront')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <Palette className="w-4 h-4 shrink-0 text-purple-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                店铺
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'storefront' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'storefront' ? 'max-h-60 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            <NavLink
                                allowed={canAccessPath('/storefront/decoration')}
                                to="/storefront/decoration"
                                className={navItemClass}
                            >
                                商城装修
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/storefront/content')}
                                to="/storefront/content"
                                className={navItemClass}
                            >
                                内容与页面
                            </NavLink>
                        </div>
                    </div>

                    <div className="pt-2 pb-1">
                        {isSidebarOpen ? (
                            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                扩展与系统
                            </span>
                        ) : (
                            <div className="h-px bg-white/10 mx-4"></div>
                        )}
                    </div>

                    {/* 6. 🔌 插件与服务 */}
                    <div>
                        <button
                            type="button"
                            aria-label="插件与服务"
                            aria-expanded={openMenu === 'plugins'}
                            onClick={() => toggleMenu('plugins')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <Blocks className="w-4 h-4 shrink-0 text-cyan-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                插件与服务
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'plugins' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'plugins' ? 'max-h-80 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            {getNextAdminExtensionNavItems('plugins').map(route => (
                                <NavLink
                                    key={route.id}
                                    allowed={canAccessPath(route.path)}
                                    to={route.path}
                                    className={navItemClass}
                                >
                                    {route.navItem?.label ?? route.title}
                                </NavLink>
                            ))}
                        </div>
                    </div>

                    {/* 7. ⚙️ 系统与权限 */}
                    <div className="pb-4">
                        <button
                            type="button"
                            aria-label="系统与权限"
                            aria-expanded={openMenu === 'settings'}
                            onClick={() => toggleMenu('settings')}
                            className={`w-full h-10 rounded-lg flex items-center cursor-pointer transition-all text-left ${isSidebarOpen ? 'px-3' : 'justify-center w-12 mx-auto'} text-slate-400 hover:text-white hover:bg-white/5`}
                        >
                            <Settings2 className="w-4 h-4 shrink-0 text-emerald-400" />
                            <span
                                className={`ml-3 text-xs whitespace-nowrap flex-1 ${isSidebarOpen ? 'block' : 'hidden'}`}
                            >
                                系统与权限
                            </span>
                            {isSidebarOpen && (
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${openMenu === 'settings' ? 'rotate-180' : ''}`}
                                />
                            )}
                        </button>
                        <div
                            className={`overflow-hidden transition-[max-height,margin] duration-150 ease-out ${isSidebarOpen && openMenu === 'settings' ? 'max-h-80 mt-1 space-y-0.5' : 'max-h-0'}`}
                        >
                            <NavLink
                                allowed={canAccessPath('/settings/store-profile')}
                                to="/settings/store-profile"
                                className={navItemClass}
                            >
                                店铺综合设置
                            </NavLink>
                            <NavLink
                                allowed={canAccessPath('/settings/team')}
                                to="/settings/team"
                                className={navItemClass}
                            >
                                员工与权限
                            </NavLink>
                            {canAccessPath('/settings/system-ops') && (
                                <NavLink to="/settings/system-ops" className={navItemClass}>
                                    系统运维
                                </NavLink>
                            )}
                            {getNextAdminExtensionNavItems('settings').map(route => (
                                <NavLink
                                    key={route.id}
                                    allowed={canAccessPath(route.path)}
                                    to={route.path}
                                    className={navItemClass}
                                >
                                    {route.navItem?.label ?? route.title}
                                </NavLink>
                            ))}
                        </div>
                    </div>
                </nav>
            </aside>

            {/* 主工作区 */}
            <div
                aria-hidden={!isDesktop && isSidebarOpen}
                inert={!isDesktop && isSidebarOpen ? true : undefined}
                className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative"
            >
                <header className="relative z-30 flex h-14 shrink-0 items-center justify-between bg-white px-3 shadow-2xs sm:px-6">
                    <button
                        ref={sidebarToggleRef}
                        type="button"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                        aria-label="切换侧边栏展开折叠"
                        aria-expanded={isSidebarOpen}
                        aria-controls="app-sidebar"
                    >
                        <Menu className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-2 sm:gap-4">
                        <label className="relative flex items-center gap-1.5 text-xs font-bold text-slate-600">
                            <Store className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">当前店铺</span>
                            <select
                                value={channelData?.activeChannel.token ?? ''}
                                onChange={event => void handleChannelChange(event.target.value)}
                                disabled={channelControlsLoading || isChannelSwitching || !channelData}
                                aria-label="切换当前店铺"
                                title={channelError || '切换后商品、订单、库存等数据将按所选店铺重新加载'}
                                className={`h-8 max-w-28 rounded-lg border bg-white pl-2 pr-6 text-xs font-bold outline-none sm:max-w-44 ${channelError ? 'border-rose-300 text-rose-700' : 'border-slate-200 text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'}`}
                            >
                                {!channelData && <option value="">读取店铺…</option>}
                                {channelData?.channels.items.map(channel => (
                                    <option key={channel.id} value={channel.token}>
                                        {getChannelDisplayLabel(channel)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="relative hidden w-64 items-center rounded-lg bg-slate-100 py-1.5 pl-9 pr-2 text-xs text-slate-400 transition-colors hover:bg-blue-50 md:flex"
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
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setIsCmdKOpen(true);
                                setCmdSelectedIndex(0);
                            }}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 md:hidden"
                            aria-label="搜索管理功能"
                        >
                            <Search className="h-4 w-4" />
                        </button>
                        <ThemeToggleButton />
                        {/* 右上角用户菜单 (包含个人中心与退出) */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsMoreTabsOpen(false);
                                    setIsUserMenuOpen(current => !current);
                                }}
                                className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-xs cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                                aria-label="打开管理员菜单"
                                aria-expanded={isUserMenuOpen}
                                aria-haspopup="menu"
                                aria-controls="administrator-menu"
                            >
                                {administratorInitial}
                            </button>

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
                                            <button
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
                                            </button>
                                            <button
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
                                            </button>
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
                                                        <button
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
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="border-t border-slate-100 pt-1">
                                            <button
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
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </header>

                {/* 标签栏 */}
                <div className="relative z-20 h-10 shrink-0 select-none border-b border-t border-slate-200 bg-white flex items-center justify-between">
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
                                    className={`inline-flex shrink-0 items-center rounded-md border text-xs transition-all ${isActive ? 'border-blue-200 bg-blue-50 font-bold text-blue-600 shadow-2xs' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                                >
                                    <NavLink to={tab.href} className="px-3 py-1">
                                        {tab.label}
                                    </NavLink>
                                    {tabs.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={event => closeTab(event, tab.path)}
                                            aria-label={`关闭${tab.label}标签`}
                                            className="mr-1 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
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
                        <button
                            type="button"
                            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${overflowTabs.length ? 'cursor-pointer' : 'cursor-default'} ${isMoreTabsOpen ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-600 hover:text-blue-600 hover:bg-slate-100'}`}
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
                        </button>

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
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="text-slate-500 hover:text-blue-600 cursor-pointer"
                                                    onClick={closeOtherTabs}
                                                >
                                                    关闭其他
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className="text-rose-600 hover:text-rose-700 font-normal cursor-pointer"
                                                onClick={() => {
                                                    if (!navigate('/dashboard')) return;
                                                    setTabs([
                                                        {
                                                            path: '/dashboard',
                                                            href: '/dashboard',
                                                            label: '工作台',
                                                        },
                                                    ]);
                                                    setIsMoreTabsOpen(false);
                                                }}
                                            >
                                                关闭全部
                                            </button>
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
                                                    <button
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
                                                    </button>
                                                    {tabs.length > 1 && (
                                                        <button
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
                                                        </button>
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
                    {currentRouteRequiresPermission && profileLoading ? (
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
                                <button
                                    type="button"
                                    onClick={() => void refetchProfile()}
                                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                >
                                    重新核验权限
                                </button>
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
                                <button
                                    type="button"
                                    onClick={() => navigate('/dashboard')}
                                    className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                >
                                    返回工作台
                                </button>
                            </section>
                        </div>
                    ) : (
                        <Suspense fallback={<RouteLoadingFallback />}>
                            <AdminPermissionsProvider permissions={activePermissions}>
                                <CustomFieldsProvider>
                                    <Outlet />
                                </CustomFieldsProvider>
                            </AdminPermissionsProvider>
                        </Suspense>
                    )}
                </div>
            </div>

            {/* ⌘K 全局搜索弹窗 (Command Palette) */}
            {isCmdKOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-start justify-center pt-24"
                    onClick={() => setIsCmdKOpen(false)}
                >
                    <AccessibleDialogSurface
                        accessibleName="全局功能搜索"
                        onRequestClose={() => setIsCmdKOpen(false)}
                        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-scaleIn border border-slate-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center px-4 border-b border-slate-100">
                            <Search className="w-5 h-5 text-blue-500" />
                            <input
                                type="text"
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
                            <div className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                                ESC
                            </div>
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
                                        <button
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
                                        </button>
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
