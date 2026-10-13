import { Search, ShoppingCart, UserRound } from 'lucide-react';

import { type RouteName } from '../../storefront-router';
import { BrandLogo } from '../../storefront-ui/brand-logo';
import { type StorefrontContentBlock, type StorefrontLanguage } from '../../types';

import { resolveBottomNavigationItems } from './bottom-navigation';
import { LocalePreferencesTrigger } from './locale-preferences';

/** Match the idle search field while the existing discovery module loads. */
export function DesktopHeaderSearchPlaceholder({ language }: { language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    return (
        <div className="desktop-search-anchor" aria-hidden="true" inert>
            <div className="proto-search-form">
                <Search className="proto-search-icon" aria-hidden="true" />
                <input
                    className="proto-search-input"
                    type="search"
                    placeholder={isZh ? '搜索商品、分类' : 'Search products'}
                    readOnly
                    tabIndex={-1}
                />
                <button className="proto-search-submit" type="button" tabIndex={-1}>
                    {isZh ? '搜索' : 'Search'}
                </button>
            </div>
        </div>
    );
}

/** Reserve the existing desktop header while the anonymous snapshot hands over to runtime. */
export function ResponsiveHomeHeaderPlaceholder({
    name,
    logoUrl,
    language,
    currencyCode,
    routeName,
    navigationBlock,
}: {
    name: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    currencyCode: string;
    routeName: RouteName;
    navigationBlock?: StorefrontContentBlock;
}) {
    const isZh = language === 'zh';
    const activeRoute = routeName === 'product' || routeName === 'search' ? 'category' : routeName;
    const navigation = resolveBottomNavigationItems(navigationBlock, language).filter(
        item => item.routeName !== 'cart',
    );
    return (
        <header className="responsive-home-header-placeholder proto-desktop-header" aria-hidden="true" inert>
            <div className="proto-header-inner">
                <div className="proto-header-left">
                    <span className="proto-brand">
                        <BrandLogo url={logoUrl} name={name} className="proto-brand-badge" />
                        <span className="proto-brand-text">{name}</span>
                    </span>
                    <nav className="proto-nav-links">
                        {navigation.map(item => (
                            <span
                                key={item.key}
                                className={`proto-nav-link ${activeRoute === item.routeName ? 'is-active' : ''}`}
                            >
                                {item.label}
                            </span>
                        ))}
                    </nav>
                </div>
                <div className="proto-header-search">
                    <DesktopHeaderSearchPlaceholder language={language} />
                </div>
                <div className="proto-header-right">
                    <LocalePreferencesTrigger
                        className="proto-header-action"
                        language={language}
                        currencyCode={currencyCode}
                        expanded={false}
                        onClick={() => undefined}
                    />
                    <span className="proto-cart-link proto-header-action">
                        <ShoppingCart className="proto-cart-icon" aria-hidden="true" />
                        <span className="proto-cart-text">{isZh ? '购物车' : 'Cart'}</span>
                    </span>
                    <span className="proto-login-btn proto-header-action">
                        <UserRound aria-hidden="true" />
                        {isZh ? '登录' : 'Sign in'}
                    </span>
                </div>
            </div>
        </header>
    );
}
