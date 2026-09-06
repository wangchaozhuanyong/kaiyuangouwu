import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpDown, ChevronUp, LayoutGrid, Search, SlidersHorizontal, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState, SortMode } from '../storefront-router';

import { ShopApi } from '../api';
import allCategoriesGoldIcon from '../assets/icons/all-categories-gold.webp';
import { minimumProductPrice, priceInputToMinorUnits, sortCategoryProducts } from '../catalog-page-utils';
import { centeredHorizontalScrollLeft } from '../category-navigation';
import { CategoryClientPluginSlot } from '../client-plugins/client-plugin-registry';
import { CategoryPaginationStatus } from '../components/common/category-pagination-status';
import { ProductRow } from '../components/common/product-row';
import { useCategoryPagination } from '../hooks/useCategoryPagination';
import { languageCodeFor } from '../i18n';
import { offlineLoadError } from '../loading-state';
import { productAvailability } from '../product-availability';
import { PUBLIC_QUERY_STALE_TIME, publicQueryMeta, storefrontQueryKeys } from '../query-client';
import { CategoryPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { EmptyState, ListSkeleton, Sheet } from '../storefront-ui/page-shell';
import { collectionImage, productImage, SafeImage } from '../storefront-ui/product-display';
import {
    CollectionSummary,
    FulfillmentType,
    MarketConfig,
    Product,
    StorefrontContentBlock,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

export interface CategoryPageProps {
    api: ShopApi;
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    loading: boolean;
    error: string | null;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    activeCollectionId: string;
    activeChildId: string;
    sortMode: SortMode;
    fulfillmentFilter: 'all' | FulfillmentType;
    inStockOnly: boolean;
    minimumPrice: string;
    maximumPrice: string;
    onCollectionChange: (collectionId: string, childId: string) => void;
    onChildChange: (childId: string) => void;
    onSortChange: (sort: SortMode) => void;
    onFilterChange: (
        type: 'all' | FulfillmentType,
        inStockOnly: boolean,
        minimumPrice: string,
        maximumPrice: string,
    ) => void;
    onNotify: () => void;
    onRetry: () => void;
}

export function CategoryPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        api,
        products,
        collections,
        contentBlocks,
        loading,
        error,
        market,
        locale,
        language,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice: minimumPriceInput,
        maximumPrice: maximumPriceInput,
        onCollectionChange,
        onChildChange,
        onSortChange,
        onFilterChange,
        onNotify,
        onRetry,
    } = CategoryPageContext.useValue();
    const queryClient = useQueryClient();
    const isZh = language === 'zh';
    const clientPluginBlock = contentBlocks.find(block => block.type === 'CLIENT_PLUGINS');
    const [filterOpen, setFilterOpen] = useState(false);
    const [allCategoriesOpen, setAllCategoriesOpen] = useState(false);
    const [draftType, setDraftType] = useState<'all' | FulfillmentType>(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [draftMinimumPrice, setDraftMinimumPrice] = useState(minimumPriceInput);
    const [draftMaximumPrice, setDraftMaximumPrice] = useState(maximumPriceInput);
    const subcatScrollerRef = useRef<HTMLDivElement>(null);
    const primaryCollections = collections;
    const primary = primaryCollections.find(item => item.id === activeCollectionId) ?? primaryCollections[0];
    const primaryCollectionImage = (collection: CollectionSummary) =>
        collectionImage(collection) ??
        productImage(
            products.find(product =>
                product.collections.some(
                    productCollection =>
                        productCollection.id === collection.id ||
                        productCollection.parentId === collection.id,
                ),
            ),
        );
    const children = primary?.children ?? [];
    const hasChildCategories = children.length > 0;
    const selectedCollectionId = activeChildId === 'all' ? activeCollectionId : activeChildId;
    const clientPluginCategoryContext = {
        activeCollectionId: selectedCollectionId,
        ancestorCollectionIds:
            activeChildId !== 'all' && activeCollectionId !== selectedCollectionId
                ? [activeCollectionId]
                : [],
    };
    const hasFilters =
        fulfillmentFilter !== 'all' || inStockOnly || minimumPriceInput !== '' || maximumPriceInput !== '';
    const vendureLanguageCode = languageCodeFor(language);
    const catalogInput = {
        collectionId: selectedCollectionId === 'all' ? undefined : selectedCollectionId,
        sort: sortMode,
        fulfillmentType: fulfillmentFilter === 'all' ? undefined : fulfillmentFilter,
        inStockOnly,
        minPriceWithTax: priceInputToMinorUnits(minimumPriceInput),
        maxPriceWithTax: priceInputToMinorUnits(maximumPriceInput),
    };
    const catalogEnabled = collections.length > 0 && !!selectedCollectionId && selectedCollectionId !== 'all';
    const pagination = useCategoryPagination({
        api,
        market,
        languageCode: vendureLanguageCode,
        language,
        input: catalogInput,
        enabled: catalogEnabled,
        suspended: filterOpen || allCategoriesOpen,
    });
    const catalogQuery = pagination.query;

    const matchesFilters = useCallback(
        (
            product: Product,
            type: 'all' | FulfillmentType,
            stockOnly: boolean,
            minimum: string,
            maximum: string,
        ) => {
            const typeMatch =
                type === 'all' ||
                product.variants.some(variant => variant.customFields.fulfillmentType === type);
            const stockMatch =
                !stockOnly || product.variants.some(variant => !productAvailability(variant).soldOut);
            const price = minimumProductPrice(product) / 100;
            const minimumMatch = minimum === '' || price >= Number(minimum);
            const maximumMatch = maximum === '' || price <= Number(maximum);
            return typeMatch && stockMatch && minimumMatch && maximumMatch;
        },
        [],
    );

    const fallbackProducts = sortCategoryProducts(
        products.filter(product =>
            matchesFilters(product, fulfillmentFilter, inStockOnly, minimumPriceInput, maximumPriceInput),
        ),
        sortMode,
        locale,
    );
    const categoryProducts = collections.length ? pagination.products : fallbackProducts;
    const visibleProducts = categoryProducts;
    const totalItems = collections.length ? pagination.totalItems : fallbackProducts.length;
    const categoryLoading = collections.length ? catalogQuery.isLoading : loading;
    const categoryError = collections.length
        ? catalogQuery.isPaused && catalogQuery.data === undefined
            ? offlineLoadError(language)
            : catalogQuery.error instanceof Error
              ? catalogQuery.error.message
              : ''
        : (error ?? '');

    useEffect(() => {
        // Fallback products have no catalog provenance; placeholder pages belong to an older query.
        if (!collections.length || !catalogQuery.isSuccess || catalogQuery.isPlaceholderData) return;
        for (const product of categoryProducts) {
            const queryKey = storefrontQueryKeys.product(
                storefrontQueryKeys.market(market),
                vendureLanguageCode,
                product.id,
            );
            queryClient.setQueryData(queryKey, product);
            void queryClient.prefetchQuery({
                queryKey,
                queryFn: () => product,
                staleTime: PUBLIC_QUERY_STALE_TIME,
                meta: publicQueryMeta(),
            });
        }
    }, [
        categoryProducts,
        collections.length,
        catalogQuery.isSuccess,
        catalogQuery.isPlaceholderData,
        market.code,
        market.currencyCode,
        queryClient,
        vendureLanguageCode,
    ]);

    const allCategoriesRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!allCategoriesOpen) return;
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (allCategoriesRef.current && !allCategoriesRef.current.contains(event.target as Node)) {
                setAllCategoriesOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setAllCategoriesOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside, { passive: true });
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [allCategoriesOpen]);

    const draftResultCount = products.filter(product => {
        const collectionMatch =
            !collections.length ||
            !selectedCollectionId ||
            selectedCollectionId === 'all' ||
            product.collections.some(collection => collection.id === selectedCollectionId);
        return (
            collectionMatch &&
            matchesFilters(product, draftType, draftStock, draftMinimumPrice, draftMaximumPrice)
        );
    }).length;

    return (
        <main className="page category-page">
            <div className="category-navigation-shell">
                <header className="topbar category-topbar">
                    <h1 className="category-mobile-heading">{isZh ? '商品' : 'Products'}</h1>
                    <button
                        className="search-trigger"
                        type="button"
                        aria-label={isZh ? '搜索商品、品牌或分类' : 'Search products, brands, or categories'}
                        onClick={() => navigateTo({ name: 'search' })}
                    >
                        <span className="search-trigger-icon" aria-hidden="true">
                            <Search />
                        </span>
                        <span className="search-trigger-placeholder">
                            {isZh ? '搜索商品、品牌或分类' : 'Search products, brands, or categories'}
                        </span>
                        <span className="search-trigger-action" aria-hidden="true">
                            {isZh ? '搜索' : 'Search'}
                        </span>
                    </button>
                </header>

                <CategoryClientPluginSlot
                    block={clientPluginBlock}
                    placement="AFTER_HEADER"
                    categoryContext={clientPluginCategoryContext}
                    language={language}
                    onNavigate={navigateTo}
                />

                <section
                    ref={allCategoriesRef}
                    className={`primary-category-switcher ${allCategoriesOpen ? 'is-expanded' : ''}`}
                    aria-label={isZh ? '商品分类切换' : 'Category switcher'}
                >
                    {!allCategoriesOpen ? (
                        <div className="primary-category-strip">
                            <nav
                                className="primary-categories"
                                aria-label={isZh ? '一级分类' : 'Main categories'}
                            >
                                {primaryCollections.map((collection, index) => {
                                    const image = primaryCollectionImage(collection);
                                    return (
                                        <button
                                            type="button"
                                            key={collection.id}
                                            className={
                                                collection.id === activeCollectionId ? 'is-active' : undefined
                                            }
                                            aria-pressed={collection.id === activeCollectionId}
                                            onClick={event => {
                                                onCollectionChange(
                                                    collection.id,
                                                    collection.children?.[0]?.id ?? collection.id,
                                                );
                                                const item = event.currentTarget;
                                                const scroller = item.parentElement;
                                                if (!scroller) return;
                                                scroller.scrollTo({
                                                    left: centeredHorizontalScrollLeft(scroller, item),
                                                    behavior: 'smooth',
                                                });
                                            }}
                                        >
                                            <span className="primary-category-image" aria-hidden="true">
                                                {image ? (
                                                    <SafeImage
                                                        src={image}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        loading={index < 6 ? 'eager' : 'lazy'}
                                                    />
                                                ) : (
                                                    <span className="primary-category-placeholder">
                                                        <LayoutGrid aria-hidden="true" />
                                                    </span>
                                                )}
                                            </span>
                                            <span className="primary-category-label">{collection.name}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                            <button
                                type="button"
                                className="primary-categories-all"
                                aria-expanded="false"
                                aria-label={isZh ? '全部分类' : 'All categories'}
                                onClick={() => setAllCategoriesOpen(true)}
                            >
                                <span className="primary-categories-all-icon" aria-hidden="true">
                                    <img
                                        src={allCategoriesGoldIcon}
                                        alt=""
                                        width={40}
                                        height={40}
                                        draggable={false}
                                    />
                                </span>
                                <span className="primary-categories-all-label">
                                    {isZh ? '全部分类' : 'All'}
                                </span>
                            </button>
                        </div>
                    ) : (
                        <div className="all-primary-categories">
                            <h2>{isZh ? '全部分类' : 'All categories'}</h2>
                            <nav
                                className="all-primary-category-grid"
                                aria-label={isZh ? '全部分类' : 'All categories'}
                            >
                                {primaryCollections.map(collection => {
                                    const image = primaryCollectionImage(collection);
                                    return (
                                        <button
                                            type="button"
                                            key={collection.id}
                                            className={
                                                collection.id === activeCollectionId ? 'is-active' : undefined
                                            }
                                            aria-pressed={collection.id === activeCollectionId}
                                            onClick={() => {
                                                onCollectionChange(
                                                    collection.id,
                                                    collection.children?.[0]?.id ?? collection.id,
                                                );
                                                setAllCategoriesOpen(false);
                                            }}
                                        >
                                            <span className="all-primary-category-image" aria-hidden="true">
                                                {image ? (
                                                    <SafeImage
                                                        src={image}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <span className="primary-category-placeholder">
                                                        <LayoutGrid aria-hidden="true" />
                                                    </span>
                                                )}
                                            </span>
                                            <span>{collection.name}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                            <button
                                type="button"
                                className="all-primary-categories-collapse"
                                onClick={() => setAllCategoriesOpen(false)}
                            >
                                <span>{isZh ? '点击收起' : 'Collapse'}</span>
                                <ChevronUp aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </section>
                <CategoryClientPluginSlot
                    block={clientPluginBlock}
                    placement="AFTER_CATEGORY_NAVIGATION"
                    categoryContext={clientPluginCategoryContext}
                    language={language}
                    onNavigate={navigateTo}
                />
            </div>

            <div className={`category-layout${hasChildCategories ? ' has-sidebar' : ' is-full-width'}`}>
                {hasChildCategories && (
                    <aside
                        ref={subcatScrollerRef}
                        className="category-subcat-sidebar"
                        aria-label={isZh ? '二级分类' : 'Subcategories'}
                    >
                        <button
                            type="button"
                            className={`subcat-side-item subcat-side-all ${activeChildId === 'all' || !activeChildId ? 'is-active' : ''}`}
                            onClick={() => onChildChange('all')}
                        >
                            <span className="subcat-side-name">{isZh ? '全部' : 'All'}</span>
                            <span className="subcat-side-count">{totalItems}</span>
                        </button>
                        {children.map(child => (
                            <button
                                type="button"
                                key={child.id}
                                className={`subcat-side-item ${child.id === activeChildId ? 'is-active' : ''}`}
                                onClick={() => onChildChange(child.id)}
                            >
                                <span className="subcat-side-name">{child.name}</span>
                            </button>
                        ))}
                    </aside>
                )}

                <section
                    className="category-results"
                    ref={pagination.resultsRef}
                    data-scroll-restoration-id="category-results"
                >
                    <nav
                        className="sort-bar sort-bar-five"
                        aria-label={isZh ? '排序和筛选' : 'Sort and filter'}
                    >
                        <button
                            type="button"
                            className={sortMode === 'recommended' ? 'is-active' : undefined}
                            onClick={() => onSortChange('recommended')}
                        >
                            {isZh ? '综合' : 'Default'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'sales' ? 'is-active' : undefined}
                            onClick={() => onSortChange('sales')}
                        >
                            {isZh ? '销量' : 'Sales'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'newest' ? 'is-active' : undefined}
                            onClick={() => onSortChange('newest')}
                        >
                            {isZh ? '最新' : 'Newest'}
                        </button>
                        <button
                            type="button"
                            className={sortMode.startsWith('price') ? 'is-active' : undefined}
                            onClick={() =>
                                onSortChange(sortMode === 'price-asc' ? 'price-desc' : 'price-asc')
                            }
                        >
                            {isZh ? '价格' : 'Price'} <ArrowUpDown aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className={hasFilters ? 'is-active' : undefined}
                            onClick={() => {
                                setDraftType(fulfillmentFilter);
                                setDraftStock(inStockOnly);
                                setDraftMinimumPrice(minimumPriceInput);
                                setDraftMaximumPrice(maximumPriceInput);
                                setFilterOpen(true);
                            }}
                        >
                            {isZh ? '筛选' : 'Filter'} <SlidersHorizontal aria-hidden="true" />
                        </button>
                    </nav>

                    <CategoryClientPluginSlot
                        block={clientPluginBlock}
                        placement="BEFORE_PRODUCT_LIST"
                        categoryContext={clientPluginCategoryContext}
                        language={language}
                        onNavigate={navigateTo}
                    />

                    {categoryLoading || (loading && !collections.length) ? (
                        <ListSkeleton label={isZh ? '正在加载商品' : 'Loading products'} />
                    ) : categoryError && !categoryProducts.length ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={categoryError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => (collections.length ? void catalogQuery.refetch() : onRetry())}
                            compact
                        />
                    ) : categoryProducts.length ? (
                        <>
                            <div className="category-product-list">
                                {visibleProducts.map(product => (
                                    <ProductRow
                                        key={product.id}
                                        product={product}
                                        market={market}
                                        locale={locale}
                                        language={language}
                                        onOpen={() => navigateTo({ name: 'product', id: product.id })}
                                    />
                                ))}
                            </div>
                            {catalogEnabled && (
                                <CategoryPaginationStatus
                                    sentinelRef={pagination.sentinelRef}
                                    language={language}
                                    state={
                                        !pagination.online || catalogQuery.isPaused
                                            ? 'offline'
                                            : catalogQuery.isPlaceholderData ||
                                                (catalogQuery.isFetching && !catalogQuery.isFetchingNextPage)
                                              ? 'updating'
                                              : catalogQuery.isFetchingNextPage
                                                ? 'loading'
                                                : catalogQuery.isError
                                                  ? 'error'
                                                  : !catalogQuery.hasNextPage
                                                    ? 'done'
                                                    : pagination.automaticSupported
                                                      ? 'idle'
                                                      : 'manual'
                                    }
                                    onContinue={() => void pagination.loadMore()}
                                />
                            )}
                        </>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={isZh ? '当前分类没有商品' : 'No products in this category'}
                            detail={
                                hasFilters
                                    ? isZh
                                        ? '可以调整或清除筛选条件'
                                        : 'Adjust or clear the filters'
                                    : isZh
                                      ? '可以切换其他分类'
                                      : 'Choose another category'
                            }
                            compact
                        />
                    )}

                    <CategoryClientPluginSlot
                        block={clientPluginBlock}
                        placement="AFTER_PRODUCT_LIST"
                        categoryContext={clientPluginCategoryContext}
                        language={language}
                        onNavigate={navigateTo}
                    />
                </section>
            </div>

            {allCategoriesOpen && (
                <div
                    className="all-categories-backdrop"
                    aria-hidden="true"
                    onClick={() => setAllCategoriesOpen(false)}
                />
            )}

            {filterOpen && (
                <Sheet
                    title={isZh ? '筛选' : 'Filter'}
                    language={language}
                    onClose={() => setFilterOpen(false)}
                >
                    <div className="filter-sheet-content">
                        <label className="filter-card filter-stock-card">
                            <span className="filter-stock-title">{isZh ? '仅看有货' : 'In stock only'}</span>
                            <input
                                type="checkbox"
                                checked={draftStock}
                                onChange={event => setDraftStock(event.target.checked)}
                            />
                        </label>
                        <fieldset className="filter-fieldset">
                            <legend className="filter-legend">{isZh ? '价格区间' : 'Price range'}</legend>
                            <div className="price-range-inputs">
                                <label>
                                    <span>{market.currencyCode}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder={isZh ? '最低价' : 'Min'}
                                        value={draftMinimumPrice}
                                        onChange={event => setDraftMinimumPrice(event.target.value)}
                                    />
                                </label>
                                <span className="price-separator">—</span>
                                <label>
                                    <span>{market.currencyCode}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder={isZh ? '最高价' : 'Max'}
                                        value={draftMaximumPrice}
                                        onChange={event => setDraftMaximumPrice(event.target.value)}
                                    />
                                </label>
                            </div>
                            <div className="price-presets">
                                {(
                                    [
                                        [0, 100],
                                        [100, 300],
                                        [300, 800],
                                        [800, null],
                                    ] as const
                                ).map(([minimum, maximum]) => (
                                    <button
                                        type="button"
                                        key={`${minimum}-${maximum ?? 'up'}`}
                                        className={
                                            draftMinimumPrice === String(minimum) &&
                                            draftMaximumPrice === (maximum === null ? '' : String(maximum))
                                                ? 'is-active'
                                                : undefined
                                        }
                                        onClick={() => {
                                            setDraftMinimumPrice(String(minimum));
                                            setDraftMaximumPrice(maximum === null ? '' : String(maximum));
                                        }}
                                    >
                                        {maximum === null
                                            ? `${minimum}${isZh ? '以上' : '+'}`
                                            : `${minimum}-${maximum}`}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <fieldset className="filter-fieldset">
                            <legend className="filter-legend">{isZh ? '商品类型' : 'Product type'}</legend>
                            <div className="segmented-options">
                                {(['all', 'physical', 'digital'] as const).map(type => (
                                    <button
                                        type="button"
                                        key={type}
                                        className={draftType === type ? 'is-active' : undefined}
                                        onClick={() => setDraftType(type)}
                                    >
                                        {type === 'all'
                                            ? isZh
                                                ? '全部'
                                                : 'All'
                                            : type === 'physical'
                                              ? isZh
                                                  ? '实物'
                                                  : 'Physical'
                                              : isZh
                                                ? '数字商品'
                                                : 'Digital'}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <div className="sheet-actions filter-actions">
                            <button
                                type="button"
                                className="reset-filter-button"
                                onClick={() => {
                                    setDraftType('all');
                                    setDraftStock(false);
                                    setDraftMinimumPrice('');
                                    setDraftMaximumPrice('');
                                }}
                            >
                                {isZh ? '重置' : 'Reset'}
                            </button>
                            <button
                                type="button"
                                className="primary-action filter-confirm-button"
                                onClick={() => {
                                    onFilterChange(
                                        draftType,
                                        draftStock,
                                        draftMinimumPrice,
                                        draftMaximumPrice,
                                    );
                                    setFilterOpen(false);
                                }}
                            >
                                {isZh
                                    ? `查看 ${draftResultCount} 件商品`
                                    : `View ${draftResultCount} products`}
                            </button>
                        </div>
                    </div>
                </Sheet>
            )}
        </main>
    );
}
