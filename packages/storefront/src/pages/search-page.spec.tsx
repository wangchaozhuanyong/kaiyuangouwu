// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { CatalogPaginationError } from '../catalog-pagination';
import { enabledMarkets } from '../i18n';
import { PageReadinessBoundary } from '../page-readiness';
import { storefrontQueryKeys } from '../query-client';
import { registerStorefrontNavigationHistory } from '../storefront-navigation-history';
import { SearchPageContext } from '../storefront-page-contexts';
import { Product } from '../types';

import { SearchPage, type EmbeddedSearchControl, type SearchPageProps } from './search-page';
(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;
function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected test element');
    return value;
}
const navigate = vi.hoisted(() => vi.fn());
const historyRef = vi.hoisted(() => ({ current: null as ReturnType<typeof createMemoryHistory> | null }));
const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => viewport.desktop }));
vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
    return {
        ...actual,
        useNavigate: () => navigate,
        useRouter: () => ({ history: required(historyRef.current), navigate }),
    };
});
describe('search result and product-detail cache separation', () => {
    const market = enabledMarkets[0];
    const product: Product = {
        id: 'coffee',
        createdAt: '2026-09-07T00:00:00.000Z',
        name: 'Coffee',
        slug: 'coffee',
        description: 'Search summary',
        featuredAsset: null,
        assets: [],
        collections: [],
        variants: [],
    };
    const productKey = storefrontQueryKeys.product(storefrontQueryKeys.market(market), 'en', product.id);
    const searchKey = storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), 'en', {
        term: 'coffee',
        sort: 'recommended',
    });
    let client: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let container: HTMLDivElement;
    function render() {
        void act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <SearchPageContext.Provider
                        value={{
                            api: new ShopApi(market, 'en'),
                            products: [],
                            market,
                            locale: 'en-MY',
                            language: 'en',
                            storefrontCode: market.code,
                            initialQuery: 'coffee',
                        }}
                    >
                        <SearchPage />
                    </SearchPageContext.Provider>
                </QueryClientProvider>,
            ),
        );
    }
    function renderDiscovery(
        overrides: Partial<SearchPageProps> = {},
        withReadiness = false,
        embedded?: EmbeddedSearchControl,
    ) {
        const content = (
            <QueryClientProvider client={client}>
                <SearchPageContext.Provider
                    value={{
                        api: {
                            catalog: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
                        } as unknown as ShopApi,
                        products: [product],
                        market,
                        locale: 'en-MY',
                        language: 'en',
                        storefrontCode: market.code,
                        initialQuery: '',
                        ...overrides,
                    }}
                >
                    <SearchPage embedded={embedded} />
                </SearchPageContext.Provider>
            </QueryClientProvider>
        );
        void act(() =>
            root.render(
                withReadiness ? (
                    <PageReadinessBoundary
                        pending={false}
                        online={onlineManager.isOnline()}
                        language="en"
                        navigationKey="search"
                        onRetry={navigate}
                        onBack={navigate}
                    >
                        {content}
                    </PageReadinessBoundary>
                ) : (
                    content
                ),
            ),
        );
    }
    function typeTerm(value: string) {
        const input = required(container.querySelector<HTMLInputElement>('.search-header input'));
        void act(() => {
            setNativeInputValue(input, value);
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        return input;
    }
    async function debounce() {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 280));
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
    it.each(['zh', 'en'] as const)('names the current and next price direction accessibly: %s', language => {
        renderDiscovery({ initialQuery: 'coffee', language });
        const price = required(container.querySelectorAll<HTMLButtonElement>('.search-sort button')[2]);
        expect(price.getAttribute('aria-pressed')).toBe('false');
        expect(price.getAttribute('aria-label')).toBe(
            language === 'zh' ? '价格排序，点击按从低到高排列' : 'Sort by price. Click for low to high',
        );
        act(() => price.click());
        expect(price.getAttribute('aria-label')).toBe(
            language === 'zh'
                ? '价格从低到高，点击改为从高到低'
                : 'Price: low to high. Click for high to low',
        );
        expect(price.getAttribute('aria-pressed')).toBe('true');
        expect(price.querySelector('[aria-hidden="true"]')?.textContent).toContain('↑');
        expect(navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ search: expect.objectContaining({ sort: 'price-asc' }) }),
        );
        act(() => price.click());
        expect(price.getAttribute('aria-label')).toBe(
            language === 'zh'
                ? '价格从高到低，点击改为从低到高'
                : 'Price: high to low. Click for low to high',
        );
        expect(price.querySelector('[aria-hidden="true"]')?.textContent).toContain('↓');
        expect(navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ search: expect.objectContaining({ sort: 'price-desc' }) }),
        );
    });

    it('renders managed category thumbnails through the shared decoded-image component', () => {
        renderDiscovery({
            collections: [
                {
                    id: 'category-root',
                    name: 'Category',
                    slug: 'category',
                    description: '',
                    position: 0,
                    parentId: '',
                    featuredAsset: { id: 'category-image', preview: '/assets/preview/category.png' },
                },
            ],
        });

        const frame = required(container.querySelector('.search-category-links .safe-image-frame'));
        const image = required(frame.querySelector('img'));
        expect(frame.getAttribute('data-safe-image')).toBe('loading');
        expect(image.getAttribute('loading')).toBe('lazy');
        expect(image.getAttribute('src')).toContain('preset=storefront-icon-96');
        expect(image.getAttribute('src')).toContain('format=webp');
        expect(image.getAttribute('srcset')).toContain('storefront-icon-64');
    });

    it('debounces suggestions, keeps result caches separate, and supports keyboard selection', async () => {
        const suggested = { ...product, name: 'Coffee beans' };
        const catalog = vi.fn().mockResolvedValue({ items: [suggested], totalItems: 1 });
        renderDiscovery({ api: { catalog } as unknown as ShopApi });
        const input = typeTerm('cof');
        expect(catalog).not.toHaveBeenCalled();
        await debounce();
        expect(catalog).toHaveBeenCalledWith(
            expect.objectContaining({ term: 'cof', take: 5 }),
            expect.anything(),
        );
        expect(client.getQueryData(searchKey)).toEqual({
            pages: [{ items: [product], totalItems: 1 }],
            pageParams: [0],
        });
        expect(client.getQueryData(productKey)).toBeUndefined();
        expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Coffee beans');
        void act(() =>
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
        );
        void act(() =>
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
        );
        expect(
            document.getElementById(required(input.getAttribute('aria-activedescendant')))?.textContent,
        ).toContain('Coffee beans');
        await act(async () => {
            await Promise.resolve();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(navigate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '/search',
                search: expect.objectContaining({ term: 'Coffee beans' }),
            }),
        );
    });
    it('cancels obsolete suggestion requests and never presents a stale response', async () => {
        let resolveOld: (value: { items: Product[]; totalItems: number }) => void = () => {
            throw new Error('Old request resolver not ready');
        };
        let oldSignal: AbortSignal | undefined;
        const catalog = vi.fn((input, signal) => {
            if (input.term === 'old') {
                oldSignal = signal;
                return new Promise(resolve => {
                    resolveOld = resolve;
                });
            }
            return Promise.resolve({ items: [{ ...product, name: 'New match' }], totalItems: 1 });
        });
        renderDiscovery({ api: { catalog } as unknown as ShopApi });
        typeTerm('old');
        await debounce();
        typeTerm('new');
        await debounce();
        expect(oldSignal?.aborted).toBe(true);
        await act(async () => {
            await Promise.resolve();
            resolveOld({ items: [{ ...product, name: 'Stale match' }], totalItems: 1 });
        });
        expect(container.querySelector('[role="listbox"]')?.textContent).toContain('New match');
        expect(container.querySelector('[role="listbox"]')?.textContent).not.toContain('Stale match');
    });
    it('waits for composition to finish before requesting suggestions', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({ api: { catalog } as unknown as ShopApi });
        const input = required(container.querySelector('input'));
        void act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
        typeTerm('中文');
        await debounce();
        expect(catalog).not.toHaveBeenCalled();
        void act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
        await debounce();
        expect(catalog).toHaveBeenCalledWith(
            expect.objectContaining({ term: '中文', take: 5 }),
            expect.anything(),
        );
        expect(navigate).not.toHaveBeenCalled();
    });
    it('restores URL filters, applies real catalog fields, and preserves them when sorting', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({
            api: { catalog } as unknown as ShopApi,
            initialQuery: 'cup',
            initialFilters: {
                collectionId: 'kitchen',
                inStockOnly: true,
                minPrice: '10',
                maxPrice: '50',
                fulfillment: 'physical',
                sort: 'price-desc',
            },
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(catalog).toHaveBeenCalledWith(
            expect.objectContaining({
                term: 'cup',
                collectionId: 'kitchen',
                inStockOnly: true,
                minPriceWithTax: 1000,
                maxPriceWithTax: 5000,
                fulfillmentType: 'physical',
                sort: 'price-desc',
            }),
            expect.anything(),
        );
        const nameSort = required(
            [...container.querySelectorAll<HTMLButtonElement>('.search-sort button')].find(
                button => button.textContent === 'Name',
            ),
        );
        await act(async () => {
            await Promise.resolve();
            nameSort.click();
        });
        expect(navigate).toHaveBeenCalledWith(
            expect.objectContaining({
                search: expect.objectContaining({
                    term: 'cup',
                    collectionId: 'kitchen',
                    inStockOnly: true,
                    minPrice: '10',
                    maxPrice: '50',
                    sort: 'name',
                }),
            }),
        );
        await act(async () => {
            await Promise.resolve();
            required(container.querySelector<HTMLButtonElement>('.search-filter-summary button')).click();
        });
        expect(catalog).toHaveBeenLastCalledWith(
            expect.objectContaining({
                term: 'cup',
                collectionId: undefined,
                inStockOnly: undefined,
                minPriceWithTax: undefined,
                maxPriceWithTax: undefined,
                sort: 'name',
            }),
            expect.anything(),
        );
    });
    it('applies the selected category and resets it with the other filter draft fields', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({
            api: { catalog } as unknown as ShopApi,
            initialQuery: 'cup',
            collections: [
                {
                    id: 'kitchen',
                    name: 'Kitchen',
                    slug: 'kitchen',
                    description: '',
                    parentId: 'root',
                    position: 0,
                    featuredAsset: null,
                },
            ],
        });
        void act(() =>
            required(container.querySelector<HTMLButtonElement>('.search-filter-trigger')).click(),
        );
        const select = required(
            document.querySelector<HTMLSelectElement>('.filter-collection-select select'),
        );
        void act(() => {
            select.value = 'kitchen';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            await Promise.resolve();
            required(document.querySelector<HTMLButtonElement>('.filter-confirm-button')).click();
        });
        expect(navigate).toHaveBeenCalledWith(
            expect.objectContaining({
                search: expect.objectContaining({ term: 'cup', collectionId: 'kitchen' }),
            }),
        );
        expect(catalog).toHaveBeenLastCalledWith(
            expect.objectContaining({ term: 'cup', collectionId: 'kitchen' }),
            expect.anything(),
        );
        void act(() =>
            required(container.querySelector<HTMLButtonElement>('.search-filter-trigger')).click(),
        );
        void act(() => required(document.querySelector<HTMLButtonElement>('.reset-filter-button')).click());
        expect(
            required(document.querySelector<HTMLSelectElement>('.filter-collection-select select')).value,
        ).toBe('all');
    });
    it('undoes history clearing without touching another account', () => {
        const guestKey = 'storefront-search-history:' + market.code + ':guest';
        const otherKey = 'storefront-search-history:' + market.code + ':customer:other';
        localStorage.setItem(guestKey, JSON.stringify(['coffee', 'tea']));
        localStorage.setItem(otherKey, JSON.stringify(['private']));
        renderDiscovery();
        void act(() =>
            required(
                container.querySelector<HTMLButtonElement>('.search-recent button[aria-label="Clear"]'),
            ).click(),
        );
        expect(localStorage.getItem(guestKey)).toBeNull();
        const undo = required(
            [...container.querySelectorAll<HTMLButtonElement>('.search-history-actions button')].find(
                button => button.textContent === 'Undo clear',
            ),
        );
        void act(() => undo.click());
        expect(JSON.parse(required(localStorage.getItem(guestKey)))).toEqual(['coffee', 'tea']);
        expect(JSON.parse(required(localStorage.getItem(otherKey)))).toEqual(['private']);
    });
    it('does not label an unavailable search as zero results', async () => {
        renderDiscovery({
            initialQuery: 'unavailable',
            api: { catalog: vi.fn().mockRejectedValue(new Error('Request failed')) } as unknown as ShopApi,
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(container.querySelector('.search-results-heading')?.textContent).toContain('Unavailable');
        expect(container.querySelector('.search-results-heading')?.textContent).not.toContain('0 items');
        expect(container.querySelector('.search-empty')).toBeNull();
    });
    it('shows an offline recovery state instead of a skeleton for an uncached search', async () => {
        onlineManager.setOnline(false);
        const catalog = vi.fn();
        renderDiscovery({ initialQuery: 'uncached', api: { catalog } as unknown as ShopApi }, true);
        await act(async () => {
            await Promise.resolve();
        });
        expect(container.querySelector('.list-skeleton')).toBeNull();
        expect(container.textContent).toContain('Search unavailable');
        expect(container.textContent).toContain('offline');
        expect(catalog).not.toHaveBeenCalled();
        expect(container.querySelector('.page-readiness-overlay')).toBeNull();
    });
    it('replaces a timed-out search with a new read and ignores the abandoned late result', async () => {
        vi.useFakeTimers();
        let resolveRead!: (value: { items: Product[]; totalItems: number }) => void;
        const catalog = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<{ items: Product[]; totalItems: number }>(resolve => {
                        resolveRead = resolve;
                    }),
            )
            .mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({ initialQuery: 'slow', api: { catalog } as unknown as ShopApi }, true);
        const sorting = container.querySelector('.search-sort');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_001);
        });
        expect(container.querySelector('.search-results .page-readiness-inline-error')).not.toBeNull();
        expect(container.querySelector('.list-skeleton')).toBeNull();
        expect(container.querySelector('.page-readiness-overlay')).toBeNull();
        act(() =>
            required(
                container.querySelector<HTMLButtonElement>('.search-results .page-readiness-error button'),
            ).click(),
        );
        expect(navigate).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(catalog).toHaveBeenCalledTimes(2);
        expect(container.querySelector('.search-empty')).not.toBeNull();
        await act(async () => {
            resolveRead({ items: [{ ...product, name: 'Abandoned search result' }], totalItems: 1 });
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(container.querySelector('.search-sort')).toBe(sorting);
        expect(container.querySelector('.search-empty')).not.toBeNull();
        expect(container.querySelector('.list-skeleton')).toBeNull();
        expect(container.textContent).not.toContain('Abandoned search result');
    });
    it('gives a new embedded search its own deadline after the previous term timed out', async () => {
        vi.useFakeTimers();
        const catalog = vi.fn(() => new Promise(() => undefined));
        const embedded: EmbeddedSearchControl = {
            query: 'old',
            submittedQuery: 'old',
            submission: 0,
            active: true,
            composing: false,
            inputRef: { current: null },
            keyDownRef: { current: null },
            setQuery: vi.fn(),
            setSubmittedQuery: vi.fn(),
            close: vi.fn(),
        };
        renderDiscovery({ api: { catalog } as unknown as ShopApi }, true, embedded);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_001);
        });
        expect(container.querySelector('.page-readiness-inline-error')).not.toBeNull();
        renderDiscovery({ api: { catalog } as unknown as ShopApi }, true, {
            ...embedded,
            query: 'new',
            submittedQuery: 'new',
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(container.querySelector('.page-readiness-inline-error')).toBeNull();
        expect(container.querySelector('.list-skeleton')).not.toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_998);
        });
        expect(container.querySelector('.page-readiness-inline-error')).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2);
        });
        expect(container.querySelector('.page-readiness-inline-error')).not.toBeNull();
    });
    it('reads the URL page offset on a cold search', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({
            initialQuery: 'paged',
            initialFilters: { page: 2 },
            api: { catalog } as unknown as ShopApi,
        });
        await vi.waitFor(() => expect(catalog).toHaveBeenCalled());
        expect(catalog.mock.calls[0][0].skip).toBe(12);
    });
    it.each(['sort', 'keyword'])('resets the URL page when changing the %s', async action => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        renderDiscovery({
            initialQuery: 'paged',
            initialFilters: { page: 2 },
            api: { catalog } as unknown as ShopApi,
        });
        if (action === 'sort') {
            act(() =>
                required(container.querySelectorAll<HTMLButtonElement>('.search-sort button')[1]).click(),
            );
        } else {
            const input = typeTerm('new term');
            await act(() =>
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
            );
        }
        expect(navigate.mock.calls.at(-1)?.[0].search.page).toBeUndefined();
        await vi.waitFor(() => expect(catalog.mock.calls.at(-1)?.[0].skip).toBe(0));
    });
    it('removes load more when the final response reports a smaller result total', async () => {
        const first = Array.from({ length: 12 }, (_, index) => ({ ...product, id: `first-${index}` }));
        client.setQueryData(searchKey, { pages: [{ items: first, totalItems: 24 }], pageParams: [0] });
        const catalog = vi.fn().mockResolvedValue({
            items: Array.from({ length: 3 }, (_, index) => ({ ...product, id: `last-${index}` })),
            totalItems: 15,
        });
        renderDiscovery({ initialQuery: 'coffee', api: { catalog } as unknown as ShopApi });
        await act(async () => {
            required(container.querySelector<HTMLButtonElement>('.search-load-more')).click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(container.querySelector('.search-load-more')).toBeNull();
        expect(container.querySelector('.search-results-heading')?.textContent).toContain('15 items');
    });
    it.each(['slow', 'offline'])('preserves results with local recovery for a %s append', async mode => {
        vi.useFakeTimers();
        client.setQueryData(searchKey, { pages: [{ items: [product], totalItems: 2 }], pageParams: [0] });
        const readers: Array<(value: { items: Product[]; totalItems: number }) => void> = [];
        const catalog = vi.fn(
            () =>
                new Promise<{ items: Product[]; totalItems: number }>(resolve => {
                    readers.push(resolve);
                }),
        );
        renderDiscovery({ initialQuery: 'coffee', api: { catalog } as unknown as ShopApi }, true);
        const firstCard = container.querySelector('.product-card');
        if (mode === 'offline') onlineManager.setOnline(false);
        await act(async () => {
            required(container.querySelector<HTMLButtonElement>('.search-load-more')).click();
            await vi.advanceTimersByTimeAsync(mode === 'slow' ? 10_001 : 1);
        });
        const retry = container.querySelector<HTMLButtonElement>(
            '.search-load-error button, .search-results .page-readiness-error button',
        );
        expect(retry).not.toBeNull();
        expect(container.querySelector('.product-card')).toBe(firstCard);
        expect(container.querySelector('.page-readiness-overlay')).toBeNull();
        act(() => required(retry).click());
        expect(navigate).not.toHaveBeenCalled();
        await act(async () => {
            onlineManager.setOnline(true);
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(catalog).toHaveBeenCalledTimes(mode === 'slow' ? 2 : 1);
        await act(async () => {
            required(readers.at(-1))({ items: [{ ...product, id: 'second' }], totalItems: 2 });
            await vi.advanceTimersByTimeAsync(1);
        });
        if (mode === 'slow')
            await act(async () => {
                readers[0]({
                    items: [{ ...product, id: 'abandoned', name: 'Abandoned append' }],
                    totalItems: 2,
                });
                await vi.advanceTimersByTimeAsync(1);
            });
        expect(container.querySelectorAll('.product-card')).toHaveLength(2);
        expect(container.querySelector('.product-card')).toBe(firstCard);
        expect(container.textContent).not.toContain('Abandoned append');
    });
    it('keeps confirmed results and shows next-page failure in the pagination footer', async () => {
        const catalog = vi
            .fn()
            .mockRejectedValueOnce(new Error('Next page unavailable'))
            .mockResolvedValue({ items: [{ ...product, id: 'tea', name: 'Tea' }], totalItems: 2 });
        client.setQueryData(searchKey, { pages: [{ items: [product], totalItems: 2 }], pageParams: [0] });
        renderDiscovery({ initialQuery: 'coffee', api: { catalog } as unknown as ShopApi });
        await act(async () => {
            required(container.querySelector<HTMLButtonElement>('.search-load-more')).click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(container.textContent).toContain('Coffee');
        expect(container.querySelector('.search-load-error')?.textContent).toContain('Please try again');
        await act(async () => {
            required(container.querySelector<HTMLButtonElement>('.search-load-error button')).click();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(container.textContent).toContain('Coffee');
        expect(container.textContent).toContain('Tea');
        expect(container.querySelector('.search-load-error')).toBeNull();
    });
    it('shows a recoverable error instead of repeating offset zero for an empty page with remaining results', async () => {
        client.removeQueries({ queryKey: searchKey });
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 10 });
        renderDiscovery({ initialQuery: 'coffee', api: { catalog } as unknown as ShopApi });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(container.textContent).toContain('Search unavailable');
        expect(client.getQueryState(searchKey)?.error).toBeInstanceOf(CatalogPaginationError);
        expect(catalog).toHaveBeenCalledTimes(1);
    });
    beforeEach(() => {
        navigate.mockClear();
        historyRef.current = createMemoryHistory({ initialEntries: ['/search?term=coffee'] });
        viewport.desktop = false;
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(searchKey, {
            pages: [{ items: [product], totalItems: 1 }],
            pageParams: [0],
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        void act(() => root.unmount());
        onlineManager.setOnline(true);
        client.clear();
        vi.useRealTimers();
        container.remove();
        localStorage.clear();
    });
    it('preserves a newer detail response while the previous search page remains visible', () => {
        render();
        expect(client.getQueryData(productKey)).toBeUndefined();
        const detail = { ...product, description: 'Full detail loaded by the destination route' };
        client.setQueryData(productKey, detail);
        // A pending route or other parent update must not publish the old search payload again.
        render();
        render();
        expect(client.getQueryData(productKey)).toEqual(detail);
    });
    it('keeps newly received result pages out of the complete detail cache', async () => {
        render();
        const nextProduct = { ...product, id: 'tea', name: 'Tea' };
        await act(async () => {
            client.setQueryData(searchKey, {
                pages: [{ items: [product, nextProduct], totalItems: 2 }],
                pageParams: [0],
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(client.getQueryData(productKey)).toBeUndefined();
        expect(
            client.getQueryData(
                storefrontQueryKeys.product(storefrontQueryKeys.market(market), 'en', nextProduct.id),
            ),
        ).toBeUndefined();
        expect(container.textContent).toContain('Tea');
    });
    it('retains the search input, result link and action identity when desktop layout adopts', () => {
        render();
        const input = required(container.querySelector<HTMLInputElement>('.search-header input'));
        const result = required(
            container.querySelector<HTMLAnchorElement>(
                '.search-route-product-list .product-card-detail-link',
            ),
        );
        void act(() => input.focus());
        viewport.desktop = true;
        render();
        expect(container.querySelector('.search-header input')).toBe(input);
        expect(container.querySelector('.search-route-product-list .product-card-detail-link')).toBe(result);
        expect(document.activeElement).toBe(input);
        expect(container.querySelectorAll('.search-page')).toHaveLength(1);
        expect(container.querySelector('.home-page')).toBeNull();
        void act(() => result.click());
        expect(navigate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '/product',
                search: expect.objectContaining({ id: product.id }),
            }),
        );
    });
    it('closes a directly opened desktop search page to the home page', () => {
        viewport.desktop = true;
        render();
        const close = container.querySelector<HTMLButtonElement>('.search-close');
        expect(close?.textContent).toContain('Close search');
        void act(() => close?.click());
        expect(navigate).toHaveBeenCalledWith({ to: '/', search: {}, replace: true });
    });
    it('returns to the previous page when closing an entered desktop search', () => {
        viewport.desktop = true;
        const history = createMemoryHistory({ initialEntries: ['/category'] });
        historyRef.current = history;
        registerStorefrontNavigationHistory({ history, navigate });
        history.push('/search?term=coffee');
        const go = vi.spyOn(history, 'go');
        render();
        void act(() => container.querySelector<HTMLButtonElement>('.search-close')?.click());
        expect(go).toHaveBeenCalledExactlyOnceWith(-1);
        expect(history.location.pathname).toBe('/category');
        expect(navigate).not.toHaveBeenCalled();
    });
    it('closes desktop search with Escape while preserving an open dialog', async () => {
        viewport.desktop = true;
        render();
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.append(dialog);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await Promise.resolve();
        });
        expect(navigate).not.toHaveBeenCalled();
        dialog.remove();
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await Promise.resolve();
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/', search: {}, replace: true });
    });
    it('returns to discovery when the search term is cleared', () => {
        viewport.desktop = true;
        render();
        const input = container.querySelector<HTMLInputElement>('.search-header input');
        if (!input) throw new Error('Search input was not mounted');
        void act(() => {
            setNativeInputValue(input, '');
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/search', search: {}, replace: true });
        expect(container.querySelector('.search-discovery')).not.toBeNull();
    });
    it('shows and clears recent searches for only the current store and account', () => {
        const baseKey = `storefront-search-history:${market.code}`;
        localStorage.setItem(baseKey, JSON.stringify(['old shared search']));
        localStorage.setItem(`${baseKey}:customer:alice`, JSON.stringify(['alice search']));
        localStorage.setItem(`${baseKey}:customer:bob`, JSON.stringify(['bob search']));
        localStorage.setItem(`${baseKey}:guest`, JSON.stringify(['guest search']));
        const renderIdentity = (customerId?: string) => {
            void act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <SearchPageContext.Provider
                            value={{
                                api: new ShopApi(market, 'en'),
                                products: [],
                                market,
                                locale: 'en-MY',
                                language: 'en',
                                storefrontCode: market.code,
                                customerId,
                                initialQuery: '',
                            }}
                        >
                            <SearchPage key={customerId ?? 'guest'} />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
        };
        renderIdentity('alice');
        expect(container.textContent).toContain('alice search');
        expect(container.textContent).not.toContain('bob search');
        expect(container.textContent).not.toContain('old shared search');
        renderIdentity('bob');
        expect(container.textContent).toContain('bob search');
        expect(container.textContent).not.toContain('alice search');
        void act(() => {
            container.querySelector<HTMLButtonElement>('.search-recent button[aria-label="Clear"]')?.click();
        });
        expect(localStorage.getItem(`${baseKey}:customer:bob`)).toBeNull();
        expect(localStorage.getItem(`${baseKey}:customer:alice`)).not.toBeNull();
        expect(localStorage.getItem(baseKey)).not.toBeNull();
        renderIdentity();
        expect(container.textContent).toContain('guest search');
        expect(container.textContent).not.toContain('alice search');
    });
    it('keeps searching and clearing in-memory history when browser storage rejects writes', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage blocked', 'SecurityError');
        });
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Storage blocked', 'SecurityError');
        });
        try {
            void act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <SearchPageContext.Provider
                            value={{
                                api: {
                                    catalog: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
                                } as unknown as ShopApi,
                                products: [],
                                market,
                                locale: 'en-MY',
                                language: 'en',
                                storefrontCode: market.code,
                                customerId: 'alice',
                                initialQuery: '',
                            }}
                        >
                            <SearchPage />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
            const input = container.querySelector<HTMLInputElement>('.search-header input');
            if (!input) throw new Error('Search input was not mounted');
            void act(() => {
                setNativeInputValue(input, 'coffee');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            void act(() => {
                container.querySelector<HTMLButtonElement>('.search-submit')?.click();
            });
            expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/search' }));
            expect(setItem).toHaveBeenCalled();
            void act(() => {
                setNativeInputValue(input, '');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            expect(container.querySelector('.search-recent')?.textContent).toContain('coffee');
            void act(() => {
                container
                    .querySelector<HTMLButtonElement>('.search-recent button[aria-label="Clear"]')
                    ?.click();
            });
            expect(removeItem).toHaveBeenCalled();
            expect(container.querySelector('.search-recent')?.textContent).not.toContain('coffee');
        } finally {
            setItem.mockRestore();
            removeItem.mockRestore();
        }
    });
    it('does not submit unfinished Chinese text when Enter confirms an IME candidate', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        const storeHistory = vi.spyOn(Storage.prototype, 'setItem');
        try {
            void act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <SearchPageContext.Provider
                            value={{
                                api: { catalog } as unknown as ShopApi,
                                products: [],
                                market,
                                locale: 'zh-CN',
                                language: 'zh',
                                storefrontCode: market.code,
                                initialQuery: '',
                            }}
                        >
                            <SearchPage />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
            const input = container.querySelector('input');
            if (!input) throw new Error('Search input was not mounted');
            void act(() => {
                setNativeInputValue(input, '中华');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            for (const options of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
                void act(() => {
                    input.dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options }),
                    );
                });
                expect(navigate).not.toHaveBeenCalled();
                expect(catalog).not.toHaveBeenCalled();
                expect(storeHistory).not.toHaveBeenCalled();
            }
            await act(async () => {
                input.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13 }),
                );
                await Promise.resolve();
            });
            expect(navigate).toHaveBeenCalledTimes(1);
            expect(catalog).toHaveBeenCalledWith(
                expect.objectContaining({ term: '中华' }),
                expect.anything(),
            );
            expect(storeHistory).toHaveBeenCalledWith(expect.any(String), JSON.stringify(['中华']));
        } finally {
            storeHistory.mockRestore();
        }
    });
});
function setNativeInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Native input setter is unavailable');
    descriptor.set.call(input, value);
}
