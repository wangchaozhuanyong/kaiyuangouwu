import { createLink, Link } from '@tanstack/react-router';
import { Search, ShoppingCart, UserRound } from 'lucide-react';
import { type AnchorHTMLAttributes, forwardRef, useEffect, useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';
import { LocalePreferencesSheet, LocalePreferencesTrigger } from './locale-preferences';

// The router's destination can be active while the previous page is still visible.
const DesktopNavigationLink = createLink(
    forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { current: boolean }>(
        function DesktopNavigationAnchor({ current, ...props }, ref) {
            return (
                <a
                    {...props}
                    ref={ref}
                    aria-current={current ? 'page' : undefined}
                    data-status={current ? 'active' : undefined}
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
    const openSearch = () => {
        context.navigate({ name: 'search' });
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (visibleRoute.name === 'search') {
                    document.querySelector<HTMLInputElement>('.search-page .search-header input')?.focus();
                } else {
                    context.navigate({ name: 'search' });
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [context.navigate, context.route.name]);

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
                        <span className="proto-brand-copy">
                            <span className="proto-brand-text">{context.storefrontName}</span>
                            <small>{typeof window === 'undefined' ? '' : window.location.hostname}</small>
                        </span>
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

                {visibleRoute.name !== 'search' && (
                    <div className="proto-header-search">
                        <button
                            type="button"
                            className="proto-search-open"
                            aria-label={isZh ? '打开商品搜索' : 'Open product search'}
                            onClick={openSearch}
                        >
                            <span>{isZh ? '搜索商品、分类' : 'Search products and categories'}</span>
                            <span className="proto-search-open-action" aria-hidden="true">
                                <Search aria-hidden="true" />
                            </span>
                        </button>
                    </div>
                )}

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
                        aria-label={isZh ? '购物车' : 'Cart'}
                    >
                        <ShoppingCart className="proto-cart-icon" aria-hidden="true" />
                        <span className="proto-cart-text">{isZh ? '购物车' : 'Cart'}</span>
                        {cartQuantity > 0 && (
                            <span className="proto-cart-badge">
                                {cartQuantity > 99 ? '99+' : cartQuantity}
                            </span>
                        )}
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
                    language={context.language}
                    currencyCodes={
                        context.currencySelectorEnabled
                            ? context.availableCurrencyCodes
                            : [context.displayCurrencyCode]
                    }
                    selectedCurrencyCode={context.displayCurrencyCode}
                    currencyLoading={context.cartLoading}
                    marketLabel={context.market.label}
                    onToggleLanguage={context.toggleLanguage}
                    onSelectCurrency={context.switchCurrency}
                    onClose={() => setPreferencesOpen(false)}
                />
            ) : null}
        </header>
    );
}
