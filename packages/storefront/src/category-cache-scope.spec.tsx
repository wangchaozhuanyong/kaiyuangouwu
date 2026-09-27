// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApiTimeoutError } from './api/helpers';
import { CategoryPage, categoryFilterActionLabel } from './pages/category-page';
import { storefrontQueryKeys } from './query-client';
import { CategoryPageContext } from './storefront-page-contexts';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', async original => ({
    ...(await original<any>()),
    useNavigate: () => navigate,
}));
vi.mock('./components/common/product-row', () => ({ ProductRow: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('shows a trusted catalog count or a count-free apply action', () => {
    expect(categoryFilterActionLabel('zh', 1)).toBe('查看 1 件商品');
    expect(categoryFilterActionLabel('en', 1)).toBe('View 1 product');
    expect(categoryFilterActionLabel('en', 2)).toBe('View 2 products');
    expect(categoryFilterActionLabel('en', null)).toBe('Apply filters');
});

it.each([
    { language: 'zh', name: '马来西亚特色食品与日常生活用品' },
    { language: 'en', name: 'Everyday essentials and travel accessories' },
])('queries the complete catalog and preserves the $language category label', async ({ language, name }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    const root = createRoot(container);
    const api = { catalog: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }) };
    const noop = () => undefined;
    try {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <CategoryPageContext.Provider
                        value={
                            {
                                api,
                                products: [],
                                collections: [{ id: 'long-category', name, children: [] }],
                                contentBlocks: [],
                                loading: false,
                                error: null,
                                market: { code: 'my-malaysia', currencyCode: 'MYR' },
                                locale: 'en-MY',
                                language,
                                activeCollectionId: 'all',
                                activeChildId: 'all',
                                sortMode: 'recommended',
                                fulfillmentFilter: 'all',
                                inStockOnly: false,
                                minimumPrice: '',
                                maximumPrice: '',
                                onCollectionChange: noop,
                                onChildChange: noop,
                                onSortChange: noop,
                                onFilterChange: noop,
                                onNotify: noop,
                                onRetry: noop,
                            } as any
                        }
                    >
                        <CategoryPage />
                    </CategoryPageContext.Provider>
                </QueryClientProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(api.catalog).toHaveBeenCalled();
        expect(api.catalog.mock.calls[0][0]).toMatchObject({
            collectionId: undefined,
            sort: 'recommended',
        });
        expect(container.querySelectorAll('.primary-category-label')[0]?.textContent).toBe(name);
        expect(container.querySelectorAll('.primary-categories button')).toHaveLength(1);
        const trigger = container.querySelector<HTMLButtonElement>('.primary-categories-all');
        if (!trigger) throw new Error('Missing category dropdown trigger');
        act(() => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('.all-primary-category-grid')?.textContent).toContain(name);
        // The expanded grid replaces the compact navigation visually and for keyboard users.
        const strip = container.querySelector('.primary-category-strip');
        expect(strip?.getAttribute('aria-hidden')).toBe('true');
        expect(strip?.hasAttribute('inert')).toBe(true);
        expect(container.querySelectorAll('.all-primary-category-grid button')).toHaveLength(1);
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('.all-primary-category-grid')).toBeNull();
        expect(strip?.hasAttribute('aria-hidden')).toBe(false);
        expect(strip?.hasAttribute('inert')).toBe(false);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('uses the server catalog total in the filter confirmation action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    const root = createRoot(container);
    const product = {
        id: 'product-1',
        name: 'Product',
        slug: 'product',
        assets: [],
        featuredAsset: null,
        collections: [{ id: 'collection-1' }],
        customFields: {},
        variants: [{ id: 'variant-1', priceWithTax: 1000, currencyCode: 'MYR', customFields: {} }],
    };
    const api = { catalog: vi.fn().mockResolvedValue({ items: [product], totalItems: 1 }) };
    const noop = () => undefined;

    try {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <CategoryPageContext.Provider
                        value={
                            {
                                api,
                                products: [],
                                collections: [{ id: 'collection-1', name: 'Category', children: [] }],
                                contentBlocks: [],
                                loading: false,
                                error: null,
                                market: { code: 'my-malaysia', currencyCode: 'MYR' },
                                locale: 'en-MY',
                                language: 'en',
                                activeCollectionId: 'collection-1',
                                activeChildId: 'collection-1',
                                sortMode: 'sales',
                                fulfillmentFilter: 'physical',
                                inStockOnly: true,
                                minimumPrice: '10',
                                maximumPrice: '100',
                                onCollectionChange: noop,
                                onChildChange: noop,
                                onSortChange: noop,
                                onFilterChange: noop,
                                onNotify: noop,
                                onRetry: noop,
                            } as any
                        }
                    >
                        <CategoryPage />
                    </CategoryPageContext.Provider>
                </QueryClientProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        const allButton = container.querySelector<HTMLButtonElement>('.sort-bar button');
        if (!allButton) throw new Error('Missing All control');
        expect(allButton.textContent).toBe('All');
        act(() => allButton.click());
        expect(navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/category',
                search: expect.objectContaining({ collectionId: 'collection-1', childId: 'collection-1' }),
            }),
        );
        const search = navigate.mock.calls.at(-1)?.[0].search;
        expect(search.sort).toBe('recommended');
        expect(search.fulfillment).toBe('all');
        expect(search.inStockOnly).toBe(false);
        expect(search.minPrice).toBeUndefined();
        expect(search.maxPrice).toBeUndefined();
        const filterButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === 'Filter',
        );
        expect(filterButton).toBeDefined();
        void act(() => filterButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(document.body.textContent).toContain('View 1 product');
        expect(document.body.textContent).not.toContain('View 0 products');
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it.each(
    [
        { code: 'audit-store', currencyCode: 'MYR', language: 'zh', languageCode: 'zh_Hans' },
        { code: 'audit-store', currencyCode: 'CNY', language: 'en', languageCode: 'en' },
        { code: 'other-store', currencyCode: 'CNY', language: 'zh', languageCode: 'zh_Hans' },
    ].flatMap(scope =>
        ['pending', 'failure', 'no-collections', 'late-return'].map(outcome => ({ ...scope, outcome })),
    ),
)('keeps catalog summaries out of product-detail scopes: %j', async target => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 120000 } } });
    const root = createRoot(document.createElement('div'));
    const product = {
        id: 'product-1',
        name: '中文商品',
        slug: 'audit-product',
        assets: [],
        featuredAsset: null,
        collections: [{ id: 'collection-1' }],
        customFields: {},
        variants: [{ id: 'variant-1', priceWithTax: 10000, currencyCode: 'CNY', customFields: {} }],
    };
    let releaseLate: (value: unknown) => void = () => undefined;
    const latePage = new Promise(resolve => {
        releaseLate = resolve;
    });
    const api = {
        catalog: vi
            .fn()
            .mockResolvedValueOnce({ items: [product], totalItems: 1 })
            .mockImplementation(() =>
                target.outcome === 'failure'
                    ? Promise.reject(new ShopApiTimeoutError('Fresh context request timed out'))
                    : latePage,
            ),
    };
    const noop = () => undefined;
    const props: any = {
        api,
        products: [],
        collections: [{ id: 'collection-1', name: '分类', children: [] }],
        contentBlocks: [],
        loading: false,
        error: null,
        market: { code: 'audit-store', currencyCode: 'CNY' },
        locale: 'zh-CN',
        language: 'zh',
        activeCollectionId: 'collection-1',
        activeChildId: 'collection-1',
        sortMode: 'recommended',
        fulfillmentFilter: 'all',
        inStockOnly: false,
        minimumPrice: '',
        maximumPrice: '',
        onCollectionChange: noop,
        onChildChange: noop,
        onSortChange: noop,
        onFilterChange: noop,
        onNotify: noop,
        onRetry: noop,
    };
    const render = () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <CategoryPageContext.Provider value={props}>
                    <CategoryPage />
                </CategoryPageContext.Provider>
            </QueryClientProvider>,
        );
    const cnyKey = storefrontQueryKeys.product('audit-store:CNY', 'zh_Hans', 'product-1');
    const myrKey = storefrontQueryKeys.product(
        `${target.code}:${target.currencyCode}`,
        target.languageCode,
        'product-1',
    );
    try {
        await act(async () => {
            await Promise.resolve(render());
        });
        for (let attempt = 0; attempt < 20 && api.catalog.mock.calls.length < 1; attempt++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });
        }
        expect(queryClient.getQueryData(cnyKey)).toBeUndefined();
        expect(queryClient.getQueryData(myrKey)).toBeUndefined();
        props.market = { code: target.code, currencyCode: target.currencyCode };
        props.language = target.language;
        if (target.outcome === 'no-collections') {
            props.collections = [];
            props.products = [product];
        }
        await act(async () => {
            await Promise.resolve(render());
        });
        expect(api.catalog).toHaveBeenCalledTimes(2);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 30));
        });
        expect(queryClient.getQueryData(myrKey)).toBeUndefined();
        if (target.outcome === 'late-return') {
            props.market = { code: 'audit-store', currencyCode: 'CNY' };
            props.language = 'zh';
            await act(async () => {
                await Promise.resolve(render());
            });
            await act(async () => {
                await Promise.resolve(
                    releaseLate({ items: [{ ...product, name: 'Late target response' }], totalItems: 1 }),
                );
            });
            expect(queryClient.getQueryData(cnyKey)).toBeUndefined();
            expect(queryClient.getQueryData(myrKey)).toBeUndefined();
        }
        const correctDetailRequest = vi.fn(() =>
            Promise.resolve({
                ...product,
                variants: [{ currencyCode: target.currencyCode, priceWithTax: 6500 }],
            }),
        );
        const detail = await queryClient.fetchQuery({
            queryKey: myrKey,
            queryFn: correctDetailRequest,
            staleTime: 60000,
        });
        expect(correctDetailRequest).toHaveBeenCalledOnce();
        expect((detail as any).variants[0].currencyCode).toBe(target.currencyCode);
    } finally {
        act(() => root.unmount());
        queryClient.clear();
    }
});
