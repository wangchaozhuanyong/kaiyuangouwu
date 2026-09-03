/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { useNavigate, useRouter } from '@tanstack/react-router';
import clsx from 'clsx';
import {
    Bell,
    BriefcaseBusiness,
    Headphones,
    Heart,
    History,
    House,
    LayoutGrid,
    Megaphone,
    ReceiptText,
    Search,
    ShoppingCart,
    Star,
    TicketPercent,
    UserRound,
} from 'lucide-react';
import { ComponentType, CSSProperties } from 'react';
import { twMerge } from 'tailwind-merge';

import { rootPages, RouteName } from '../../storefront-router';
import { StorefrontContentBlock, StorefrontLanguage } from '../../types';

function cn(...classes: Array<string | undefined | null | false>) {
    return twMerge(clsx(classes));
}

export const navigationTargetRoutes = {
    '/': 'home',
    '/category': 'category',
    '/services': 'services',
    '/search': 'search',
    '/cart': 'cart',
    '/account': 'account',
    '/orders': 'orders',
    '/coupons': 'coupons',
    '/favorites': 'favorites',
    '/history': 'history',
    '/notifications': 'notifications',
    '/announcements': 'announcements',
    '/support': 'support',
    '/reviews': 'reviews',
} as const satisfies Record<string, RouteName>;

export type NavigationTargetPath = keyof typeof navigationTargetRoutes;

export interface BottomNavigationItem {
    key: string;
    label: string;
    target: NavigationTargetPath;
    routeName: RouteName;
    iconUrl: string | null;
    activeColor: string;
}

const activeColors = ['#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#8B5CF6'] as const;

const targetIcons: Record<
    NavigationTargetPath,
    ComponentType<{ className?: string; style?: CSSProperties }>
> = {
    '/': House,
    '/category': LayoutGrid,
    '/services': BriefcaseBusiness,
    '/search': Search,
    '/cart': ShoppingCart,
    '/account': UserRound,
    '/orders': ReceiptText,
    '/coupons': TicketPercent,
    '/favorites': Heart,
    '/history': History,
    '/notifications': Bell,
    '/announcements': Megaphone,
    '/support': Headphones,
    '/reviews': Star,
};

function isNavigationTargetPath(value: string | null): value is NavigationTargetPath {
    return value != null && Object.prototype.hasOwnProperty.call(navigationTargetRoutes, value);
}

function defaultNavigationItems(language: StorefrontLanguage): BottomNavigationItem[] {
    const isZh = language === 'zh';
    return [
        { key: 'default-home', label: isZh ? '首页' : 'Home', target: '/', routeName: 'home' },
        {
            key: 'default-category',
            label: isZh ? '商品' : 'Shop',
            target: '/category',
            routeName: 'category',
        },
        {
            key: 'default-services',
            label: isZh ? '智能服务' : 'Intelligent services',
            target: '/services',
            routeName: 'services',
        },
        { key: 'default-cart', label: isZh ? '购物车' : 'Cart', target: '/cart', routeName: 'cart' },
        {
            key: 'default-account',
            label: isZh ? '我的' : 'Account',
            target: '/account',
            routeName: 'account',
        },
    ].map((item, index) => ({
        ...item,
        iconUrl: null,
        activeColor: activeColors[index],
    })) as BottomNavigationItem[];
}

export function resolveBottomNavigationItems(
    navigationBlock: StorefrontContentBlock | undefined,
    language: StorefrontLanguage,
): BottomNavigationItem[] {
    const configured = navigationBlock?.items
        .filter(item => item.enabled && isNavigationTargetPath(item.targetValue) && item.label.trim())
        .slice(0, 5)
        .map((item, index) => ({
            key: item.id || 'configured-' + index,
            label: item.label.trim(),
            target: item.targetValue as NavigationTargetPath,
            routeName: navigationTargetRoutes[item.targetValue as NavigationTargetPath],
            iconUrl: item.imageUrl,
            activeColor: activeColors[index],
        }));
    return configured?.length ? configured : defaultNavigationItems(language);
}

