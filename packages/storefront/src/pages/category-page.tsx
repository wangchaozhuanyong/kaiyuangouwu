import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowUpDown,
    ChevronDown,
    ChevronUp,
    LayoutGrid,
    Search,
    SlidersHorizontal,
    WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState, SortMode } from '../storefront-router';

import { ShopApi } from '../api';
import { minimumProductPrice } from '../catalog-page-utils';
import { catalogInputFromRoute } from '../catalog-route-query';
import { animateCategoryScroll, centeredHorizontalScrollLeft } from '../category-navigation';
import { CategoryClientPluginSlot } from '../client-plugins/client-plugin-registry';
import { CommercePageStyles } from '../commerce-styles';
import { CatalogFilterSheet } from '../components/common/catalog-filter-sheet';
import { CategoryPaginationStatus } from '../components/common/category-pagination-status';
import { DesktopCategoryNavigation } from '../components/common/desktop-category-navigation';
import { ProductCard } from '../components/common/product-card';
import { useCategoryNavigationCollapse } from '../hooks/useCategoryNavigationCollapse';
import { useCategoryPagination } from '../hooks/useCategoryPagination';
import { languageCodeFor } from '../i18n';
import { storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import { PageReadinessError, usePageLoadingState, usePageReadiness } from '../page-readiness';
import { priceSortActionLabel } from '../price-sort-label';
import { productAvailability } from '../product-availability';
import { storefrontQueryKeys } from '../query-client';
import { STOREFRONT_IMAGE_SIZES } from '../responsive-image';
import { CategoryPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { EmptyState, ListSkeleton } from '../storefront-ui/page-shell';
import { collectionImage, SafeImage } from '../storefront-ui/product-display';
import {
    CollectionSummary,
    FulfillmentType,
    MarketConfig,
    Product,
    StorefrontContentBlock,
    StorefrontLanguage,
} from '../types';

import '../styles/account-catalog-surfaces.css';

// TODO: Fix internal imports later

export interface CategoryPageProps {
    api: ShopApi;
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    storefrontName?: string;
    loading: boolean;
    contextResolved?: boolean;
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
    page?: number;
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

export { categoryFilterActionLabel } from '../components/common/catalog-filter-sheet';

export function CategoryPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        api,
        contextResolved = true,
        products,
        collections,
        loading,
        error,
        contentBlocks,
        storefrontName = '',
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
        page,
        onCollectionChange,
        onChildChange,
        onSortChange,
        onFilterChange,
        onNotify,
        onRetry,
    } = CategoryPageContext.useValue();
    const isZh = language === 'zh';
    const clientPluginBlock = contentBlocks.find(block => block.type === 'CLIENT_PLUGINS');
    const [filterOpen, setFilterOpen] = useState(false);
    const [allCategoriesOpen, setAllCategoriesOpen] = useState(false);
    const [expandedSubcategoryId, setExpandedSubcategoryId] = useState<string | null>(null);
    const [draftType, setDraftType] = useState<'all' | FulfillmentType>(fulfillmentFilter);
    const [draftStock, setDraftStock] = useState(inStockOnly);
    const [draftMinimumPrice, setDraftMinimumPrice] = useState(minimumPriceInput);
    const [draftMaximumPrice, setDraftMaximumPrice] = useState(maximumPriceInput);
    const subcatScrollerRef = useRef<HTMLDivElement>(null);
    const primaryCategoriesRef = useRef<HTMLElement>(null);
    const clickedCollectionRef = useRef<string | null>(null);
    const primaryPositionFrameRef = useRef<number | null>(null);
    const primaryScrollCancelRef = useRef<(() => void) | null>(null);
    const primaryCollections = collections;
    const stopPrimaryScroll = useCallback(() => {
        if (primaryPositionFrameRef.current !== null) {
            cancelAnimationFrame(primaryPositionFrameRef.current);
            primaryPositionFrameRef.current = null;
        }
        primaryScrollCancelRef.current?.();
        primaryScrollCancelRef.current = null;
    }, []);
    const centerClickedCategory = (collectionId: string, index: number) => {
        stopPrimaryScroll();
        clickedCollectionRef.current = collectionId;
        primaryPositionFrameRef.current = requestAnimationFrame(() => {
            primaryPositionFrameRef.current = null;
            const scroller = primaryCategoriesRef.current;
            const item = scroller?.querySelectorAll<HTMLButtonElement>('button')[index];
            if (!scroller || !item || scroller.scrollWidth <= scroller.clientWidth) return;
            primaryScrollCancelRef.current = animateCategoryScroll(
                scroller,
                centeredHorizontalScrollLeft(scroller, item),
            );
        });
    };
    useEffect(() => {
        const fromClick = clickedCollectionRef.current === activeCollectionId;
        clickedCollectionRef.current = null;
        // The click already starts a bounded animation; route confirmation must not jump it to the end.
        if (fromClick) return;
        stopPrimaryScroll();
        const scroller = primaryCategoriesRef.current;
        const item = scroller?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
        if (!scroller || !item || scroller.scrollWidth <= scroller.clientWidth) return;
        const frame = requestAnimationFrame(() => {
            primaryPositionFrameRef.current = null;
            scroller.scrollTo({
                left: centeredHorizontalScrollLeft(scroller, item),
                behavior: 'auto',
            });
        });
        primaryPositionFrameRef.current = frame;
        return () => cancelAnimationFrame(frame);
    }, [activeCollectionId, primaryCollections.length, stopPrimaryScroll]);
    useEffect(() => stopPrimaryScroll, [stopPrimaryScroll]);
    const primary =
        activeCollectionId === 'all'
            ? undefined
            : primaryCollections.find(item => item.id === activeCollectionId);
    const collectionImageMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const collection of primaryCollections) {
            const image = collectionImage(collection, products);
            if (image) map.set(collection.id, image);
        }
        return map;
    }, [primaryCollections, products]);
    const primaryCollectionImage = (collection: CollectionSummary) => collectionImageMap.get(collection.id);
    const children = primary?.children ?? [];
    const hasChildCategories = children.length > 0;
    const subcategoriesExpanded = expandedSubcategoryId === primary?.id;
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
    const catalogInput = catalogInputFromRoute({
        name: 'category',
        collectionId: activeCollectionId,
        childId: activeChildId,
        sort: sortMode,
        fulfillment: fulfillmentFilter,
        inStockOnly,
        minPrice: minimumPriceInput,
        maxPrice: maximumPriceInput,
        page,
    });
    const categoryResolved = Boolean(catalogInput.collectionId);
    const pagination = useCategoryPagination({
        api,
        market,
        languageCode: vendureLanguageCode,
        language,
        input: catalogInput,
        enabled: contextResolved && categoryResolved,
        suspended: filterOpen || allCategoriesOpen,
        route: {
            name: 'category',
            publicLanguage: language,
            page,
            collectionId: activeCollectionId === 'all' ? undefined : activeCollectionId,
            childId: activeChildId === 'all' ? undefined : activeChildId,
            sort: sortMode,
            fulfillment: fulfillmentFilter,
            inStockOnly,
            minPrice: minimumPriceInput,
            maxPrice: maximumPriceInput,
        },
    });
    const catalogQuery = pagination.query;
    const catalogQueryKey = storefrontQueryKeys.catalog(
        storefrontQueryKeys.market(market),
        vendureLanguageCode,
        { ...catalogInput },
    );
    const catalogReadIdentity = JSON.stringify(catalogQueryKey);
    const currentCatalogRead = useRef(catalogReadIdentity);
    currentCatalogRead.current = catalogReadIdentity;
    const navigationCollapse = useCategoryNavigationCollapse(
        pagination.resultsRef,
        JSON.stringify([market.code, market.currencyCode, language, catalogInput]),
        filterOpen,
        allCategoriesOpen,
    );
    const desktopNavigationContext = {
        route: {
            name: 'category',
            collectionId: activeCollectionId,
            childId: activeChildId,
            sort: sortMode,
            fulfillment: fulfillmentFilter,
            inStockOnly,
            minPrice: minimumPriceInput,
            maxPrice: maximumPriceInput,
            page,
        } as RouteState,
        language,
        collections,
        products,
        loading,
        error,
        refetchStorefront: async () => {
            await Promise.resolve(onRetry());
        },
        navigate: navigateTo,
    };
    const openFilters = () => {
        setDraftType(fulfillmentFilter);
        setDraftStock(inStockOnly);
        setDraftMinimumPrice(minimumPriceInput);
        setDraftMaximumPrice(maximumPriceInput);
        setFilterOpen(true);
    };

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
            if (product.customFields?.pricingMode === 'QUOTE_ONLY' && (minimum !== '' || maximum !== ''))
                return false;
            const price = minimumProductPrice(product) / 100;
            const minimumMatch = minimum === '' || price >= Number(minimum);
            const maximumMatch = maximum === '' || price <= Number(maximum);
            return typeMatch && stockMatch && minimumMatch && maximumMatch;
        },
        [],
    );

    const categoryProducts = categoryResolved ? pagination.products : [];
    const visibleProducts = categoryProducts;
    const totalItems = categoryResolved ? pagination.totalItems : 0;
    const categoryLoading = categoryResolved
        ? storefrontQueryPresentation(catalogQuery).initialLoading
        : loading && !error;
    const categoryError = categoryResolved
        ? (storefrontInitialQueryError(catalogQuery, language) ?? '')
        : (error ?? '');
    const loadingState = usePageLoadingState();
    usePageReadiness(
        categoryLoading || (categoryResolved && catalogQuery.isPaused && catalogQuery.isPending),
        'local',
    );

    const allCategoriesRef = useRef<HTMLDivElement | null>(null);
    const allCategoriesTriggerRef = useRef<HTMLButtonElement | null>(null);
    const allCategoriesGridRef = useRef<HTMLElement | null>(null);
    const closeAllCategories = useCallback(() => {
        setAllCategoriesOpen(false);
        // Restore focus after the compact row is visible and interactive again.
        requestAnimationFrame(() => allCategoriesTriggerRef.current?.focus({ preventScroll: true }));
    }, []);

    useEffect(() => {
        if (!allCategoriesOpen) return;
        const grid = allCategoriesGridRef.current;
        const selected =
            grid?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
            grid?.querySelector<HTMLButtonElement>('button');
        selected?.focus({ preventScroll: true });
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (allCategoriesRef.current && !allCategoriesRef.current.contains(event.target as Node)) {
                setAllCategoriesOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeAllCategories();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside, { passive: true });
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [allCategoriesOpen, closeAllCategories]);

    const draftMatchesAppliedFilters =
        draftType === fulfillmentFilter &&
        draftStock === inStockOnly &&
        draftMinimumPrice === minimumPriceInput &&
        draftMaximumPrice === maximumPriceInput;
    const draftResultCount = !categoryResolved
        ? null
        : !collections.length
          ? products.filter(product =>
                matchesFilters(product, draftType, draftStock, draftMinimumPrice, draftMaximumPrice),
            ).length
          : draftMatchesAppliedFilters && catalogQuery.isSuccess && !catalogQuery.isPlaceholderData
            ? totalItems
            : null;

    return (
        <main
            className="page category-page responsive-category-page desktop-catalog-main"
            aria-label={isZh ? '商品' : 'Products'}
        >
            <CommercePageStyles />
            <div
                className={`category-navigation-viewport${allCategoriesOpen ? ' is-menu-open' : ''}`}
                ref={navigationCollapse.viewportRef}
                data-collapsed={navigationCollapse.collapsed || undefined}
            >
                <div
                    className="category-navigation-shell"
                    ref={navigationCollapse.navigationRef}
                    inert={navigationCollapse.collapsed || undefined}
                    aria-hidden={navigationCollapse.collapsed || undefined}
                >
                    <header className="topbar category-topbar">
                        <button
                            className="search-trigger"
                            type="button"
                            aria-label={
                                isZh ? '搜索商品、品牌或分类' : 'Search products, brands, or categories'
                            }
                            onClick={() => navigateTo({ name: 'search' })}
                        >
                            <span className="search-trigger-icon" aria-hidden="true">
                                <Search />
                            </span>
                            <span className="search-trigger-placeholder">
                                {isZh ? '搜索商品、品牌或分类' : 'Search products, brands, or categories'}
                            </span>
                        </button>
                    </header>

                    <div className="desktop-catalog-header-extras">
                        <CategoryClientPluginSlot
                            block={clientPluginBlock}
                            placement="AFTER_HEADER"
                            categoryContext={clientPluginCategoryContext}
                            language={language}
                            onNavigate={navigateTo}
                        />
                    </div>

                    <section
                        ref={allCategoriesRef}
                        className={`primary-category-switcher ${allCategoriesOpen ? 'is-expanded' : ''}`}
                        aria-label={isZh ? '商品分类切换' : 'Category switcher'}
                    >
                        <div
                            className="primary-category-strip"
                            aria-hidden={allCategoriesOpen || undefined}
                            inert={allCategoriesOpen}
                        >
                            <nav
                                ref={primaryCategoriesRef}
                                className="primary-categories"
                                aria-label={isZh ? '一级分类' : 'Main categories'}
                                onPointerDown={stopPrimaryScroll}
                                onTouchStart={stopPrimaryScroll}
                                onWheel={stopPrimaryScroll}
                            >
                                {primaryCollections.map((collection, index) => {
                                    const image = primaryCollectionImage(collection);
                                    return (
                                        <button
                                            type="button"
                                            key={collection.id}
                                            title={collection.name}
                                            aria-label={collection.name}
                                            className={
                                                collection.id === activeCollectionId ? 'is-active' : undefined
                                            }
                                            aria-pressed={collection.id === activeCollectionId}
                                            onClick={() => {
                                                centerClickedCategory(collection.id, index);
                                                onCollectionChange(
                                                    collection.id,
                                                    collection.children?.[0]?.id ?? collection.id,
                                                );
                                            }}
                                        >
                                            <span className="primary-category-image">
                                                {image ? (
                                                    <SafeImage
                                                        src={image}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        sizes={STOREFRONT_IMAGE_SIZES.categoryNavigation}
                                                        loading={index < 6 ? 'eager' : 'lazy'}
                                                        showFallbackIcon={false}
                                                        errorFallback={<LayoutGrid aria-hidden="true" />}
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
                                ref={allCategoriesTriggerRef}
                                aria-expanded={allCategoriesOpen}
                                aria-controls="all-primary-categories"
                                aria-label={isZh ? '全部分类' : 'All categories'}
                                onClick={() => setAllCategoriesOpen(open => !open)}
                            >
                                <span className="primary-categories-all-label">{isZh ? '全部' : 'All'}</span>
                                {allCategoriesOpen ? (
                                    <ChevronUp aria-hidden="true" />
                                ) : (
                                    <ChevronDown aria-hidden="true" />
                                )}
                            </button>
                        </div>
                        {allCategoriesOpen && (
                            <div className="all-primary-categories" id="all-primary-categories">
                                <h2>{isZh ? '全部分类' : 'All categories'}</h2>
                                <nav
                                    ref={allCategoriesGridRef}
                                    className="all-primary-category-grid"
                                    aria-label={isZh ? '全部分类' : 'All categories'}
                                >
                                    {primaryCollections.map((collection, index) => {
                                        const image = primaryCollectionImage(collection);
                                        return (
                                            <button
                                                type="button"
                                                key={collection.id}
                                                title={collection.name}
                                                className={
                                                    collection.id === activeCollectionId
                                                        ? 'is-active'
                                                        : undefined
                                                }
                                                aria-pressed={collection.id === activeCollectionId}
                                                onClick={() => {
                                                    centerClickedCategory(collection.id, index);
                                                    onCollectionChange(
                                                        collection.id,
                                                        collection.children?.[0]?.id ?? collection.id,
                                                    );
                                                    closeAllCategories();
                                                }}
                                            >
                                                <span className="all-primary-category-image">
                                                    {image ? (
                                                        <SafeImage
                                                            src={image}
                                                            alt=""
                                                            imageKind="thumbnail"
                                                            sizes={STOREFRONT_IMAGE_SIZES.categoryNavigation}
                                                            loading="lazy"
                                                            showFallbackIcon={false}
                                                            errorFallback={<LayoutGrid aria-hidden="true" />}
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
                                    onClick={closeAllCategories}
                                >
                                    <span>{isZh ? '点击收起' : 'Collapse'}</span>
                                    <ChevronUp aria-hidden="true" />
                                </button>
                            </div>
                        )}
                    </section>
                    <aside className="desktop-catalog-sidebar category-responsive-sidebar">
                        <div className="category-desktop-only">
                            <DesktopCategoryNavigation expandChildren context={desktopNavigationContext} />
                        </div>
                        <CategoryClientPluginSlot
                            block={clientPluginBlock}
                            placement="AFTER_CATEGORY_NAVIGATION"
                            categoryContext={clientPluginCategoryContext}
                            language={language}
                            onNavigate={navigateTo}
                        />
                        <section className="desktop-catalog-help category-desktop-only">
                            <h2>{isZh ? '需要帮助？' : 'Need help?'}</h2>
                            <p>
                                {isZh
                                    ? '咨询商品、订单与售后问题'
                                    : 'Get help with products, orders and after-sales'}
                            </p>
                            <button type="button" onClick={() => navigateTo({ name: 'support' })}>
                                {isZh ? '联系客服' : 'Contact support'}
                            </button>
                        </section>
                    </aside>
                </div>
            </div>
            <div className={`category-layout${hasChildCategories ? ' has-sidebar' : ' is-full-width'}`}>
                {hasChildCategories && (
                    <aside
                        ref={subcatScrollerRef}
                        id="category-subcategories"
                        className={`category-subcat-sidebar${subcategoriesExpanded ? ' is-expanded' : ''}`}
                        aria-label={isZh ? '二级分类' : 'Subcategories'}
                    >
                        {children.map((child, index) => (
                            <button
                                type="button"
                                key={child.id}
                                className={`subcat-side-item${child.id === activeChildId ? ' is-active' : ''}${index >= 6 ? ' subcat-overflow-item' : ''}`}
                                aria-pressed={child.id === activeChildId}
                                onClick={() => onChildChange(child.id)}
                            >
                                <span className="subcat-side-name">{child.name}</span>
                            </button>
                        ))}
                        {children.length > 6 && (
                            <button
                                type="button"
                                className="subcat-expand-toggle"
                                aria-expanded={subcategoriesExpanded}
                                aria-controls="category-subcategories"
                                onClick={() =>
                                    setExpandedSubcategoryId(
                                        subcategoriesExpanded ? null : (primary?.id ?? null),
                                    )
                                }
                            >
                                {subcategoriesExpanded
                                    ? isZh
                                        ? '收起分类'
                                        : 'Show less'
                                    : isZh
                                      ? '更多分类'
                                      : 'More categories'}
                                {subcategoriesExpanded ? (
                                    <ChevronUp aria-hidden="true" />
                                ) : (
                                    <ChevronDown aria-hidden="true" />
                                )}
                            </button>
                        )}
                    </aside>
                )}

                <section
                    className="category-results desktop-catalog-workspace desktop-catalog-results"
                    ref={pagination.resultsRef}
                    data-scroll-restoration-id="category-results"
                >
                    <div className="desktop-catalog-toolbar category-desktop-only">
                        <div className="section-heading-inline desktop-catalog-heading">
                            <h1 className="desktop-catalog-label">
                                {children.find(child => child.id === activeChildId)?.name ||
                                    primary?.name ||
                                    (isZh ? '商品' : 'Products')}
                            </h1>
                            <span className="desktop-result-count" role="status">
                                {categoryLoading
                                    ? isZh
                                        ? '加载中…'
                                        : 'Loading…'
                                    : catalogQuery.data === undefined
                                      ? isZh
                                          ? '暂不可用'
                                          : 'Unavailable'
                                      : isZh
                                        ? `${totalItems} 件商品`
                                        : `${totalItems} products`}
                            </span>
                        </div>
                        <div className="desktop-catalog-actions">
                            <nav className="desktop-sort" aria-label={isZh ? '商品排序' : 'Sort products'}>
                                {(
                                    [
                                        ['recommended', isZh ? '全部' : 'All'],
                                        ['sales', isZh ? '销量' : 'Best sellers'],
                                        ['newest', isZh ? '最新' : 'Newest'],
                                        ['price-asc', isZh ? '价格从低到高' : 'Price: low to high'],
                                        ['price-desc', isZh ? '价格从高到低' : 'Price: high to low'],
                                    ] as const
                                ).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={
                                            sortMode === value && (value !== 'recommended' || !hasFilters)
                                        }
                                        onClick={() =>
                                            value === 'recommended'
                                                ? navigateTo({
                                                      ...desktopNavigationContext.route,
                                                      page: 1,
                                                      sort: value,
                                                      fulfillment: 'all',
                                                      inStockOnly: false,
                                                      minPrice: undefined,
                                                      maxPrice: undefined,
                                                  })
                                                : onSortChange(value)
                                        }
                                    >
                                        {label}
                                    </button>
                                ))}
                            </nav>
                            <label className="desktop-stock-filter">
                                <input
                                    type="checkbox"
                                    checked={inStockOnly}
                                    onChange={event =>
                                        onFilterChange(
                                            fulfillmentFilter,
                                            event.target.checked,
                                            minimumPriceInput,
                                            maximumPriceInput,
                                        )
                                    }
                                />
                                {isZh ? '仅看有货' : 'In stock only'}
                            </label>
                            <button
                                type="button"
                                aria-expanded={filterOpen}
                                aria-haspopup="dialog"
                                onClick={openFilters}
                            >
                                <SlidersHorizontal aria-hidden="true" />
                                {isZh ? '筛选' : 'Filter'}
                            </button>
                            {hasFilters && (
                                <button type="button" onClick={() => onFilterChange('all', false, '', '')}>
                                    {isZh ? '重置' : 'Reset'}
                                </button>
                            )}
                        </div>
                    </div>
                    <nav
                        className="sort-bar sort-bar-five"
                        aria-label={isZh ? '排序和筛选' : 'Sort and filter'}
                    >
                        <button
                            type="button"
                            className={sortMode === 'recommended' && !hasFilters ? 'is-active' : undefined}
                            aria-pressed={sortMode === 'recommended' && !hasFilters}
                            onClick={() =>
                                navigateTo({
                                    name: 'category',
                                    collectionId: activeCollectionId,
                                    childId: activeChildId,
                                    sort: 'recommended',
                                    fulfillment: 'all',
                                    inStockOnly: false,
                                })
                            }
                        >
                            {isZh ? '全部' : 'All'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'sales' ? 'is-active' : undefined}
                            aria-pressed={sortMode === 'sales'}
                            onClick={() => onSortChange('sales')}
                        >
                            {isZh ? '销量' : 'Sales'}
                        </button>
                        <button
                            type="button"
                            className={sortMode === 'newest' ? 'is-active' : undefined}
                            aria-pressed={sortMode === 'newest'}
                            onClick={() => onSortChange('newest')}
                        >
                            {isZh ? '最新' : 'Newest'}
                        </button>
                        <button
                            type="button"
                            className={sortMode.startsWith('price') ? 'is-active' : undefined}
                            aria-pressed={sortMode.startsWith('price')}
                            aria-label={priceSortActionLabel(sortMode, isZh)}
                            onClick={() =>
                                onSortChange(sortMode === 'price-asc' ? 'price-desc' : 'price-asc')
                            }
                        >
                            {isZh ? '价格' : 'Price'}{' '}
                            {sortMode === 'price-asc' ? (
                                <ChevronUp aria-hidden="true" />
                            ) : sortMode === 'price-desc' ? (
                                <ChevronDown aria-hidden="true" />
                            ) : (
                                <ArrowUpDown aria-hidden="true" />
                            )}
                        </button>
                        <button
                            type="button"
                            className={hasFilters ? 'is-active' : undefined}
                            onClick={openFilters}
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

                    {categoryLoading && loadingState?.phase === 'error' ? (
                        <PageReadinessError
                            inline
                            state={{
                                ...loadingState,
                                retry: () =>
                                    loadingState.retryRead(() => {
                                        if (!categoryResolved) return onRetry();
                                        void queryClient
                                            .cancelQueries({ queryKey: catalogQueryKey, exact: true })
                                            .then(() => {
                                                if (currentCatalogRead.current === catalogReadIdentity)
                                                    void catalogQuery.refetch({ cancelRefetch: false });
                                            });
                                    }),
                            }}
                        />
                    ) : categoryLoading ? (
                        <ListSkeleton
                            className="category-product-list desktop-product-grid"
                            layout="products"
                            responsiveRow
                            count={12}
                            label={isZh ? '正在加载商品' : 'Loading products'}
                        />
                    ) : categoryError && !categoryProducts.length ? (
                        <EmptyState
                            icon={<WifiOff />}
                            title={isZh ? '商品加载失败' : 'Could not load products'}
                            detail={categoryError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() =>
                                collections.length
                                    ? void catalogQuery.refetch({ cancelRefetch: false })
                                    : onRetry()
                            }
                            compact
                        />
                    ) : categoryProducts.length ? (
                        <>
                            <div className="category-product-list desktop-product-grid">
                                {visibleProducts.map((product, index) => (
                                    <ProductCard
                                        key={product.id}
                                        responsiveRow
                                        eager={index < 5}
                                        priority={index === 0}
                                        imageSizes={
                                            '(min-width: 1024px) 220px, ' +
                                            (hasChildCategories
                                                ? STOREFRONT_IMAGE_SIZES.categorySidebarRow
                                                : STOREFRONT_IMAGE_SIZES.productRow)
                                        }
                                        product={product}
                                        market={market}
                                        locale={locale}
                                        language={language}
                                        onOpen={() => navigateTo({ name: 'product', id: product.id })}
                                    />
                                ))}
                            </div>
                            <CategoryPaginationStatus
                                sentinelRef={pagination.sentinelRef}
                                language={language}
                                nextHref={pagination.nextHref}
                                previousHref={pagination.previousHref}
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
                    <footer className="desktop-catalog-footer category-desktop-only">
                        <span>{storefrontName}</span>
                        <nav aria-label={isZh ? '店铺政策' : 'Store policies'}>
                            <button
                                type="button"
                                onClick={() => navigateTo({ name: 'legal', id: 'privacy' })}
                            >
                                {isZh ? '隐私政策' : 'Privacy'}
                            </button>
                            <button type="button" onClick={() => navigateTo({ name: 'legal', id: 'terms' })}>
                                {isZh ? '使用条款' : 'Terms'}
                            </button>
                        </nav>
                    </footer>
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
                <CatalogFilterSheet
                    language={language}
                    currencyCode={market.currencyCode}
                    value={{
                        fulfillment: draftType,
                        inStockOnly: draftStock,
                        minPrice: draftMinimumPrice,
                        maxPrice: draftMaximumPrice,
                    }}
                    resultCount={draftResultCount}
                    onChange={value => {
                        setDraftType(value.fulfillment);
                        setDraftStock(value.inStockOnly);
                        setDraftMinimumPrice(value.minPrice);
                        setDraftMaximumPrice(value.maxPrice);
                    }}
                    onApply={value => {
                        onFilterChange(value.fulfillment, value.inStockOnly, value.minPrice, value.maxPrice);
                        setFilterOpen(false);
                    }}
                    onClose={() => setFilterOpen(false)}
                />
            )}
        </main>
    );
}
