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
    const navigationItems = resolveBottomNavigationItems(navigationBlock, context.language);
    const activeRoute = activeNavigationRoute(context.route.name);

    useEffect(() => setQuery(context.route.term ?? ''), [context.route.term]);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

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
                    <form
                        className="proto-search-form"
                        role="search"
                        action="/search"
                        onSubmit={event => {
                            event.preventDefault();
                            if (query.trim()) context.navigate({ name: 'search', term: query.trim() });
                        }}
                    >
                        <Search className="proto-search-icon" aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            className="proto-search-input"
                            aria-label={isZh ? '搜索商品或服务' : 'Search products or services'}
                            placeholder={isZh ? '搜索商品或服务' : 'Search products or services'}
                            name="term"
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                        <button type="submit" className="proto-search-submit">
                            {isZh ? '搜索' : 'Search'}
                        </button>
                    </form>
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
