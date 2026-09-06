import { Link } from '@tanstack/react-router';
import { Bell, BriefcaseBusiness, House, LayoutGrid, Search, ShoppingCart, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { RouteState } from '../../storefront-router';
import { BrandLogo } from '../../storefront-ui/content-ui';
import { useStorefront } from '../../StorefrontContext';
import { StorefrontContentBlock, StorefrontLanguage } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';
import { isDesktopAccountRoute } from './desktop-account-navigation';

interface DesktopHeaderContext {
    route: RouteState;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    logoOnLightUrl: string | null;
    availableCurrencyCodes: string[];
    currencySelectorEnabled: boolean;
    displayCurrencyCode: string;
    cartLoading: boolean;
    navigate: (route: RouteState) => void;
    toggleLanguage: () => void;
    switchCurrency: (currencyCode: string) => void;
}

export function DesktopHeader({
    navigationBlock,
    cartQuantity,
}: {
    navigationBlock?: StorefrontContentBlock;
    cartQuantity: number;
}) {
    const context: DesktopHeaderContext = useStorefront();
    const isZh = context.language === 'zh';
    const [query, setQuery] = useState(context.route.term ?? '');
    useEffect(() => setQuery(context.route.term ?? ''), [context.route.term]);
    const items = resolveBottomNavigationItems(navigationBlock, context.language).filter(
        item => item.target !== '/search',
    );
    return (
        <header className="desktop-header">
            <div className="desktop-header-inner">
                <Link className="desktop-brand" to="/" aria-label={context.storefrontName}>
                    <BrandLogo
                        url={context.logoUrl || context.logoOnLightUrl}
                        name={context.storefrontName}
                        className="desktop-brand-mark"
                    />
                    <strong>{context.storefrontName}</strong>
                </Link>
                <form
                    className="desktop-search"
                    role="search"
                    action="/search"
                    onSubmit={event => {
                        event.preventDefault();
                        if (query.trim()) context.navigate({ name: 'search', term: query.trim() });
                    }}
                >
                    <Search aria-hidden="true" />
                    <input
                        aria-label={isZh ? '搜索商品' : 'Search products'}
                        placeholder={isZh ? '搜索商品' : 'Search products'}
                        name="term"
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                    <button
                        type="submit"
                        className="desktop-search-submit"
                        aria-label={isZh ? '提交搜索' : 'Submit search'}
                    >
                        {isZh ? '搜索' : 'Search'}
                    </button>
                </form>
                <nav className="desktop-header-nav" aria-label={isZh ? '主导航' : 'Main navigation'}>
                    {items.map(item => {
                        const Icon =
                            item.routeName === 'home'
                                ? House
                                : item.routeName === 'category'
                                  ? LayoutGrid
                                  : item.routeName === 'cart'
                                    ? ShoppingCart
                                    : item.routeName === 'account'
                                      ? UserRound
                                      : BriefcaseBusiness;
                        return (
                            <Link
                                key={item.key}
                                to={item.target}
                                className="desktop-header-link"
                                data-active={
                                    item.routeName === 'account'
                                        ? isDesktopAccountRoute(context.route.name)
                                        : item.routeName === 'category'
                                          ? ['category', 'search', 'product'].includes(context.route.name)
                                          : item.routeName === 'services'
                                            ? ['services', 'image-studio', 'two-factor'].includes(
                                                  context.route.name,
                                              )
                                            : context.route.name === item.routeName
                                }
                                activeOptions={{ exact: item.target === '/' }}
                            >
                                <span className="desktop-header-icon">
                                    {item.iconUrl ? (
                                        <img src={item.iconUrl} alt="" />
                                    ) : (
                                        <Icon aria-hidden="true" />
                                    )}
                                </span>
                                <span>{item.label}</span>
                                {item.routeName === 'cart' && cartQuantity > 0 ? (
                                    <b className="desktop-cart-count">
                                        {cartQuantity > 99 ? '99+' : cartQuantity}
                                    </b>
                                ) : null}
                            </Link>
                        );
                    })}
                </nav>
                <div className="desktop-header-settings">
                    {context.currencySelectorEnabled && context.availableCurrencyCodes.length > 1 ? (
                        <select
                            aria-label={isZh ? '选择显示币种' : 'Choose display currency'}
                            value={context.displayCurrencyCode}
                            disabled={context.cartLoading}
                            onChange={event => context.switchCurrency(event.target.value)}
                        >
                            {context.availableCurrencyCodes.map(code => (
                                <option key={code}>{code}</option>
                            ))}
                        </select>
                    ) : null}
                    <button
                        type="button"
                        onClick={context.toggleLanguage}
                        aria-label={isZh ? '切换为英文' : 'Switch to Chinese'}
                    >
                        {isZh ? '中' : 'EN'}
                    </button>
                    <Link to="/notifications" aria-label={isZh ? '通知' : 'Notifications'}>
                        <Bell aria-hidden="true" />
                    </Link>
                </div>
            </div>
        </header>
    );
}
