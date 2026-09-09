import { Link } from '@tanstack/react-router';
import { Search, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';

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
    const items = resolveBottomNavigationItems(navigationBlock, context.language);
    const storeItems = items.filter(item => ['home', 'category', 'services'].includes(item.routeName));
    const utilityItems = items.filter(
        item => !['home', 'category', 'services', 'search', 'cart'].includes(item.routeName),
    );
    const cartItem = items.find(item => item.routeName === 'cart');
    return (
        <header className="desktop-header">
            <div className="desktop-utility-bar">
                <div className="desktop-commerce-frame desktop-utility-inner">
                    <span>{context.storefrontName}</span>
                    <nav aria-label={isZh ? '账户与帮助' : 'Account and help'}>
                        <Link to="/orders">{isZh ? '我的订单' : 'My orders'}</Link>
                        {utilityItems.map(item => (
                            <Link key={item.key} to={item.target}>
                                {item.label}
                            </Link>
                        ))}
                        <Link to="/support">{isZh ? '联系客服' : 'Customer service'}</Link>
                        {context.currencySelectorEnabled && context.availableCurrencyCodes.length > 1 && (
                            <select
                                aria-label={isZh ? '选择显示币种' : 'Choose display currency'}
                                value={context.displayCurrencyCode}
                                disabled={context.cartLoading}
                                onChange={event => void context.switchCurrency(event.target.value)}
                            >
                                {context.availableCurrencyCodes.map(code => (
                                    <option key={code}>{code}</option>
                                ))}
                            </select>
                        )}
                        <button
                            type="button"
                            onClick={context.toggleLanguage}
                            aria-label={isZh ? '切换为英文' : 'Switch to Chinese'}
                        >
                            {isZh ? 'English' : '中文'}
                        </button>
                    </nav>
                </div>
            </div>
            <div className="desktop-commerce-frame desktop-header-main">
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
                        placeholder={isZh ? '搜索商品、品牌或分类' : 'Search products, brands or categories'}
                        name="term"
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                    <button type="submit">{isZh ? '搜索' : 'Search'}</button>
                </form>
                {cartItem && (
                    <Link className="desktop-cart-link" to={cartItem.target}>
                        <ShoppingCart aria-hidden="true" />
                        <span>{cartItem.label}</span>
                        <b>{cartQuantity > 99 ? '99+' : cartQuantity}</b>
                    </Link>
                )}
            </div>
            <nav
                className="desktop-commerce-frame desktop-store-nav"
                aria-label={isZh ? '商城导航' : 'Store navigation'}
            >
                {storeItems.map(item => (
                    <Link
                        key={item.key}
                        to={item.target}
                        aria-current={
                            (
                                item.routeName === 'category'
                                    ? ['category', 'search', 'product'].includes(context.route.name)
                                    : item.routeName === 'services'
                                      ? ['services', 'image-studio', 'two-factor'].includes(
                                            context.route.name,
                                        )
                                      : context.route.name === item.routeName
                            )
                                ? 'page'
                                : undefined
                        }
                    >
                        {item.label}
                    </Link>
                ))}
                {context.collections.length > 0 && (
                    <span className="desktop-nav-divider" aria-hidden="true" />
                )}
                {context.collections.map(collection => (
                    <button
                        key={collection.id}
                        type="button"
                        aria-pressed={
                            context.route.name === 'category' && context.route.collectionId === collection.id
                        }
                        onClick={() =>
                            context.navigate({
                                name: 'category',
                                collectionId: collection.id,
                                childId: 'all',
                            })
                        }
                    >
                        {collection.name}
                    </button>
                ))}
            </nav>
        </header>
    );
}
