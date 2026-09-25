import { Search, SlidersHorizontal, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { resolveDesktopCategoryBanner } from '../../../storefront-content-plugin/src/desktop-category-banner';
import { ShopApi } from '../api';
import { matchesCatalogFilters } from '../api/helpers';
import { catalogInputFromRoute, catalogRouteWithChanges } from '../catalog-route-query';
import { CategoryClientPluginSlot, clientPluginPlacements } from '../client-plugins/client-plugin-registry';
import { CatalogFilterSheet, type CatalogFilterValues } from '../components/common/catalog-filter-sheet';
import { CategoryPaginationStatus } from '../components/common/category-pagination-status';
import { DesktopCategoryNavigation } from '../components/common/desktop-category-navigation';
import { ProductCard } from '../components/common/product-card';
import { useCategoryPagination } from '../hooks/useCategoryPagination';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { SafeImage } from '../safe-image';
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
    const banner = resolveDesktopCategoryBanner(
        contentBlocks,
        activeChild?.id ?? activeCollection?.id,
        activeChild ? activeCollection?.id : null,
    );
    const bannerImage = banner?.settings.mode === 'image' ? banner.block.imageUrl : null;
    const [filterOpen, setFilterOpen] = useState(false);
    const appliedFilters: CatalogFilterValues = {
        fulfillment: route.fulfillment ?? 'all',
        inStockOnly: route.inStockOnly ?? false,
        minPrice: route.minPrice ?? '',
        maxPrice: route.maxPrice ?? '',
    };
    const [draftFilters, setDraftFilters] = useState(appliedFilters);
    useEffect(() => {
        setDraftFilters({
            fulfillment: route.fulfillment ?? 'all',
            inStockOnly: route.inStockOnly ?? false,
            minPrice: route.minPrice ?? '',
            maxPrice: route.maxPrice ?? '',
        });
    }, [route.minPrice, route.maxPrice, route.fulfillment, route.inStockOnly]);
    const filtered = !!(
        input.inStockOnly ||
        input.fulfillmentType ||
        input.minPriceWithTax != null ||
        input.maxPriceWithTax != null
    );
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(route, changes));
    const clearFilters = () =>
        update({ fulfillment: 'all', inStockOnly: false, minPrice: undefined, maxPrice: undefined });
    const draftMatchesApplied = (Object.keys(appliedFilters) as Array<keyof CatalogFilterValues>).every(
        key => appliedFilters[key] === draftFilters[key],
    );
    const applyFilters = (value: CatalogFilterValues) => {
        update({
            minPrice: value.minPrice || undefined,
            maxPrice: value.maxPrice || undefined,
            fulfillment: value.fulfillment,
            inStockOnly: value.inStockOnly,
        });
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
            <aside className="desktop-catalog-sidebar">
                <DesktopCategoryNavigation expandChildren />
            </aside>
            <div className="desktop-catalog-workspace">
                <header
                    className={`desktop-catalog-hero${bannerImage ? ` has-image is-${banner?.settings.layout ?? 'side'}` : ''}`}
                    data-focal={banner?.settings.focal ?? 'center'}
                >
                    {bannerImage && banner?.settings.layout === 'background' ? (
                        <SafeImage
                            frameClassName="desktop-catalog-hero-background"
                            src={bannerImage}
                            alt=""
                            imageKind="hero"
                            showFallbackIcon={false}
                        />
                    ) : null}
                    <div className="desktop-catalog-hero-copy">
                        <span>{isZh ? '商品与服务' : 'Products and services'}</span>
                        <h1>
                            {input.term
                                ? title
                                : activeChild?.name ||
                                  activeCollection?.name ||
                                  (isZh ? '全部商品' : 'All products')}
                        </h1>
                        {activeChild?.description || activeCollection?.description ? (
                            <p>{activeChild?.description || activeCollection?.description}</p>
                        ) : null}
                    </div>
                    {bannerImage && banner?.settings.layout === 'side' ? (
                        <SafeImage
                            frameClassName="desktop-catalog-hero-side-image"
                            src={bannerImage}
                            alt=""
                            imageKind="hero"
                            showFallbackIcon={false}
                        />
                    ) : null}
                </header>
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
                            aria-haspopup="dialog"
                            onClick={() => {
                                setDraftFilters(appliedFilters);
                                setFilterOpen(true);
                            }}
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
                    <CatalogFilterSheet
                        language={language}
                        currencyCode={market.currencyCode}
                        value={draftFilters}
                        onChange={setDraftFilters}
                        resultCount={
                            draftMatchesApplied && !query.isFetching && !countIsPartial
                                ? (displayCount ?? null)
                                : null
                        }
                        onApply={applyFilters}
                        onClose={() => setFilterOpen(false)}
                    />
                ) : null}
                <div className="desktop-catalog-body">
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
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        market={market}
                                        locale={locale}
                                        language={language}
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
                                            (query.isFetching &&
                                                !query.isFetchingNextPage &&
                                                !query.isPending)
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
            </div>
        </main>
    );
}
