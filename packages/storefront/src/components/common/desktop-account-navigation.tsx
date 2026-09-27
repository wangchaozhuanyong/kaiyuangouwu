import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
    Bell,
    Check,
    ChevronRight,
    Headphones,
    Heart,
    History,
    MapPin,
    Package,
    RotateCcw,
    ShieldCheck,
    Star,
    TicketPercent,
    UserRound,
    WalletCards,
} from 'lucide-react';

import { SafeImage } from '../../safe-image';
import { RouteState } from '../../storefront-router';
import { useStorefront } from '../../StorefrontContext';
import { supportServiceDetails } from '../../support-content';

type AccountPath =
    | '/account'
    | '/orders'
    | '/coupons'
    | '/notifications'
    | '/favorites'
    | '/history'
    | '/reviews'
    | '/referral'
    | '/addresses'
    | '/account-security';

type AccountSection = {
    path: AccountPath;
    label: readonly [string, string];
    routes: ReadonlyArray<RouteState['name']>;
    icon: LucideIcon;
    tab?: 'service';
};

const desktopAccountGroups: ReadonlyArray<{
    label: readonly [string, string];
    items: readonly AccountSection[];
}> = [
    {
        label: ['订单与资产', 'Orders & assets'],
        items: [
            { path: '/account', label: ['账户概览', 'Overview'], routes: ['account'], icon: UserRound },
            {
                path: '/orders',
                label: ['我的订单', 'Orders'],
                routes: ['orders', 'order-detail', 'logistics'],
                icon: Package,
            },
            {
                path: '/orders',
                label: ['售后中心', 'After-sales'],
                routes: ['orders'],
                icon: RotateCcw,
                tab: 'service',
            },
            { path: '/coupons', label: ['优惠券', 'Coupons'], routes: ['coupons'], icon: TicketPercent },
            {
                path: '/notifications',
                label: ['消息通知', 'Notifications'],
                routes: ['notifications'],
                icon: Bell,
            },
        ],
    },
    {
        label: ['关注与权益', 'Saved & rewards'],
        items: [
            { path: '/favorites', label: ['收藏夹', 'Favorites'], routes: ['favorites'], icon: Heart },
            { path: '/history', label: ['浏览足迹', 'Browsing history'], routes: ['history'], icon: History },
            { path: '/reviews', label: ['评价中心', 'Reviews'], routes: ['reviews'], icon: Star },
            {
                path: '/referral',
                label: ['邀请返利', 'Referral rewards'],
                routes: ['referral'],
                icon: WalletCards,
            },
        ],
    },
    {
        label: ['设置', 'Settings'],
        items: [
            { path: '/addresses', label: ['收货地址', 'Addresses'], routes: ['addresses'], icon: MapPin },
            {
                path: '/account-security',
                label: ['安全中心', 'Security'],
                routes: ['account-security'],
                icon: ShieldCheck,
            },
        ],
    },
];

export const desktopAccountSections = desktopAccountGroups.flatMap(group => group.items);

export function isDesktopAccountRoute(name: RouteState['name']) {
    return (
        name === 'support' ||
        desktopAccountSections.some(section => (section.routes as readonly string[]).includes(name))
    );
}

export function DesktopAccountNavigation() {
    const { route, language, customer, supportContent } = useStorefront();
    const service = supportContent ? supportServiceDetails(supportContent, language) : null;
    const isZh = language === 'zh';
    const name = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress
        : isZh
          ? '欢迎来到店铺'
          : 'Welcome';
    if (!isDesktopAccountRoute(route.name)) return null;
    return (
        <nav
            className="desktop-account-navigation"
            aria-label={language === 'zh' ? '账户导航' : 'Account navigation'}
        >
            <div className="desktop-account-profile">
                <span className="desktop-account-profile-avatar" aria-hidden="true">
                    {customer?.avatar?.preview ? (
                        <SafeImage src={customer.avatar.preview} alt="" />
                    ) : (
                        <UserRound />
                    )}
                </span>
                <div className="desktop-account-profile-copy">
                    <strong>{name}</strong>
                    {customer ? (
                        <span title={customer.emailAddress}>{customer.emailAddress}</span>
                    ) : (
                        <Link to="/login">{isZh ? '登录 / 注册' : 'Sign in / Register'}</Link>
                    )}
                </div>
            </div>
            {desktopAccountGroups.map(group => (
                <div className="desktop-account-group" key={group.label[0]}>
                    <span className="desktop-account-group-title">{group.label[isZh ? 0 : 1]}</span>
                    {group.items.map(section => {
                        const selected =
                            (section.routes as readonly string[]).includes(route.name) &&
                            (route.name !== 'orders' ||
                                (section.tab === 'service'
                                    ? route.tab === 'service'
                                    : route.tab !== 'service'));
                        const label = (
                            <>
                                <section.icon
                                    className="desktop-account-navigation-icon"
                                    aria-hidden="true"
                                />
                                <span>{section.label[isZh ? 0 : 1]}</span>
                                <span className="desktop-account-navigation-state" aria-hidden="true">
                                    {selected ? <Check /> : <ChevronRight />}
                                </span>
                            </>
                        );
                        return section.tab === 'service' ? (
                            <Link
                                key="after-sales"
                                to="/orders"
                                search={{ tab: 'service' }}
                                aria-current={selected ? 'page' : undefined}
                            >
                                {label}
                            </Link>
                        ) : section.path === '/orders' ? (
                            <Link
                                key="orders"
                                to="/orders"
                                search={{ tab: undefined }}
                                activeOptions={{ explicitUndefined: true }}
                                aria-current={selected ? 'page' : undefined}
                            >
                                {label}
                            </Link>
                        ) : (
                            <Link
                                key={section.path}
                                to={section.path}
                                aria-current={selected ? 'page' : undefined}
                            >
                                {label}
                            </Link>
                        );
                    })}
                </div>
            ))}
            <Link
                className="desktop-account-support"
                to="/support"
                aria-current={route.name === 'support' ? 'page' : undefined}
            >
                <Headphones aria-hidden="true" />
                <span>
                    <strong>{isZh ? '在线客服' : 'Customer support'}</strong>
                    <small>
                        {service
                            ? `${service.days} ${service.time}`
                            : isZh
                              ? '查看帮助与联系方式'
                              : 'Help and contact details'}
                    </small>
                </span>
                <ChevronRight aria-hidden="true" />
            </Link>
        </nav>
    );
}
