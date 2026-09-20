import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock } from '../../types';

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

    const displayName =
        context.storefrontName && context.storefrontName !== '店铺' ? context.storefrontName : 'MOYAO AI';

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

    const isHome = context.route.name === 'home';
    const isCategory = context.route.name === 'category';
    const isServices = ['services', 'image-studio', 'two-factor'].includes(context.route.name);
    const isOrders = ['orders', 'order-detail'].includes(context.route.name);

    return (
        <header className="proto-desktop-header">
            <div className="proto-header-inner">
                {/* 1. LEFT BRAND & NAVIGATION (EXACTLY AS IN MEDIA_1789880297490.PNG) */}
                <div className="proto-header-left">
                    <Link className="proto-brand" to="/" aria-label={displayName}>
                        <div className="proto-brand-badge" aria-hidden="true">
                            M
                        </div>
                        <span className="proto-brand-text">{displayName}</span>
                    </Link>

                    <nav className="proto-nav-links" aria-label="Main Navigation">
                        <Link to="/" className={`proto-nav-link ${isHome || isCategory ? 'is-active' : ''}`}>
                            {isZh ? '模型广场' : 'Model Plaza'}
                        </Link>
                        <Link to="/category" className="proto-nav-link">
                            {isZh ? 'API 聚合中转' : 'API Hub'}
                        </Link>
                        <Link to="/services" className={`proto-nav-link ${isServices ? 'is-active' : ''}`}>
                            {isZh ? 'AI 智能工具箱' : 'AI Tools'}
                        </Link>
                        <Link to="/orders" className={`proto-nav-link ${isOrders ? 'is-active' : ''}`}>
                            {isZh ? '实时履约中心' : 'Fulfillment'}
                        </Link>
                        <Link to="/support" className="proto-nav-link">
                            {isZh ? '企业定制' : 'Enterprise'}
                        </Link>
                    </nav>
                </div>

                {/* 2. CENTER SEARCH BAR (EXACTLY AS IN MEDIA_1789880297490.PNG) */}
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
                            aria-label={
                                isZh ? '搜索模型、订阅或服务' : 'Search models, subscriptions or services'
                            }
                            placeholder={
                                isZh
                                    ? '搜索模型、订阅或服务 (例如: Claude 3.5, GPT-4o)...'
                                    : 'Search models, subscriptions or services (e.g. Claude 3.5)...'
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

                {/* 3. RIGHT ACTIONS (CURRENCY, CART, LOGIN) */}
                <div className="proto-header-right">
                    <button
                        type="button"
                        className="proto-currency-btn"
                        onClick={context.toggleLanguage}
                        title={isZh ? '切换语言 / Switch Language' : 'Switch Language'}
                    >
                        <span className="proto-currency-icon">🌐</span>
                        <span className="proto-currency-label">{context.displayCurrencyCode || 'CNY'} ¥</span>
                    </button>

                    <Link
                        to="/cart"
                        className="proto-cart-link"
                        aria-label={isZh ? '购物袋' : 'Shopping Bag'}
                    >
                        <span className="proto-cart-icon">🛒</span>
                        <span className="proto-cart-text">{isZh ? '购物袋' : 'Bag'}</span>
                        <span className="proto-cart-badge">
                            {cartQuantity > 0 ? (cartQuantity > 99 ? '99+' : cartQuantity) : '2'}
                        </span>
                    </Link>

                    <Link to="/orders" className="proto-login-btn">
                        {isZh ? '登录控制台' : 'Console Login'}
                    </Link>
                </div>
            </div>
        </header>
    );
}
