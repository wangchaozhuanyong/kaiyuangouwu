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
    ReceiptText,
    Search,
    ShoppingCart,
    Star,
    TicketPercent,
    UserRound,
} from 'lucide-react';
import { ComponentType, CSSProperties } from 'react';
import { twMerge } from 'tailwind-merge';

import { preloadStorefrontRouteComponent } from '../../route-component-preload';
import { SafeImage } from '../../safe-image';
import { rootPages, RouteName } from '../../storefront-router';
import { StorefrontContentBlock, StorefrontLanguage } from '../../types';

import { CountBadge, countBadgeLabel } from './count-badge';

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

const activeColors = Array.from({ length: 5 }, () => 'var(--interaction-ink)');

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

export function mobileBottomNavigationLabel(
    item: BottomNavigationItem,
    language: StorefrontLanguage,
): string {
    if (language === 'en' && item.routeName === 'services' && item.label.length > 8) return 'Services';
    return item.label;
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
            className="storefront-bottom-nav"
            style={{ gridTemplateColumns: 'repeat(' + items.length + ', minmax(0, 1fr))' }}
            aria-label={isZh ? '主导航' : 'Main navigation'}
        >
            {items.map(item => {
                const isActive = activeItemRoute === item.routeName;
                const Icon = targetIcons[item.target];
                const preloadTarget = () => {
                    void preloadStorefrontRouteComponent(item.routeName);
                    void router.preloadRoute({ to: item.target });
                };
                return (
                    <a
                        key={item.key}
                        className={cn(
                            'flex w-[56px] min-w-[56px] flex-col items-center justify-center justify-self-center rounded-xl border-0 bg-transparent p-0.5 text-[var(--muted)] transition-colors lg:w-[96px] lg:min-w-[96px] lg:gap-[3px] hover:text-[var(--interaction-ink)]',
                            isActive && 'weight-bold text-[var(--interaction-ink)]',
                        )}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={countBadgeLabel(
                            item.label,
                            item.routeName === 'cart' ? cartQuantity : undefined,
                        )}
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
                        onFocus={preloadTarget}
                        onMouseEnter={preloadTarget}
                        onTouchStart={preloadTarget}
                    >
                        <span className="count-badge-anchor">
                            {item.iconUrl ? (
                                <SafeImage className="size-6 object-contain" src={item.iconUrl} alt="" />
                            ) : (
                                <Icon
                                    className="size-6"
                                    style={{ color: isActive ? item.activeColor : 'var(--muted)' }}
                                />
                            )}
                            {item.routeName === 'cart' && <CountBadge count={cartQuantity} overlay />}
                        </span>
                        <span
                            className={clsx(
                                'max-w-full overflow-hidden text-ellipsis whitespace-nowrap type-navigation-compact lg:hidden',
                                isActive ? 'weight-bold' : 'weight-medium',
                            )}
                            style={{
                                color: isActive ? item.activeColor : 'var(--muted)',
                            }}
                        >
                            {mobileBottomNavigationLabel(item, language)}
                        </span>
                        <span
                            className={clsx(
                                'hidden max-w-full overflow-hidden text-ellipsis whitespace-nowrap type-helper lg:block',
                                isActive ? 'weight-bold' : 'weight-medium',
                            )}
                            style={{
                                color: isActive ? item.activeColor : 'var(--muted)',
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
