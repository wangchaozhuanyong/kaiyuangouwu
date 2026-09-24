import { Link } from '@tanstack/react-router';
import { Search, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';
import { LocalePreferencesSheet, LocalePreferencesTrigger } from './locale-preferences';

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
    const [query, setQuery] = useState(context.route.term ?? '');
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const navigationItems = resolveBottomNavigationItems(navigationBlock, context.language).filter(
        item => item.routeName !== 'cart',
    );
    const activeRoute = activeNavigationRoute(context.route.name);
    const searchResultsOpen = context.route.name === 'search' && !!context.route.term?.trim();
    const openSearch = () => {
        if (context.route.name === 'search' && !context.route.term?.trim()) {
            document.querySelector<HTMLInputElement>('.search-page .search-header input')?.focus();
            return;
        }
        context.navigate({ name: 'search' });
    };

    useEffect(() => setQuery(context.route.term ?? ''), [context.route.term]);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (searchInputRef.current) {
                    searchInputRef.current.focus();
                    searchInputRef.current.select();
                } else if (context.route.name === 'search') {
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
        <header className="proto-desktop-header">
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
                            <Link
                                key={item.key}
                                to={item.target}
                                className={`proto-nav-link ${activeRoute === item.routeName ? 'is-active' : ''}`}
                                aria-current={activeRoute === item.routeName ? 'page' : undefined}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="proto-header-search">
                    {searchResultsOpen ? (
                        <form
                            className="proto-search-form"
                            role="search"
                            action="/search"
                            autoComplete="off"
                            onSubmit={event => {
                                event.preventDefault();
                                const next = query.trim();
                                context.navigate(next ? { name: 'search', term: next } : { name: 'search' });
                            }}
                        >
                            <Search className="proto-search-icon" aria-hidden="true" />
                            <input
                                ref={searchInputRef}
                                className="proto-search-input"
                                aria-label={isZh ? '搜索商品' : 'Search products'}
                                placeholder={isZh ? '搜索商品' : 'Search products'}
                                name="term"
                                type="search"
                                autoComplete="off"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                            />
                            <button type="submit" className="proto-search-submit">
                                {isZh ? '搜索' : 'Search'}
                            </button>
                        </form>
                    ) : (
                        <button
                            type="button"
                            className="proto-search-open"
                            aria-label={isZh ? '打开商品搜索' : 'Open product search'}
                            onClick={openSearch}
                        >
                            <Search aria-hidden="true" />
                            <span>{isZh ? '搜索商品、分类' : 'Search products and categories'}</span>
                            <span className="proto-search-open-action" aria-hidden="true">
                                {isZh ? '搜索' : 'Search'}
                            </span>
                        </button>
                    )}
                </div>

                <div className="proto-header-right">
                    <LocalePreferencesTrigger
                        language={context.language}
                        currencyCode={context.displayCurrencyCode}
                        expanded={preferencesOpen}
                        onClick={() => setPreferencesOpen(true)}
                    />
                    <Link to="/cart" className="proto-cart-link" aria-label={isZh ? '购物车' : 'Cart'}>
                        <ShoppingCart className="proto-cart-icon" aria-hidden="true" />
                        <span className="proto-cart-text">{isZh ? '购物车' : 'Cart'}</span>
                        {cartQuantity > 0 && (
                            <span className="proto-cart-badge">
                                {cartQuantity > 99 ? '99+' : cartQuantity}
                            </span>
                        )}
                    </Link>
                    <Link to={context.customer ? '/account' : '/login'} className="proto-login-btn">
                        {context.customer ? (isZh ? '我的账户' : 'My account') : isZh ? '登录' : 'Sign in'}
                    </Link>
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
