import { createLink, Link } from '@tanstack/react-router';
import { ShoppingCart, UserRound } from 'lucide-react';
import { type AnchorHTMLAttributes, forwardRef, lazy, Suspense, useState } from 'react';

import { authOverlayForNavigation } from '../../auth-overlay-navigation';
import { routeFromHash } from '../../storefront-router';
import { BrandLogo } from '../../storefront-ui/brand-logo';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';
import { CountBadge, countBadgeLabel } from './count-badge';
import { LocalePreferencesSheet, LocalePreferencesTrigger } from './locale-preferences';

const DesktopSearch = lazy(() => import('./desktop-search'));

// The router's destination can be active while the previous page is still visible.
const DesktopNavigationLink = createLink(
    forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { current: boolean }>(
        function DesktopNavigationAnchor({ current, ...props }, ref) {
            const context = useStorefront();
            return (
                <a
                    {...props}
                    ref={ref}
                    aria-current={current ? 'page' : undefined}
                    data-status={current ? 'active' : undefined}
                    onClick={event => {
                        const next = props.href?.startsWith('/') ? routeFromHash(`#${props.href}`) : null;
                        if (
                            next &&
                            context.navigate &&
                            authOverlayForNavigation(next, Boolean(context.customer)) &&
                            !event.defaultPrevented &&
                            event.button === 0 &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey
                        ) {
                            event.preventDefault();
                            context.navigate(next);
                        } else props.onClick?.(event);
                    }}
                />
            );
        },
    ),
);

function activeNavigationRoute(route: string): string {
    if (route === 'product' || route === 'search') return 'category';
    if (route === 'purchase' || route === 'checkout' || route === 'payment') return 'cart';
    if (
        [
            'orders',
            'logistics',
            'order-detail',
            'addresses',
            'account-security',
            'favorites',
            'history',
            'notifications',
            'announcements',
            'coupons',
            'referral',
            'reviews',
            'support',
        ].includes(route)
    ) {
        return 'account';
    }
    return route;
}

export function DesktopHeader({
    navigationBlock,
    cartQuantity,
}: {
    navigationBlock?: StorefrontContentBlock;
    cartQuantity: number;
}) {
    const context = useStorefront();
    const isZh = context.language === 'zh';
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const navigationItems = resolveBottomNavigationItems(navigationBlock, context.language).filter(
        item => item.routeName !== 'cart',
    );
    const visibleRoute = context.displayedRoute ?? context.route;
    const activeRoute = activeNavigationRoute(visibleRoute.name);

    return (
        <header className={`proto-desktop-header${visibleRoute.name === 'search' ? ' is-search-page' : ''}`}>
            <div className="proto-header-inner">
                <div className="proto-header-left">
                    <Link className="proto-brand" to="/" aria-label={context.storefrontName}>
                        <BrandLogo
                            url={context.logoUrl}
                            name={context.storefrontName}
                            className="proto-brand-badge"
                        />
                        <span className="proto-brand-text">{context.storefrontName}</span>
                    </Link>
                    <nav className="proto-nav-links" aria-label={isZh ? '主导航' : 'Main navigation'}>
                        {navigationItems.map(item => (
                            <DesktopNavigationLink
                                key={item.key}
                                to={item.target}
                                className={`proto-nav-link ${activeRoute === item.routeName ? 'is-active' : ''}`}
                                current={activeRoute === item.routeName}
                            >
                                {item.label}
                            </DesktopNavigationLink>
                        ))}
                    </nav>
                </div>

                <div className="proto-header-search">
                    <Suspense fallback={<div className="proto-search-placeholder" aria-busy="true" />}>
                        <DesktopSearch />
                    </Suspense>
                </div>

                <div className="proto-header-right">
                    <LocalePreferencesTrigger
                        className="proto-header-action"
                        language={context.language}
                        currencyCode={context.displayCurrencyCode}
                        expanded={preferencesOpen}
                        onClick={() => setPreferencesOpen(true)}
                    />
                    <DesktopNavigationLink
                        to="/cart"
                        className="proto-cart-link proto-header-action"
                        current={activeRoute === 'cart'}
                        aria-label={countBadgeLabel(isZh ? '购物车' : 'Cart', cartQuantity)}
                    >
                        <ShoppingCart className="proto-cart-icon" aria-hidden="true" />
                        <span className="proto-cart-text">{isZh ? '购物车' : 'Cart'}</span>
                        <CountBadge count={cartQuantity} />
                    </DesktopNavigationLink>
                    <DesktopNavigationLink
                        to={context.customer ? '/account' : '/login'}
                        className="proto-login-btn proto-header-action"
                        current={activeRoute === 'account' || visibleRoute.name === 'login'}
                    >
                        <UserRound aria-hidden="true" />
                        {context.customer ? (isZh ? '我的账户' : 'My account') : isZh ? '登录' : 'Sign in'}
                    </DesktopNavigationLink>
                </div>
            </div>
            {preferencesOpen ? (
                <LocalePreferencesSheet
                    storefrontLabel={context.storefrontName}
                    language={context.language}
                    currencyCodes={
                        context.currencySelectorEnabled
                            ? context.availableCurrencyCodes
                            : [context.displayCurrencyCode]
                    }
                    selectedCurrencyCode={context.displayCurrencyCode}
                    currencyLoading={context.cartLoading}
                    onToggleLanguage={context.toggleLanguage}
                    onSelectCurrency={context.switchCurrency}
                    onClose={() => setPreferencesOpen(false)}
                />
            ) : null}
        </header>
    );
}
