import { Link } from '@tanstack/react-router';

import { RouteState } from '../../storefront-router';
import { useStorefront } from '../../StorefrontContext';

export const desktopAccountSections = [
    { path: '/account', label: ['账户概览', 'Overview'], routes: ['account'] },
    { path: '/orders', label: ['我的订单', 'Orders'], routes: ['orders', 'order-detail', 'logistics'] },
    { path: '/favorites', label: ['我的收藏', 'Favorites'], routes: ['favorites'] },
    { path: '/coupons', label: ['优惠券', 'Coupons'], routes: ['coupons'] },
    { path: '/addresses', label: ['地址管理', 'Addresses'], routes: ['addresses'] },
    { path: '/account-security', label: ['账户设置', 'Settings'], routes: ['account-security'] },
] as const;

export function isDesktopAccountRoute(name: RouteState['name']) {
    return desktopAccountSections.some(section => (section.routes as readonly string[]).includes(name));
}

export function DesktopAccountNavigation() {
    const { route, language } = useStorefront();
    if (!isDesktopAccountRoute(route.name)) return null;
    return (
        <nav
            className="desktop-account-navigation desktop-local-navigation"
            aria-label={language === 'zh' ? '账户导航' : 'Account navigation'}
        >
            {desktopAccountSections.map(section => (
                <Link
                    key={section.path}
                    to={section.path}
                    aria-current={
                        (section.routes as readonly string[]).includes(route.name) ? 'page' : undefined
                    }
                >
                    {section.label[language === 'zh' ? 0 : 1]}
                </Link>
            ))}
        </nav>
    );
}
