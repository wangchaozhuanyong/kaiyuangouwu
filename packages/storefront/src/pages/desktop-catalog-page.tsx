import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowRight, Search, SlidersHorizontal, Sparkles, WifiOff } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

import { ShopApi } from '../api';
import { matchesCatalogFilters } from '../api/helpers';
import { CategoryClientPluginSlot, clientPluginPlacements } from '../client-plugins/client-plugin-registry';
import { DesktopCategoryNavigation } from '../components/common/desktop-category-navigation';
import { ProductRow } from '../components/common/product-row';
import { desktopCatalogInput, desktopCatalogRoute } from '../desktop-catalog-query';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { RouteState } from '../storefront-router';
import { EmptyState, ListSkeleton } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { CollectionSummary, MarketConfig, StorefrontContentBlock, StorefrontLanguage } from '../types';

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
    const input = desktopCatalogInput(route);
    const query = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), languageCodeFor(language), {
            ...input,
        }),
        queryFn: ({ pageParam, signal }) =>
            runtime.api.catalog({ ...input, skip: pageParam, take: 20 }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const count = pages.reduce((total, page) => total + page.items.length, 0);
            return count < lastPage.totalItems ? count : undefined;
        },
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        refetchOnMount: false,
        meta: publicQueryMeta(),
    });
    const loadedProducts = query.data?.pages.flatMap(page => page.items) ?? [];
    // Search-index stock can lag behind live auto-card stock. Use the existing
    // availability rules while keeping pagination offsets based on raw API pages.
    const products = loadedProducts.filter(product => matchesCatalogFilters(product, input));
    const totalItems = query.data?.pages[0]?.totalItems;
    const displayCount = query.hasNextPage ? totalItems : products.length;
    const countIsPartial = query.hasNextPage && products.length !== loadedProducts.length;
    const error = query.isPaused
        ? offlineLoadError(language)
        : query.error instanceof Error
          ? query.error.message
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
    const update = (changes: Partial<RouteState>) => navigate(desktopCatalogRoute(route, changes));
    const clearFilters = () => navigate(desktopCatalogRoute({ name: 'home' }));
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
                <strong className="desktop-catalog-label">
                    {input.term
                        ? title
                        : activeChild?.name || activeCollection?.name || (isZh ? '全部商品' : 'All products')}
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
            <section
                className="desktop-catalog-results"
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
                        onAction={query.hasNextPage ? () => void query.fetchNextPage() : clearFilters}
                    />
                )}
                {error && products.length ? (
                    <div className="search-load-error" role="alert">
                        <span>{error}</span>
                        <button type="button" onClick={() => void query.fetchNextPage()}>
                            {isZh ? '重试' : 'Retry'}
                        </button>
                    </div>
                ) : null}
                {query.hasNextPage ? (
                    <button
                        className="load-more-button"
                        type="button"
                        disabled={query.isFetchingNextPage}
                        onClick={() => void query.fetchNextPage()}
                    >
                        {query.isFetchingNextPage
                            ? isZh
                                ? '加载中…'
                                : 'Loading…'
                            : isZh
                              ? '加载更多商品'
                              : 'Load more products'}
                    </button>
                ) : null}
            </section>
            <div className="desktop-catalog-extras">
                <button
                    className="desktop-services-link"
                    type="button"
                    onClick={() => navigate({ name: 'services' })}
                >
                    <Sparkles aria-hidden="true" />
                    <span>
                        <strong>{isZh ? '智能服务' : 'Intelligent services'}</strong>
                        <small>
                            {isZh ? '查看店铺提供的服务与工具' : 'Explore services and tools from this store'}
                        </small>
                    </span>
                    <ArrowRight aria-hidden="true" />
                </button>
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
                <button type="button" onClick={() => navigate({ name: 'legal', id: 'privacy' })}>
                    {isZh ? '隐私政策' : 'Privacy'}
                </button>
                <button type="button" onClick={() => navigate({ name: 'legal', id: 'terms' })}>
                    {isZh ? '使用条款' : 'Terms'}
                </button>
            </footer>
        </main>
    );
}
