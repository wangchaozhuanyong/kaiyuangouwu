// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApiTimeoutError } from './api/helpers';
import { CategoryPage, categoryFilterActionLabel } from './pages/category-page';
import { storefrontQueryKeys } from './query-client';
import { CategoryPageContext } from './storefront-page-contexts';

vi.mock('@tanstack/react-router', async original => ({
    ...(await original<any>()),
    useNavigate: () => () => undefined,
}));
vi.mock('./components/common/product-row', () => ({ ProductRow: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('shows a trusted catalog count or a count-free apply action', () => {
    expect(categoryFilterActionLabel('zh', 1)).toBe('查看 1 件商品');
    expect(categoryFilterActionLabel('en', 1)).toBe('View 1 product');
    expect(categoryFilterActionLabel('en', 2)).toBe('View 2 products');
    expect(categoryFilterActionLabel('en', null)).toBe('Apply filters');
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
        const filterButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === 'Filter',
        );
        expect(filterButton).toBeDefined();
        act(() => filterButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

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
        ['pending', 'failure', 'fallback', 'late-return'].map(outcome => ({ ...scope, outcome })),
    ),
)('keeps old products out of a new detail scope: %j', async target => {
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
        for (let attempt = 0; attempt < 20 && !queryClient.getQueryData(cnyKey); attempt++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });
        }
        expect(queryClient.getQueryData(cnyKey)).toEqual(product);
        expect(queryClient.getQueryData(myrKey)).toBeUndefined();
        props.market = { code: target.code, currencyCode: target.currencyCode };
        props.language = target.language;
        if (target.outcome === 'fallback') {
            props.collections = [];
            props.products = [product];
        }
        await act(async () => {
            await Promise.resolve(render());
        });
        expect(api.catalog).toHaveBeenCalledTimes(target.outcome === 'fallback' ? 1 : 2);
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
            expect(queryClient.getQueryData(cnyKey)).toEqual(product);
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
