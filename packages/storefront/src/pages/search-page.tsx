import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import {
    ArrowLeft,
    ArrowUpRight,
    CircleAlert,
    LayoutGrid,
    Search,
    SlidersHorizontal,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps route types after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import allCategoriesIcon from '../assets/icons/catalog-directory-color.webp';
import {
    catalogInputFromRoute,
    catalogRouteSearch,
    catalogRouteState,
    type CatalogRouteState,
} from '../catalog-route-query';
import { CatalogFilterSheet, type CatalogFilterValues } from '../components/common/catalog-filter-sheet';
import { ProductRow } from '../components/common/product-row';
import { useDesktopLayout } from '../desktop-layout';
import { languageCodeFor } from '../i18n';
import { isInputMethodKey } from '../input-method';
import { offlineLoadError } from '../loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { SearchPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions } from '../storefront-router';
import { readStoredStrings, scopedStorageKey, SEARCH_HISTORY_STORAGE_KEY } from '../storefront-storage';
import { EmptyState, ListSkeleton } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import '../styles/search-surfaces.css';
import { CollectionSummary, MarketConfig, Product, StorefrontLanguage } from '../types';

export interface SearchPageProps {
    api: ShopApi;
    products: Product[];
    collections?: CollectionSummary[];
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontCode: string;
    customerId?: string | null;
    initialQuery: string;
    initialFilters?: CatalogRouteState;
}
const emptyFilters = catalogRouteState({ name: 'search' });

export function SearchPage() {
    const navigate = useNavigate();
    const router = useRouter();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const {
        api,
        products,
        collections = [],
        market,
        locale,
        language,
        storefrontCode,
        customerId,
        initialQuery,
        initialFilters,
    } = SearchPageContext.useValue();
    const isZh = language === 'zh';
    const desktop = useDesktopLayout();
    const inputRef = useRef<HTMLInputElement>(null);
    const listId = useId();
    const [query, setQuery] = useState(initialQuery);
    const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
    const [filters, setFilters] = useState(() => ({ ...emptyFilters, ...initialFilters }));
    const [filterOpen, setFilterOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<CatalogFilterValues>(emptyFilters);
    const [history, setHistory] = useState<string[]>([]);
    const [clearedHistory, setClearedHistory] = useState<string[] | null>(null);
    const [historyExpanded, setHistoryExpanded] = useState(false);
    const [composing, setComposing] = useState(false);
    const [debouncedTerm, setDebouncedTerm] = useState('');
    const [activeSuggestion, setActiveSuggestion] = useState(-1);
    const storeHistoryKey = scopedStorageKey(SEARCH_HISTORY_STORAGE_KEY, storefrontCode);
    const historyKey = storeHistoryKey
        ? storeHistoryKey + ':' + (customerId ? 'customer:' + encodeURIComponent(customerId) : 'guest')
        : '';
    const languageCode = languageCodeFor(language);
    const marketKey = storefrontQueryKeys.market(market);
    const term = submittedQuery.trim();
    const draftTerm = query.trim();
    const showSuggestions = !!draftTerm && draftTerm !== term;
    const routeFiltersKey = JSON.stringify({ ...emptyFilters, ...initialFilters });
    const suggestedProducts = products.slice(0, 6);
    const rootCollections = collections.filter(
        collection => !collection.parentId || !collections.some(parent => parent.id === collection.parentId),
    );
    useEffect(() => {
        setQuery(initialQuery);
        setSubmittedQuery(initialQuery);
        setActiveSuggestion(-1);
    }, [initialQuery]);
    useEffect(() => {
        setFilters(JSON.parse(routeFiltersKey) as typeof emptyFilters);
    }, [routeFiltersKey]);
    useEffect(() => {
        setHistory(readStoredStrings(historyKey, 8));
        setClearedHistory(null);
        setHistoryExpanded(false);
    }, [historyKey]);
    useEffect(() => {
        setActiveSuggestion(-1);
        if (composing || !showSuggestions) {
            setDebouncedTerm('');
            return;
        }
        const timer = window.setTimeout(() => setDebouncedTerm(draftTerm), 250);
        return () => window.clearTimeout(timer);
    }, [draftTerm, composing, showSuggestions]);

    const searchInput = {
        ...catalogInputFromRoute({ name: 'search', term, ...filters }),
        inStockOnly: filters.inStockOnly || undefined,
    };
    const searchQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog(marketKey, languageCode, searchInput),
        queryFn: ({ pageParam, signal }) =>
            api.catalog({ ...searchInput, skip: pageParam, take: 20 }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        enabled: !!term,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        placeholderData: keepPreviousData,
        meta: publicQueryMeta(),
    });
    const suggestionsQuery = useQuery({
        // A bounded suggestion page must never overwrite the infinite result cache.
        queryKey: [
            ...storefrontQueryKeys.catalog(marketKey, languageCode, { term: debouncedTerm }),
            'suggestions',
        ],
        queryFn: ({ signal }) => api.catalog({ term: debouncedTerm, take: 5, skip: 0 }, signal),
        enabled: showSuggestions && !composing && !!debouncedTerm && debouncedTerm === draftTerm,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        retry: false,
        meta: publicQueryMeta(),
    });
    const suggestionsReady = !composing && debouncedTerm === draftTerm;
    const suggestionProducts = suggestionsReady ? (suggestionsQuery.data?.items ?? []) : [];
    const suggestionCollections = collections
        .filter(
            collection =>
                collection.name.toLocaleLowerCase().includes(draftTerm.toLocaleLowerCase()) ||
                suggestionProducts.some(product =>
                    product.collections.some(item => item.id === collection.id),
                ),
        )
        .slice(0, 3);
    const suggestionOptions = [
        { label: isZh ? '搜索“' + draftTerm + '”' : 'Search for “' + draftTerm + '”', term: draftTerm },
        ...suggestionProducts.map(product => ({ label: product.name, term: product.name })),
        ...suggestionCollections.map(collection => ({ label: collection.name, collectionId: collection.id })),
    ];
    const results = useMemo(
        () => searchQuery.data?.pages.flatMap(page => page.items) ?? [],
        [searchQuery.data?.pages],
    );
    const totalItems = searchQuery.data?.pages[0]?.totalItems ?? 0;
    const searching = searchQuery.isLoading;
    const searchError =
        searchQuery.isPaused && searchQuery.data === undefined
            ? offlineLoadError(language)
            : searchQuery.error instanceof Error
              ? storefrontErrorMessage(searchQuery.error, language)
              : '';
    const relatedProducts = products
        .filter(product => !results.some(result => result.id === product.id))
        .slice(0, desktop ? 4 : 2);
    const hasFilters =
        filters.collectionId !== 'all' ||
        filters.childId !== 'all' ||
        filters.fulfillment !== 'all' ||
        filters.inStockOnly ||
        !!filters.minPrice ||
        !!filters.maxPrice;
    const filterSummary = [
        collections.find(
            collection =>
                collection.id === (filters.childId !== 'all' ? filters.childId : filters.collectionId),
        )?.name,
        filters.inStockOnly ? (isZh ? '仅看有货' : 'In stock only') : '',
        filters.fulfillment !== 'all'
            ? filters.fulfillment === 'physical'
                ? isZh
                    ? '实物'
                    : 'Physical'
                : isZh
                  ? '数字商品'
                  : 'Digital'
            : '',
        filters.minPrice || filters.maxPrice
            ? market.currencyCode + ' ' + (filters.minPrice || '0') + ' – ' + (filters.maxPrice || '∞')
            : '',
    ]
        .filter(Boolean)
        .join(' · ');

    const persistHistory = (next: string[]) => {
        setHistory(next);
        if (!historyKey) return;
        try {
            if (next.length) localStorage.setItem(historyKey, JSON.stringify(next));
            else localStorage.removeItem(historyKey);
        } catch {
            // Searching remains available when browser storage rejects writes.
        }
    };
    const updateFilters = (next: typeof filters) => {
        setFilters(next);
        void navigate({
            ...routeNavigateOptions({
                name: 'search',
                term,
                ...catalogRouteSearch({ name: 'search', ...next }),
            }),
            replace: true,
        } as never);
    };
    const clearFilters = () => updateFilters({ ...emptyFilters, sort: filters.sort });
    const submit = (value = query) => {
        const next = value.trim();
        if (!next || composing) return;
        setQuery(next);
        setSubmittedQuery(next);
        setActiveSuggestion(-1);
        inputRef.current?.blur();
        void navigate({
            ...routeNavigateOptions({
                name: 'search',
                term: next,
                ...catalogRouteSearch({ name: 'search', ...filters }),
            }),
            replace: true,
        } as never);
        persistHistory([next, ...history.filter(item => item !== next)].slice(0, 8));
        setClearedHistory(null);
    };
    const clearQuery = () => {
        setQuery('');
        setSubmittedQuery('');
        setFilters(emptyFilters);
        setActiveSuggestion(-1);
        void navigate({ ...routeNavigateOptions({ name: 'search' }), replace: true } as never);
    };
    const chooseSuggestion = (index: number) => {
        const option = suggestionOptions[index];
        if (!option) return;
        if ('collectionId' in option) navigateTo({ name: 'category', collectionId: option.collectionId });
        else submit(option.term);
    };
    const closeSearch = () => {
        if (router.history.canGoBack()) router.history.back();
        else navigateTo({ name: 'home' });
    };
    useEffect(() => {
        if (!desktop) return;
        const onEscape = (event: KeyboardEvent) => {
            if (
                event.key !== 'Escape' ||
                event.defaultPrevented ||
                isInputMethodKey(event) ||
                document.querySelector('[role="dialog"], [role="alertdialog"]')
            )
                return;
            event.preventDefault();
            if (router.history.canGoBack()) router.history.back();
            else void navigate(routeNavigateOptions({ name: 'home' }) as never);
        };
        window.addEventListener('keydown', onEscape);
        return () => window.removeEventListener('keydown', onEscape);
    }, [desktop, navigate, router.history]);
    const categoryLinks = (
        <section className="search-browse">
            <header>
                <h2>{isZh ? '分类直达' : 'Browse categories'}</h2>
                <span>{isZh ? '按商品分类浏览' : 'Explore the range'}</span>
            </header>
            <nav className="search-category-links" aria-label={isZh ? '商品分类' : 'Product categories'}>
                <button type="button" onClick={() => navigateTo({ name: 'category' })}>
                    <img src={allCategoriesIcon} width={28} height={28} alt="" />
                    <span>{isZh ? '全部分类' : 'All categories'}</span>
                </button>
                {rootCollections.slice(0, 3).map(collection => (
                    <button
                        type="button"
                        key={collection.id}
                        title={collection.name}
                        onClick={() => navigateTo({ name: 'category', collectionId: collection.id })}
                    >
                        {collection.featuredAsset?.preview ? (
                            <img
                                src={collection.featuredAsset.preview}
                                width={28}
                                height={28}
                                alt=""
                                loading="lazy"
                            />
                        ) : (
                            <LayoutGrid aria-hidden="true" />
                        )}
                        <span>{collection.name}</span>
                    </button>
                ))}
            </nav>
        </section>
    );
    return (
        <main
            className="page subpage search-page"
            data-page-pending={
                term && !showSuggestions && (searching || searchQuery.isPlaceholderData) ? 'query' : undefined
            }
        >
            <h1 className="visually-hidden">{isZh ? '搜索商品' : 'Search products'}</h1>
            <header className="search-header">
                <button type="button" onClick={closeSearch} aria-label={isZh ? '返回' : 'Back'}>
                    <ArrowLeft />
                </button>
                <div className="search-input-field">
                    <Search aria-hidden="true" />
                    <input
                        ref={inputRef}
                        autoFocus
                        type="search"
                        role="combobox"
                        aria-label={isZh ? '搜索商品、分类' : 'Search products and categories'}
                        aria-autocomplete="list"
                        aria-expanded={showSuggestions}
                        aria-controls={showSuggestions ? listId : undefined}
                        aria-activedescendant={
                            showSuggestions &&
                            activeSuggestion >= 0 &&
                            activeSuggestion < suggestionOptions.length
                                ? listId + '-' + activeSuggestion
                                : undefined
                        }
                        autoComplete="off"
                        value={query}
                        onCompositionStart={() => setComposing(true)}
                        onCompositionEnd={() => setComposing(false)}
                        onChange={event => {
                            const next = event.target.value;
                            if (!next) clearQuery();
                            else setQuery(next);
                        }}
                        onKeyDown={event => {
                            if (isInputMethodKey(event.nativeEvent) || composing) return;
                            if (showSuggestions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                                event.preventDefault();
                                setActiveSuggestion(index =>
                                    index < 0
                                        ? event.key === 'ArrowDown'
                                            ? 0
                                            : suggestionOptions.length - 1
                                        : (index +
                                              (event.key === 'ArrowDown' ? 1 : -1) +
                                              suggestionOptions.length) %
                                          suggestionOptions.length,
                                );
                            } else if (event.key === 'Enter') {
                                event.preventDefault();
                                if (
                                    showSuggestions &&
                                    activeSuggestion >= 0 &&
                                    activeSuggestion < suggestionOptions.length
                                )
                                    chooseSuggestion(activeSuggestion);
                                else submit();
                            } else if (event.key === 'Escape' && showSuggestions) {
                                event.preventDefault();
                                setQuery(submittedQuery);
                                setActiveSuggestion(-1);
                            }
                        }}
                        placeholder={isZh ? '搜索商品、分类' : 'Search products'}
                    />
                    {!!query && (
                        <button
                            className="search-clear"
                            type="button"
                            aria-label={isZh ? '清空输入' : 'Clear input'}
                            onClick={() => {
                                clearQuery();
                                inputRef.current?.focus();
                            }}
                        >
                            <X />
                        </button>
                    )}
                </div>
                <button className="search-submit" type="button" onClick={() => submit()}>
                    <span>{isZh ? '搜索' : 'Search'}</span>
                </button>
                {desktop && (
                    <button className="search-close" type="button" onClick={closeSearch}>
                        <X size={18} aria-hidden="true" />
                        <span>{isZh ? '关闭搜索' : 'Close search'}</span>
                    </button>
                )}
            </header>
            {showSuggestions ? (
                <section className="search-suggestions" aria-label={isZh ? '搜索建议' : 'Search suggestions'}>
                    <ul id={listId} role="listbox" aria-label={isZh ? '搜索建议' : 'Search suggestions'}>
                        {suggestionOptions.map((option, index) => (
                            <li
                                role="option"
                                id={listId + '-' + index}
                                key={'collectionId' in option ? option.collectionId : option.term + index}
                                aria-selected={activeSuggestion === index}
                            >
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => chooseSuggestion(index)}
                                    onPointerDown={event => event.preventDefault()}
                                >
                                    {'collectionId' in option ? <LayoutGrid /> : <Search />}
                                    <span>{option.label}</span>
                                    {'collectionId' in option && <small>{isZh ? '分类' : 'Category'}</small>}
                                    <ArrowUpRight />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <p className="search-suggestion-status" role="status">
                        {composing || !suggestionsReady || suggestionsQuery.isLoading
                            ? isZh
                                ? '正在查找建议…'
                                : 'Finding suggestions…'
                            : suggestionsQuery.isError || suggestionsQuery.isPaused
                              ? isZh
                                  ? '建议暂不可用，仍可直接搜索'
                                  : 'Suggestions unavailable. You can still search.'
                              : !suggestionProducts.length
                                ? isZh
                                    ? '暂无商品建议，可直接搜索完整关键词'
                                    : 'No product suggestions. Try the full search.'
                                : isZh
                                  ? '选择建议，或按回车搜索'
                                  : 'Choose a suggestion or press Enter to search.'}
                    </p>
                </section>
            ) : !term ? (
                <div className="search-discovery">
                    <section className="search-recent">
                        <header>
                            <h2>{isZh ? '最近搜索' : 'Recent searches'}</h2>
                            <div className="search-history-actions">
                                {history.length > 4 && (
                                    <button
                                        type="button"
                                        aria-expanded={historyExpanded}
                                        onClick={() => setHistoryExpanded(value => !value)}
                                    >
                                        {historyExpanded ? (isZh ? '收起' : 'Less') : isZh ? '展开' : 'More'}
                                    </button>
                                )}
                                {!!history.length && (
                                    <button
                                        type="button"
                                        aria-label={isZh ? '清空' : 'Clear'}
                                        onClick={() => {
                                            setClearedHistory([...history]);
                                            persistHistory([]);
                                        }}
                                    >
                                        <Trash2 />
                                        {isZh ? '清空' : 'Clear'}
                                    </button>
                                )}
                                {!history.length && clearedHistory && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            persistHistory(clearedHistory);
                                            setClearedHistory(null);
                                        }}
                                    >
                                        {isZh ? '撤销清空' : 'Undo clear'}
                                    </button>
                                )}
                            </div>
                        </header>
                        <div className="search-tags">
                            {(historyExpanded ? history : history.slice(0, 4)).map(item => (
                                <button type="button" key={item} onClick={() => submit(item)} title={item}>
                                    {item}
                                </button>
                            ))}
                            {!history.length && (
                                <small>
                                    {isZh
                                        ? '搜索过的关键词会显示在这里'
                                        : 'Your recent searches will appear here'}
                                </small>
                            )}
                        </div>
                    </section>
                    {!!suggestedProducts.length && (
                        <section className="search-discover-terms">
                            <header>
                                <h2>{isZh ? '你可能在找' : 'You might be looking for'}</h2>
                                <span>{isZh ? '店内商品' : 'From this store'}</span>
                            </header>
                            <div className="search-term-list">
                                {suggestedProducts.map(product => (
                                    <button
                                        type="button"
                                        key={product.id}
                                        onClick={() => submit(product.name)}
                                        title={product.name}
                                    >
                                        <span>{product.name}</span>
                                        <ArrowUpRight />
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                    {categoryLinks}
                    <ProductSection
                        title={isZh ? '今日推荐' : "Today's picks"}
                        subtitle={isZh ? '从店内在售商品开始' : 'Available from this store'}
                        subtitlePlacement="end"
                        appearance="plain"
                        products={products.slice(0, desktop ? 10 : 2)}
                        market={market}
                        locale={locale}
                        language={language}
                        onProduct={product => navigateTo({ name: 'product', id: product.id })}
                    />
                </div>
            ) : (
                <section className="search-results">
                    <header className="search-results-heading">
                        <h2>{isZh ? '“' + term + '”的结果' : 'Results for “' + term + '”'}</h2>
                        <span role="status">
                            {searching || searchQuery.isPlaceholderData
                                ? isZh
                                    ? '搜索中'
                                    : 'Searching'
                                : searchError && !results.length
                                  ? isZh
                                      ? '暂不可用'
                                      : 'Unavailable'
                                  : isZh
                                    ? totalItems + ' 件商品'
                                    : totalItems + ' items'}
                        </span>
                    </header>
                    <nav className="search-sort" aria-label={isZh ? '搜索结果排序' : 'Search result sorting'}>
                        {(['recommended', 'name', 'price-asc'] as const).map(sort => {
                            const active =
                                sort === 'price-asc'
                                    ? filters.sort.startsWith('price')
                                    : filters.sort === sort;
                            return (
                                <button
                                    type="button"
                                    key={sort}
                                    className={active ? 'is-active' : undefined}
                                    aria-pressed={active}
                                    onClick={() =>
                                        updateFilters({
                                            ...filters,
                                            sort:
                                                sort === 'price-asc' && filters.sort === 'price-asc'
                                                    ? 'price-desc'
                                                    : sort,
                                        })
                                    }
                                >
                                    {sort === 'recommended'
                                        ? isZh
                                            ? '综合'
                                            : 'Recommended'
                                        : sort === 'name'
                                          ? isZh
                                              ? '名称'
                                              : 'Name'
                                          : isZh
                                            ? '价格'
                                            : 'Price'}
                                    {sort === 'price-asc' && (
                                        <span aria-hidden="true">
                                            {filters.sort === 'price-desc' ? ' ↓' : ' ↑'}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            className={'search-filter-trigger' + (hasFilters ? ' is-active' : '')}
                            aria-label={isZh ? '筛选' : 'Filter'}
                            onClick={() => {
                                setDraftFilters({ ...filters });
                                setFilterOpen(true);
                            }}
                        >
                            <SlidersHorizontal />
                            {isZh ? '筛选' : 'Filter'}
                        </button>
                    </nav>
                    {hasFilters && (
                        <div className="search-filter-summary">
                            <span>{filterSummary || (isZh ? '已筛选' : 'Filtered')}</span>
                            <button type="button" onClick={clearFilters}>
                                {isZh ? '清除筛选' : 'Clear filters'}
                            </button>
                        </div>
                    )}
                    {searching ? (
                        <ListSkeleton label={isZh ? '正在搜索商品' : 'Searching products'} />
                    ) : searchError && !results.length ? (
                        <EmptyState
                            compact
                            icon={<CircleAlert />}
                            title={isZh ? '搜索暂时不可用' : 'Search unavailable'}
                            detail={searchError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void searchQuery.refetch()}
                        />
                    ) : results.length ? (
                        <div className="product-list" aria-busy={searchQuery.isPlaceholderData}>
                            {desktop ? (
                                <ProductSection
                                    products={results}
                                    appearance="plain"
                                    market={market}
                                    locale={locale}
                                    language={language}
                                    onProduct={product => navigateTo({ name: 'product', id: product.id })}
                                />
                            ) : (
                                results.map(product => (
                                    <ProductRow
                                        key={product.id}
                                        product={product}
                                        showDescription={false}
                                        market={market}
                                        locale={locale}
                                        language={language}
                                        onOpen={() => navigateTo({ name: 'product', id: product.id })}
                                    />
                                ))
                            )}
                            {searchError && (
                                <div className="search-load-error" role="alert">
                                    <span>{searchError}</span>
                                    <button type="button" onClick={() => void searchQuery.fetchNextPage()}>
                                        {isZh ? '重试' : 'Retry'}
                                    </button>
                                </div>
                            )}
                            {results.length < totalItems && (
                                <button
                                    className="load-more-button search-load-more"
                                    type="button"
                                    disabled={searchQuery.isFetchingNextPage || searchQuery.isPlaceholderData}
                                    onClick={() => void searchQuery.fetchNextPage()}
                                >
                                    {searchQuery.isFetchingNextPage
                                        ? isZh
                                            ? '加载中'
                                            : 'Loading'
                                        : isZh
                                          ? '加载更多（剩余 ' + (totalItems - results.length) + ' 件）'
                                          : 'Load more (' + (totalItems - results.length) + ' remaining)'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="search-empty">
                            <EmptyState
                                compact
                                icon={<Search />}
                                title={isZh ? '暂未找到相关商品' : 'No matching products'}
                                detail={
                                    hasFilters
                                        ? isZh
                                            ? '试试清除筛选，或缩短关键词'
                                            : 'Clear filters or try a shorter keyword'
                                        : isZh
                                          ? '缩短关键词，或从分类继续浏览'
                                          : 'Try a shorter keyword or browse categories'
                                }
                                action={
                                    hasFilters
                                        ? isZh
                                            ? '清除筛选条件'
                                            : 'Clear filters'
                                        : isZh
                                          ? '查看分类'
                                          : 'Browse categories'
                                }
                                onAction={hasFilters ? clearFilters : () => navigateTo({ name: 'category' })}
                            />
                            {categoryLinks}
                        </div>
                    )}
                    {!searching && !searchError && !results.length && !!relatedProducts.length && (
                        <ProductSection
                            title={isZh ? '继续看看' : 'Keep exploring'}
                            subtitle={isZh ? '店内在售商品' : 'Available in store'}
                            subtitlePlacement="end"
                            appearance="plain"
                            products={relatedProducts}
                            market={market}
                            locale={locale}
                            language={language}
                            onProduct={product => navigateTo({ name: 'product', id: product.id })}
                        />
                    )}
                </section>
            )}
            {filterOpen && (
                <CatalogFilterSheet
                    className="search-filter-sheet"
                    collections={collections}
                    language={language}
                    currencyCode={market.currencyCode}
                    value={draftFilters}
                    resultCount={null}
                    onChange={setDraftFilters}
                    onApply={value => {
                        updateFilters({
                            ...filters,
                            ...value,
                            collectionId: value.collectionId ?? 'all',
                            childId: 'all',
                        });
                        setFilterOpen(false);
                    }}
                    onClose={() => setFilterOpen(false)}
                />
            )}
        </main>
    );
}
