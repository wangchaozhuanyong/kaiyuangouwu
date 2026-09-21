import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';

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
    useEffect(() => setQuery(context.route.term ?? ''), [context.route.term]);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const displayName = context.storefrontName || 'MOYAO AI';

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

    const navItems = resolveBottomNavigationItems(navigationBlock, context.language);
    const storeItems = navItems.filter(item => ['home', 'category', 'services'].includes(item.routeName));
    const utilityItems = navItems.filter(
        item => !['home', 'category', 'services', 'search', 'cart'].includes(item.routeName),
    );

    return (
        <header className="proto-desktop-header">
            <div className="proto-header-inner">
                {/* 1. LEFT BRAND & DYNAMIC PRIMARY NAVIGATION */}
                <div className="proto-header-left">
                    <Link className="proto-brand" to="/" aria-label={displayName}>
                        <BrandLogo
                            url={context.logoUrl || context.logoOnLightUrl}
                            name={displayName}
                            className="proto-brand-logo-img"
                        />
                        <span className="proto-brand-text">{displayName}</span>
                    </Link>

                    <nav className="proto-nav-links" aria-label={isZh ? '主导航' : 'Main Navigation'}>
                        {storeItems.map(item => {
                            const isActive =
                                item.routeName === 'category'
                                    ? ['category', 'search', 'product'].includes(context.route.name)
                                    : item.routeName === 'services'
                                      ? ['services', 'image-studio', 'two-factor'].includes(
                                            context.route.name,
                                        )
                                      : context.route.name === item.routeName;
                            return (
                                <Link
                                    key={item.key}
                                    to={item.target}
                                    className={`proto-nav-link ${isActive ? 'is-active' : ''}`}
                                >
                                    {item.label}
                                </Link>
                            );
                        })}
                        {utilityItems.map(item => (
                            <Link
                                key={item.key}
                                to={item.target}
                                className={`proto-nav-link ${context.route.name === item.routeName ? 'is-active' : ''}`}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                {/* 2. CENTER SEARCH BAR */}
                <div className="proto-header-search">
                    <form
                        className="proto-search-form"
                        role="search"
                        action="/search"
                        onSubmit={event => {
                            event.preventDefault();
                            if (query.trim()) {
                                context.navigate({ name: 'search', term: query.trim() });
                            }
                        }}
                    >
                        <Search className="proto-search-icon" aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            className="proto-search-input"
                            aria-label={isZh ? '搜索商品或服务' : 'Search products or services'}
                            placeholder={
                                isZh ? '搜索商品、品牌或服务 (Cmd+K)...' : 'Search products or services...'
                            }
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

                {/* 3. RIGHT ACTIONS (CURRENCY SELECTOR, LANGUAGE TOGGLE, CART, LOGIN) */}
                <div className="proto-header-right">
                    {/* Currency Selector */}
                    {context.currencySelectorEnabled && context.availableCurrencyCodes.length > 1 && (
                        <div className="proto-currency-wrap">
                            <select
                                aria-label={isZh ? '选择付款币种' : 'Choose payment currency'}
                                value={context.displayCurrencyCode}
                                disabled={context.cartLoading}
                                className="proto-currency-select"
                                onChange={event => void context.switchCurrency(event.target.value)}
                            >
                                {context.availableCurrencyCodes.map(code => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Language Switcher */}
                    <button
                        type="button"
                        className="proto-lang-btn"
                        onClick={context.toggleLanguage}
                        aria-label={isZh ? '切换为英文' : 'Switch to Chinese'}
                        title={isZh ? '切换为英文' : 'Switch to Chinese'}
                    >
                        {isZh ? '中' : 'EN'}
                    </button>

                    {/* Shopping Cart Link */}
                    <Link to="/cart" className="proto-cart-link" aria-label={isZh ? '购物车' : 'Cart'}>
                        <span className="proto-cart-icon">🛒</span>
                        <span className="proto-cart-text">{isZh ? '购物车' : 'Cart'}</span>
                        {cartQuantity > 0 && (
                            <span className="proto-cart-badge">
                                {cartQuantity > 99 ? '99+' : cartQuantity}
                            </span>
                        )}
                    </Link>

                    <Link to="/orders" className="proto-login-btn">
                        {isZh ? '我的控制台' : 'Console'}
                    </Link>
                </div>
            </div>

            {/* 4. SECOND-LEVEL CATEGORY NAVIGATION BAR */}
            {context.collections.length > 0 && (
                <nav className="proto-sub-nav" aria-label={isZh ? '二级分类导航' : 'Collections'}>
                    <div className="proto-sub-nav-inner">
                        <button
                            type="button"
                            className={`proto-sub-nav-pill ${
                                context.route.name === 'home' &&
                                (!context.route.collectionId || context.route.collectionId === 'all')
                                    ? 'is-active'
                                    : ''
                            }`}
                            onClick={() => context.navigate({ name: 'home' })}
                        >
                            {isZh ? '全部商品' : 'All Products'}
                        </button>
                        {context.collections.map(col => {
                            const isActive =
                                context.route.name === 'category' && context.route.collectionId === col.id;
                            return (
                                <button
                                    key={col.id}
                                    type="button"
                                    className={`proto-sub-nav-pill ${isActive ? 'is-active' : ''}`}
                                    onClick={() =>
                                        context.navigate({
                                            name: 'category',
                                            collectionId: col.id,
                                            childId: 'all',
                                        })
                                    }
                                >
                                    {col.name}
                                </button>
                            );
                        })}
                    </div>
                </nav>
            )}
        </header>
    );
}