export function shouldShowBottomNavigation(
    activeRoute: RouteName,
    navigationBlock: StorefrontContentBlock | undefined,
): boolean {
    if (rootPages.includes(activeRoute as (typeof rootPages)[number])) return true;
    if (!navigationBlock) return false;
    return navigationBlock.items.some(
        item =>
            item.enabled &&
            isNavigationTargetPath(item.targetValue) &&
            navigationTargetRoutes[item.targetValue] === activeRoute,
    );
}

function groupedActiveRoute(route: RouteName): RouteName {
    if (route === 'product' || route === 'search') return 'category';
    if (route === 'purchase' || route === 'checkout' || route === 'payment') return 'cart';
    if (rootPages.includes(route as (typeof rootPages)[number])) return route;
    return 'account';
}

export function BottomNavigation({
    activeRoute,
    cartQuantity,
    language,
    navigationBlock,
}: {
    activeRoute: RouteName;
    cartQuantity: number;
    language: StorefrontLanguage;
    navigationBlock?: StorefrontContentBlock;
}) {
    const isZh = language === 'zh';
    const navigate = useNavigate();
    const router = useRouter();
    const items = resolveBottomNavigationItems(navigationBlock, language);
    const exactActiveItem = items.find(item => item.routeName === activeRoute);
    const activeItemRoute = exactActiveItem?.routeName ?? groupedActiveRoute(activeRoute);

    return (
        <nav
            className="storefront-bottom-nav fixed bottom-0 left-1/2 z-40 grid h-[calc(var(--bottom-navigation-height)+env(safe-area-inset-bottom,0px))] w-full max-w-[430px] border-t border-black/5 bg-white/95 px-2 pb-[calc(8px+env(safe-area-inset-bottom,0px))] pt-1.5 shadow-[0_-2px_14px_rgba(15,23,42,0.04)] backdrop-blur-md lg:top-0 lg:bottom-auto lg:h-[72px] lg:max-w-[420px] lg:border-t-0 lg:bg-transparent lg:shadow-none lg:backdrop-blur-none"
            style={{ gridTemplateColumns: 'repeat(' + items.length + ', minmax(0, 1fr))' }}
            aria-label={isZh ? '主导航' : 'Main navigation'}
        >
            {items.map(item => {
                const isActive = activeItemRoute === item.routeName;
                const Icon = targetIcons[item.target];
                return (
                    <a
                        key={item.key}
                        className={cn(
                            'flex w-[56px] min-w-[56px] flex-col items-center justify-center justify-self-center rounded-xl border-0 bg-transparent p-0.5 text-slate-500 transition-transform active:scale-95 lg:gap-[3px] lg:hover:bg-slate-100 lg:hover:text-slate-900',
                            isActive && 'font-bold text-slate-900 lg:hover:bg-transparent',
                        )}
                        aria-current={isActive ? 'page' : undefined}
                        href={item.target}
                        onClick={event => {
                            if (
                                event.defaultPrevented ||
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                            ) {
                                return;
                            }
                            event.preventDefault();
                            void navigate({ to: item.target });
                        }}
                        onFocus={() => void router.preloadRoute({ to: item.target })}
                        onMouseEnter={() => void router.preloadRoute({ to: item.target })}
                        onTouchStart={() => void router.preloadRoute({ to: item.target })}
                    >
                        <span className="relative flex h-[24px] w-[26px] items-center justify-center">
                            {item.iconUrl ? (
                                <img
                                    className={cn(
                                        'size-6 object-contain transition-transform duration-200',
                                        isActive && 'scale-[1.15] drop-shadow-sm',
                                    )}
                                    src={item.iconUrl}
                                    alt=""
                                />
                            ) : (
                                <Icon
                                    className={cn(
                                        'size-6 transition-transform duration-200',
                                        isActive && 'scale-[1.15] drop-shadow-sm',
                                    )}
                                    style={{ color: isActive ? item.activeColor : '#64748B' }}
                                />
                            )}
                            {item.routeName === 'cart' && cartQuantity > 0 && (
                                <b className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-[1.5px] border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                                    {cartQuantity > 99 ? '99+' : cartQuantity}
                                </b>
                            )}
                        </span>
                        <span
                            className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight lg:text-[13px]"
                            style={{
                                color: isActive ? item.activeColor : '#64748B',
                                fontWeight: isActive ? 700 : 500,
                            }}
                        >
                            {item.label}
                        </span>
                    </a>
                );
            })}
        </nav>
    );
}
