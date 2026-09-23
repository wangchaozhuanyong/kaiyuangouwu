import { Search, SlidersHorizontal, WifiOff } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

import { ShopApi } from '../api';
import { matchesCatalogFilters } from '../api/helpers';
import { catalogInputFromRoute, catalogRouteWithChanges } from '../catalog-route-query';
import { CategoryClientPluginSlot, clientPluginPlacements } from '../client-plugins/client-plugin-registry';
import { CategoryPaginationStatus } from '../components/common/category-pagination-status';
import {
    DesktopCategoryNavigation,
    DesktopSubcategoryNavigation,
} from '../components/common/desktop-category-navigation';
import { ProductRow } from '../components/common/product-row';
import { useCategoryPagination } from '../hooks/useCategoryPagination';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { storefrontErrorMessage } from '../storefront-errors';
import { RouteState } from '../storefront-router';
import { EmptyState, ListSkeleton } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { CollectionSummary, MarketConfig, StorefrontContentBlock, StorefrontLanguage } from '../types';

import '../styles/account-catalog-surfaces.css';

interface DesktopCatalogContext {
    api: ShopApi;
    route: RouteState;
    market: MarketConfig;
    language: StorefrontLanguage;
    locale: string;
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    storefrontName: string;
    storefrontTagline: string;
    navigate: (route: RouteState) => void;
}

