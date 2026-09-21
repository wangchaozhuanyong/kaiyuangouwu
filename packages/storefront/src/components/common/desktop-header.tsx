import { Link } from '@tanstack/react-router';
import { Search, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';

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
                        <kbd className="proto-search-kbd" aria-hidden="true">
                            ⌘K
                        </kbd>
                    </form>
                </div>

                <div className="proto-header-right">
                    {context.currencySelectorEnabled && context.availableCurrencyCodes.length > 1 ? (
                        <label className="proto-currency-select">
                            <span className="sr-only">{isZh ? '选择币种' : 'Choose currency'}</span>
                            <select
                                value={context.displayCurrencyCode}
                                disabled={context.cartLoading}
                                onChange={event => void context.switchCurrency(event.target.value)}
                            >
                                {context.availableCurrencyCodes.map(currencyCode => (
                                    <option key={currencyCode} value={currencyCode}>
                                        {currencyCode}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <span className="proto-currency-label">{context.displayCurrencyCode}</span>
                    )}
                    <button
                        type="button"
                        className="proto-language-btn"
                        onClick={context.toggleLanguage}
                        aria-label={isZh ? '切换到英文' : 'Switch to Chinese'}
                    >
                        {isZh ? 'EN' : '中'}
                    </button>
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
        </header>
    );
}
