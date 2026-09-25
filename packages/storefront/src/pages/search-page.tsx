import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft, CircleAlert, Download, LayoutGrid, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
// eslint-disable-next-line import/order -- organize-imports keeps relative type imports after packages.
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
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
import { EmptyState, ListSkeleton, SectionIcon } from '../storefront-ui/page-shell';
import { ProductSection } from '../storefront-ui/product-section';
import { CollectionSummary, MarketConfig, Product, ProductSearchSort, StorefrontLanguage } from '../types';

import '../styles/search-surfaces.css';

// TODO: Fix internal imports later

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
}

export function SearchPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
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
    } = SearchPageContext.useValue();
    const isZh = language === 'zh';
    const desktop = useDesktopLayout();
    const closeSearch = () => {
        if (router.history.canGoBack()) {
            router.history.back();
        } else {
            navigateTo({ name: 'home' });
        }
    };
    const [query, setQuery] = useState(initialQuery);
    const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
    const [resultSort, setResultSort] = useState<ProductSearchSort>('recommended');
    const [history, setHistory] = useState<string[]>([]);
    const storeSearchHistoryKey = scopedStorageKey(SEARCH_HISTORY_STORAGE_KEY, storefrontCode);
    const searchHistoryStorageKey = storeSearchHistoryKey
        ? `${storeSearchHistoryKey}:${customerId ? `customer:${encodeURIComponent(customerId)}` : 'guest'}`
        : '';
    const popularSearches = products.slice(0, 6);
    const vendureLanguageCode = languageCodeFor(language);
    const term = submittedQuery.trim();
    const searchInput = { term, sort: resultSort };
    const searchQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.catalog(
            storefrontQueryKeys.market(market),
            vendureLanguageCode,
            searchInput,
        ),
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
    const results = useMemo(
        () => searchQuery.data?.pages.flatMap(page => page.items) ?? [],
        [searchQuery.data?.pages],
    );
    const totalItems = searchQuery.data?.pages[0]?.totalItems ?? 0;
    const searching = searchQuery.isLoading;
    const loadingMore = searchQuery.isFetchingNextPage;
    const searchError =
        searchQuery.isPaused && searchQuery.data === undefined
            ? offlineLoadError(language)
            : searchQuery.error instanceof Error
              ? storefrontErrorMessage(searchQuery.error, language)
              : '';
    const relatedProducts = products
        .filter(product => !results.some(result => result.id === product.id))
        .slice(0, 2);

    useEffect(() => {
        setQuery(initialQuery);
        setSubmittedQuery(initialQuery);
    }, [initialQuery]);
    const submit = (value = query) => {
        const next = value.trim();
        if (!next) return;
        setQuery(next);
        setSubmittedQuery(next);
        void navigate({ ...routeNavigateOptions({ name: 'search', term: next }), replace: true } as never);
        const nextHistory = [next, ...history.filter(item => item !== next)].slice(0, 8);
        setHistory(nextHistory);
        if (searchHistoryStorageKey) {
            try {
                localStorage.setItem(searchHistoryStorageKey, JSON.stringify(nextHistory));
            } catch {
                // Searching and in-memory history still work when browser storage is restricted.
            }
        }
    };

    useEffect(() => {
        setHistory(readStoredStrings(searchHistoryStorageKey, 8));
    }, [searchHistoryStorageKey]);

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

    const loadMore = () => searchQuery.fetchNextPage();

    return (
        <main
            className="page subpage search-page"
            data-page-pending={term && (searching || searchQuery.isPlaceholderData) ? 'query' : undefined}
        >
            <h1 className="visually-hidden">{isZh ? '搜索商品' : 'Search products'}</h1>
            <div className="search-desktop-intro">
                <span>{isZh ? '站内探索' : 'Explore the store'}</span>
                <h2>{isZh ? '想找什么？' : 'What are you looking for?'}</h2>
                <p>
                    {isZh
                        ? '输入商品关键词，或从下方常用入口开始浏览。'
                        : 'Search for a product or start with a shortcut below.'}
                </p>
            </div>
            <header className="search-header">
                <button type="button" onClick={goBack} aria-label={isZh ? '返回' : 'Back'}>
                    <ArrowLeft />
                </button>
                <label>
                    <Search />
                    <input
                        autoFocus
                        type="search"
                        autoComplete="off"
                        value={query}
                        onChange={event => {
                            const next = event.target.value;
                            setQuery(next);
                            if (!next && submittedQuery) {
                                setSubmittedQuery('');
                                void navigate({
                                    ...routeNavigateOptions({ name: 'search' }),
                                    replace: true,
                                } as never);
                            }
                        }}
                        onKeyDown={event => {
                            if (!isInputMethodKey(event.nativeEvent) && event.key === 'Enter') submit();
                        }}
                        placeholder={isZh ? '搜索商品、分类' : 'Search products'}
                    />
                </label>
                <button className="search-submit" type="button" onClick={() => submit()}>
                    {isZh ? '搜索' : 'Search'}
                </button>
                {desktop && (
                    <button className="search-close" type="button" onClick={closeSearch}>
                        <X size={18} aria-hidden="true" />
                        <span>{isZh ? '关闭搜索' : 'Close search'}</span>
                    </button>
                )}
            </header>
            {!submittedQuery ? (
                <div className="search-discovery">
                    <section className="search-recent">
                        <header>
                            <strong>{isZh ? '最近搜索' : 'Recent searches'}</strong>
                            {history.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHistory([]);
                                        if (searchHistoryStorageKey) {
                                            try {
                                                localStorage.removeItem(searchHistoryStorageKey);
                                            } catch {
                                                // Clearing the in-memory history still works in restricted browsers.
                                            }
                                        }
                                    }}
                                    aria-label={isZh ? '清空' : 'Clear'}
                                >
                                    <Trash2 />
                                </button>
                            )}
                        </header>
                        <div className="search-tags">
                            {history.length ? (
                                history.map(item => (
                                    <button type="button" key={item} onClick={() => submit(item)}>
                                        {item}
                                    </button>
                                ))
                            ) : (
                                <small>{isZh ? '暂无搜索记录' : 'No recent searches'}</small>
                            )}
                        </div>
                    </section>
                    {!!popularSearches.length && (
                        <section className="popular-searches">
                            <header>
                                <strong>
                                    {desktop
                                        ? isZh
                                            ? '你可能在找'
                                            : 'Discover products'
                                        : isZh
                                          ? '热门搜索'
                                          : 'Popular searches'}
                                </strong>
                                <span>
                                    {desktop
                                        ? isZh
                                            ? '店内商品'
                                            : 'From this store'
                                        : isZh
                                          ? '店内常看商品'
                                          : 'Popular in this store'}
                                </span>
                            </header>
                            <ol>
                                {popularSearches.map((product, index) => (
                                    <li key={product.id}>
                                        <button type="button" onClick={() => submit(product.name)}>
                                            <b>{index + 1}</b>
                                            <span>{product.name}</span>
                                            {!desktop && index === 0 && <em>{isZh ? '热' : 'Hot'}</em>}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                    {desktop ? (
                        <section className="search-browse">
                            <header>
                                <strong>{isZh ? '全部分类' : 'Categories'}</strong>
                            </header>
                            <nav
                                className="search-category-links"
                                aria-label={isZh ? '搜索分类' : 'Browse categories'}
                            >
                                {collections.map(collection => (
                                    <button
                                        key={collection.id}
                                        type="button"
                                        onClick={() =>
                                            navigateTo({ name: 'category', collectionId: collection.id })
                                        }
                                    >
                                        {collection.name}
                                    </button>
                                ))}
                                {!collections.length && (
                                    <button type="button" onClick={() => navigateTo({ name: 'category' })}>
                                        {isZh ? '浏览全部商品' : 'Browse all products'}
                                    </button>
                                )}
                            </nav>
                            <header>
                                <strong>{isZh ? '常用服务' : 'Services'}</strong>
                            </header>
                            <nav
                                className="search-category-links"
                                aria-label={isZh ? '常用服务' : 'Services'}
                            >
                                <button type="button" onClick={() => navigateTo({ name: 'services' })}>
                                    {isZh ? '商业服务' : 'Business services'}
                                </button>
                                <button type="button" onClick={() => navigateTo({ name: 'support' })}>
                                    {isZh ? '客服与帮助' : 'Help and support'}
                                </button>
                                <button type="button" onClick={() => navigateTo({ name: 'coupons' })}>
                                    {isZh ? '优惠券' : 'Coupons'}
                                </button>
                            </nav>
                        </section>
                    ) : (
                        <section className="search-browse">
                            <header>
                                <strong>{isZh ? '按场景发现' : 'Browse by need'}</strong>
                                <span>{isZh ? '快速进入常用入口' : 'Quick store shortcuts'}</span>
                            </header>
                            <div className="discovery-grid">
                                <button type="button" onClick={() => navigateTo({ name: 'category' })}>
                                    <LayoutGrid />
                                    <span>{isZh ? '全部商品' : 'All products'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        submit(
                                            products.find(product =>
                                                product.variants.some(
                                                    variant =>
                                                        variant.customFields.fulfillmentType === 'physical',
                                                ),
                                            )?.name ??
                                                products[0]?.name ??
                                                '',
                                        )
                                    }
                                >
                                    <ShoppingBag />
                                    <span>{isZh ? '现货商品' : 'Physical'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        submit(
                                            products.find(product =>
                                                product.variants.some(
                                                    variant =>
                                                        variant.customFields.fulfillmentType === 'digital',
                                                ),
                                            )?.name ??
                                                products.at(-1)?.name ??
                                                '',
                                        )
                                    }
                                >
                                    <Download />
                                    <span>{isZh ? '数字内容' : 'Digital'}</span>
                                </button>
                            </div>
                        </section>
                    )}
                    {!!products.length && (
                        <ProductSection
                            title={isZh ? '今日推荐' : "Today's picks"}
                            subtitle={isZh ? '从店内在售商品开始' : 'Available from this store'}
                            products={products.slice(0, desktop ? 6 : 2)}
                            market={market}
                            locale={locale}
                            language={language}
                            onProduct={product => navigateTo({ name: 'product', id: product.id })}
                        />
                    )}
                </div>
            ) : (
                <section className="search-results">
                    {desktop && (
                        <aside
                            className="search-results-sidebar"
                            aria-label={isZh ? '搜索发现' : 'Search discovery'}
                        >
                            <h2 className="section-header-title-row">
                                <SectionIcon kind="history" />
                                {isZh ? '最近搜索' : 'Recent searches'}
                            </h2>
                            {history.length ? (
                                <div className="search-results-recent">
                                    {history.map(item => (
                                        <button key={item} type="button" onClick={() => submit(item)}>
                                            {item}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p>{isZh ? '暂无搜索记录' : 'No recent searches'}</p>
                            )}
                            <h2 className="section-header-title-row">
                                <SectionIcon kind="categories" />
                                {isZh ? '全部分类' : 'Categories'}
                            </h2>
                            <nav aria-label={isZh ? '商品分类' : 'Product categories'}>
                                {collections.map(collection => (
                                    <button
                                        key={collection.id}
                                        type="button"
                                        onClick={() =>
                                            navigateTo({ name: 'category', collectionId: collection.id })
                                        }
                                    >
                                        {collection.name}
                                    </button>
                                ))}
                            </nav>
                            <h2 className="section-header-title-row">
                                <SectionIcon kind="services" />
                                {isZh ? '常用服务' : 'Services'}
                            </h2>
                            <nav aria-label={isZh ? '常用服务' : 'Services'}>
                                <button type="button" onClick={() => navigateTo({ name: 'services' })}>
                                    {isZh ? '商业服务' : 'Business services'}
                                </button>
                                <button type="button" onClick={() => navigateTo({ name: 'support' })}>
                                    {isZh ? '客服与帮助' : 'Help and support'}
                                </button>
                            </nav>
                        </aside>
                    )}
                    <header>
                        <strong>
                            {isZh ? `“${submittedQuery}”的结果` : `Results for “${submittedQuery}”`}
                        </strong>
                        <span>{searching ? (isZh ? '搜索中' : 'Searching') : totalItems}</span>
                    </header>
                    <nav className="search-sort" aria-label={isZh ? '搜索结果排序' : 'Search result sorting'}>
                        <button
                            type="button"
                            className={resultSort === 'recommended' ? 'is-active' : undefined}
                            onClick={() => setResultSort('recommended')}
                        >
                            {isZh ? '综合' : 'Recommended'}
                        </button>
                        <button
                            type="button"
                            className={resultSort === 'name' ? 'is-active' : undefined}
                            onClick={() => setResultSort('name')}
                        >
                            {isZh ? '名称' : 'Name'}
                        </button>
                        <button
                            type="button"
                            className={resultSort === 'price-asc' ? 'is-active' : undefined}
                            onClick={() => setResultSort('price-asc')}
                        >
                            {isZh ? '价格' : 'Price'}
                        </button>
                    </nav>
                    {searching ? (
                        <ListSkeleton label={isZh ? '正在搜索商品' : 'Searching products'} />
                    ) : searchError && !results.length ? (
                        <EmptyState
                            icon={<CircleAlert />}
                            title={isZh ? '搜索加载失败' : 'Search failed'}
                            detail={searchError}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void searchQuery.refetch()}
                        />
                    ) : results.length ? (
                        <div className="product-list">
                            {desktop ? (
                                <ProductSection
                                    products={results}
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
                                    <button type="button" onClick={() => void loadMore()}>
                                        {isZh ? '重试' : 'Retry'}
                                    </button>
                                </div>
                            )}
                            {results.length < totalItems && (
                                <button
                                    className="load-more-button search-load-more"
                                    type="button"
                                    disabled={loadingMore}
                                    onClick={() => void loadMore()}
                                >
                                    {loadingMore
                                        ? isZh
                                            ? '加载中'
                                            : 'Loading'
                                        : isZh
                                          ? `加载更多（剩余 ${totalItems - results.length} 件）`
                                          : `Load more (${totalItems - results.length} remaining)`}
                                </button>
                            )}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<Search />}
                            title={isZh ? '没有找到相关商品' : 'No matching products'}
                            detail={
                                isZh ? '换个关键词或查看全部分类' : 'Try another search or browse categories'
                            }
                            action={isZh ? '查看分类' : 'Browse categories'}
                            onAction={() => navigateTo({ name: 'category' })}
                        />
                    )}
                    {!searching && !!relatedProducts.length && (
                        <ProductSection
                            title={isZh ? '相关好物' : 'Related products'}
                            subtitle={isZh ? '换个方向继续看看' : 'Keep exploring'}
                            products={relatedProducts}
                            market={market}
                            locale={locale}
                            language={language}
                            onProduct={product => navigateTo({ name: 'product', id: product.id })}
                        />
                    )}
                </section>
            )}
        </main>
    );
}