export function DesktopCatalogPage() {
    const runtime: DesktopCatalogContext = useStorefront();
    const { route, market, language, locale, collections, contentBlocks, navigate } = runtime;
    const isZh = language === 'zh';
    const input = catalogInputFromRoute(route);
    const pagination = useCategoryPagination({
        api: runtime.api,
        market,
        languageCode: languageCodeFor(language),
        language,
        input,
        enabled: true,
        suspended: false,
        pageSize: 20,
    });
    const query = pagination.query;
    const loadedProducts = pagination.products;
    // Search-index stock can lag behind live auto-card stock. Use the existing
    // availability rules while keeping pagination offsets based on raw API pages.
    const products = loadedProducts.filter(product => matchesCatalogFilters(product, input));
    const totalItems = query.data ? pagination.totalItems : undefined;
    const displayCount = query.hasNextPage ? totalItems : products.length;
    const countIsPartial = query.hasNextPage && products.length !== loadedProducts.length;
    const error = query.isPaused
        ? offlineLoadError(language)
        : query.error instanceof Error
          ? storefrontErrorMessage(query.error, language)
          : '';
    const activeCollection = collections.find(collection => collection.id === route.collectionId);
    const activeChild = activeCollection?.children?.find(collection => collection.id === route.childId);
    const [filterOpen, setFilterOpen] = useState(false);
    const [priceError, setPriceError] = useState('');
    const [minimum, setMinimum] = useState(route.minPrice ?? '');
    const [maximum, setMaximum] = useState(route.maxPrice ?? '');
    const [fulfillment, setFulfillment] = useState(route.fulfillment ?? 'all');
    useEffect(() => {
        setMinimum(route.minPrice ?? '');
        setMaximum(route.maxPrice ?? '');
        setFulfillment(route.fulfillment ?? 'all');
    }, [route.minPrice, route.maxPrice, route.fulfillment]);
    const filtered = !!(
        input.term ||
        input.collectionId ||
        input.inStockOnly ||
        input.fulfillmentType ||
        input.minPriceWithTax != null ||
        input.maxPriceWithTax != null
    );
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(route, changes));
    const clearFilters = () => navigate(catalogRouteWithChanges({ name: 'home' }));
    const applyFilters = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (minimum && maximum && Number(minimum) > Number(maximum)) {
            setPriceError(isZh ? '最高价不能低于最低价' : 'Maximum price must be at least the minimum');
            return;
        }
        setPriceError('');
        update({ minPrice: minimum || undefined, maxPrice: maximum || undefined, fulfillment });
        setFilterOpen(false);
    };
    const clientPluginBlock = contentBlocks.find(block => block.type === 'CLIENT_PLUGINS');
    const categoryContext = {
        activeCollectionId: input.collectionId ?? 'all',
        ancestorCollectionIds: activeChild && activeCollection ? [activeCollection.id] : [],
    };
    const title = input.term
        ? isZh
            ? `“${input.term}”的搜索结果`
            : `Results for “${input.term}”`
        : activeChild?.name || activeCollection?.name || runtime.storefrontTagline || runtime.storefrontName;

    return (
        <main className="desktop-catalog-main">
            <h1 className="visually-hidden">{title}</h1>
            <DesktopCategoryNavigation />
            <div className="desktop-catalog-toolbar">
                <div className="section-heading-inline desktop-catalog-heading">
                    <strong className="desktop-catalog-label">
                        {input.term
                            ? title
                            : activeChild?.name ||
                              activeCollection?.name ||
                              (isZh ? '全部商品' : 'All products')}
                    </strong>
                    <span className="desktop-result-count" role="status">
                        {query.isPending
                            ? isZh
                                ? '加载中…'
                                : 'Loading…'
                            : totalItems == null
                              ? isZh
                                  ? '暂不可用'
                                  : 'Unavailable'
                              : isZh
                                ? countIsPartial
                                    ? `已显示 ${products.length} 件商品`
                                    : `${displayCount} 件商品`
                                : countIsPartial
                                  ? `${products.length} products shown`
                                  : `${displayCount} products`}
                    </span>
                </div>
                <div className="desktop-catalog-actions">
                    <nav className="desktop-sort" aria-label={isZh ? '商品排序' : 'Sort products'}>
                        {(
                            [
                                ['recommended', isZh ? '综合' : 'Recommended'],
                                ['sales', isZh ? '销量' : 'Best sellers'],
                                ['newest', isZh ? '最新' : 'Newest'],
                                ['price-asc', isZh ? '价格从低到高' : 'Price: low to high'],
                                ['price-desc', isZh ? '价格从高到低' : 'Price: high to low'],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={input.sort === value}
                                onClick={() => update({ sort: value })}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>
                    <label className="desktop-stock-filter">
                        <input
                            type="checkbox"
                            checked={input.inStockOnly}
                            onChange={event => update({ inStockOnly: event.target.checked })}
                        />
                        {isZh ? '仅看有货' : 'In stock only'}
                    </label>
                    <button
                        className={filterOpen ? 'is-active' : undefined}
                        type="button"
                        aria-expanded={filterOpen}
                        aria-controls="desktop-catalog-filters"
                        onClick={() => setFilterOpen(!filterOpen)}
                    >
                        <SlidersHorizontal aria-hidden="true" />
                        {isZh ? '筛选' : 'Filter'}
                    </button>
                    {filtered ? (
                        <button type="button" onClick={clearFilters}>
                            {isZh ? '重置' : 'Reset'}
                        </button>
                    ) : null}
                </div>
            </div>
            {filterOpen ? (
                <form
                    id="desktop-catalog-filters"
                    className="desktop-catalog-filters"
                    onSubmit={applyFilters}
                >
                    <label>
                        {isZh ? '最低价' : 'Minimum price'} ({market.currencyCode})
                        <input
                            type="number"
                            name="minimum"
                            min="0"
                            step="0.01"
                            value={minimum}
                            onChange={event => {
                                setPriceError('');
                                setMinimum(event.target.value);
                            }}
                        />
                    </label>
                    <label>
                        {isZh ? '最高价' : 'Maximum price'} ({market.currencyCode})
                        <input
                            type="number"
                            name="maximum"
                            min="0"
                            step="0.01"
                            value={maximum}
                            onChange={event => {
                                setPriceError('');
                                setMaximum(event.target.value);
                            }}
                        />
                    </label>
                    <label>
                        {isZh ? '商品类型' : 'Product type'}
                        <select
                            value={fulfillment}
                            onChange={event => setFulfillment(event.target.value as typeof fulfillment)}
                        >
                            <option value="all">{isZh ? '全部' : 'All'}</option>
                            <option value="digital">{isZh ? '数字商品' : 'Digital'}</option>
                            <option value="physical">{isZh ? '实物商品' : 'Physical'}</option>
                        </select>
                    </label>
                    {priceError ? (
                        <p className="desktop-price-error" role="alert">
                            {priceError}
                        </p>
                    ) : null}
                    <button className="primary-action" type="submit">
                        {isZh ? '应用筛选' : 'Apply filters'}
                    </button>
                </form>
            ) : null}
            <div
                className={`desktop-catalog-body${activeCollection?.children?.length ? ' has-subcategories' : ''}`}
            >
                <DesktopSubcategoryNavigation />
                <section
                    className="desktop-catalog-results"
                    ref={pagination.resultsRef}
                    aria-label={isZh ? '商品列表' : 'Products'}
                    aria-busy={query.isFetching}
                >
                    {query.isPending && !error ? (
                        <ListSkeleton label={isZh ? '正在加载商品' : 'Loading products'} />
                    ) : error && !products.length ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={error}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void query.refetch()}
                        />
                    ) : products.length ? (
                        <div className="desktop-product-grid">
                            {products.map(product => (
                                <ProductRow
                                    key={product.id}
                                    product={product}
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    layout="catalog"
                                    onOpen={() => navigate({ name: 'product', id: product.id })}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={
                                query.hasNextPage
                                    ? isZh
                                        ? '当前批次没有符合条件的商品'
                                        : 'No matches in the loaded products'
                                    : isZh
                                      ? '没有找到商品'
                                      : 'No products found'
                            }
                            detail={
                                isZh
                                    ? '可以切换分类或调整筛选条件。'
                                    : 'Try another category or adjust your filters.'
                            }
                            action={
                                query.hasNextPage
                                    ? isZh
                                        ? '继续加载'
                                        : 'Load more'
                                    : isZh
                                      ? '查看全部商品'
                                      : 'View all products'
                            }
                            onAction={query.hasNextPage ? () => void pagination.loadMore() : clearFilters}
                        />
                    )}
                    {products.length ? (
                        <CategoryPaginationStatus
                            sentinelRef={pagination.sentinelRef}
                            language={language}
                            state={
                                !pagination.online || query.isPaused
                                    ? 'offline'
                                    : query.isPlaceholderData ||
                                        (query.isFetching && !query.isFetchingNextPage && !query.isPending)
                                      ? 'updating'
                                      : query.isFetchingNextPage
                                        ? 'loading'
                                        : query.isError
                                          ? 'error'
                                          : !query.hasNextPage
                                            ? 'done'
                                            : pagination.automaticSupported
                                              ? 'idle'
                                              : 'manual'
                            }
                            onContinue={() => void pagination.loadMore()}
                        />
                    ) : null}
                </section>
            </div>
            <div className="desktop-catalog-extras">
                {clientPluginPlacements
                    .filter(placement => placement !== 'BUSINESS_SERVICES_MAIN')
                    .map(placement => (
                        <CategoryClientPluginSlot
                            key={placement}
                            block={clientPluginBlock}
                            placement={placement}
                            categoryContext={categoryContext}
                            language={language}
                            onNavigate={navigate}
                        />
                    ))}
            </div>
            <footer className="desktop-catalog-footer">
                <span>{runtime.storefrontName}</span>
                <nav aria-label={isZh ? '店铺政策' : 'Store policies'}>
                    <button type="button" onClick={() => navigate({ name: 'legal', id: 'privacy' })}>
                        {isZh ? '隐私政策' : 'Privacy'}
                    </button>
                    <button type="button" onClick={() => navigate({ name: 'legal', id: 'terms' })}>
                        {isZh ? '使用条款' : 'Terms'}
                    </button>
                </nav>
            </footer>
        </main>
    );
}
