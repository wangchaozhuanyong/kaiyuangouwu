// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL, storefrontQueryKeys } from '../query-client';

import { useStorefrontPublicData } from './useStorefrontPublicData';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('loads public content and products without a customer and preserves them across sign-in changes', async () => {
    const content = { blocks: [], flashSales: [], systemAnnouncements: [], settings: {} };
    let finishContent: () => void = () => {
        throw new Error('Content fixture is not initialized');
    };
    const pendingContent = new Promise<typeof content>(resolve => {
        finishContent = () => resolve(content);
    });
    const api = {
        storefrontConfig: vi.fn(() =>
            Promise.resolve({
                description: 'Public store',
            }),
        ),
        storefrontContent: vi.fn(() => pendingContent),
        storefrontAccountContent: vi.fn(() => Promise.resolve(content)),
        products: vi.fn(() => Promise.resolve([{ id: '1', name: 'Published product' }])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture({ authorized }: { authorized: boolean }) {
        const data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: authorized,
        });
        return (
            <div>
                {data.loading ? 'Waiting for hero metadata' : 'Ready'}
                {data.configQuery.data?.description}
                {data.products.map(product => product.name).join(',')}
            </div>
        );
    }
    async function render(authorized: boolean, expected: string) {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture authorized={authorized} />
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toContain(expected)));
    }
    try {
        await render(false, 'Published product');
        expect(element.textContent).toContain('Waiting for hero metadata');
        await act(async () => {
            finishContent();
            await pendingContent;
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toContain('Ready')));
        expect(api.products).toHaveBeenCalledTimes(1);
        expect(api.storefrontContent).toHaveBeenCalledTimes(1);
        expect(api.storefrontAccountContent).not.toHaveBeenCalled();
        expect(api.collections).toHaveBeenCalledTimes(1);
        expect(api.activeStoreCommerceMode).toHaveBeenCalledTimes(1);
        await render(true, 'Published product');
        await render(false, 'Published product');
        expect(element.textContent).toContain('Public store');
        expect(api.products).toHaveBeenCalledTimes(1);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

it('refreshes guest configuration and toggles without reloading and stops in the background', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    let published = false;
    let description = 'Old store branding';
    const api = {
        storefrontConfig: vi.fn(() => Promise.resolve({ description })),
        storefrontContent: vi.fn(() =>
            Promise.resolve({
                blocks: published ? [{ id: 'core', title: 'Published core cards' }] : [],
                flashSales: [],
                systemAnnouncements: [],
                settings: {},
            }),
        ),
        products: vi.fn(() => Promise.resolve([])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture() {
        const data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
        });
        return (
            <>
                {data.configQuery.data?.description}
                {data.contentBlocks.map(block => block.title).join(',')}
            </>
        );
    }
    async function advance(ms: number) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }
    try {
        act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture />
                </QueryClientProvider>,
            );
        });
        await advance(1);
        expect(element.textContent).toContain('Old store branding');
        published = true;
        description = 'New store branding';
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL);
        expect(element.textContent).toContain('Published core cards');
        expect(element.textContent).toContain('New store branding');
        published = false;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL);
        expect(element.textContent).not.toContain('Published core cards');
        expect(api.products).toHaveBeenCalledTimes(1);
        focusManager.setFocused(false);
        const count = api.storefrontContent.mock.calls.length;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL * 2);
        expect(api.storefrontContent).toHaveBeenCalledTimes(count);
        published = true;
        act(() => {
            focusManager.setFocused(true);
        });
        await advance(1);
        expect(element.textContent).toContain('Published core cards');
        act(() => root.unmount());
        const finalCount = api.storefrontContent.mock.calls.length;
        await advance(STOREFRONT_CONFIG_REFRESH_INTERVAL * 2);
        expect(api.storefrontContent).toHaveBeenCalledTimes(finalCount);
    } finally {
        client.clear();
        focusManager.setFocused(undefined);
        vi.useRealTimers();
    }
});

it('rechecks freshly restored content on mount and isolates the two stores', async () => {
    const marketA = enabledMarkets[0];
    const marketB = { ...marketA, code: 'moyao-audit' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [...storefrontQueryKeys.content(storefrontQueryKeys.market(marketA), 'zh_Hans'), 'public'];
    client.setQueryData(key, { blocks: [{ title: 'Cached stale core' }], settings: {} });
    const apiFor = (title: string) => ({
        storefrontConfig: vi.fn(() => Promise.resolve({})),
        storefrontContent: vi.fn(() =>
            Promise.resolve({
                blocks: [{ id: title, title }],
                flashSales: [],
                systemAnnouncements: [],
                settings: {},
            }),
        ),
        products: vi.fn(() => Promise.resolve([])),
        collections: vi.fn(() => Promise.resolve([])),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
    });
    const apiA = apiFor('Damatong core');
    const apiB = apiFor('Moyao core');
    const element = document.createElement('div');
    const root = createRoot(element);
    function Fixture({ store }: { store: 'a' | 'b' }) {
        const data = useStorefrontPublicData({
            api: (store === 'a' ? apiA : apiB) as unknown as ShopApi,
            market: store === 'a' ? marketA : marketB,
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
        });
        return <>{data.contentBlocks.map(block => block.title).join(',')}</>;
    }
    async function show(store: 'a' | 'b', text: string) {
        act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <Fixture store={store} />
                </QueryClientProvider>,
            );
        });
        await act(() => vi.waitFor(() => expect(element.textContent).toBe(text)));
    }
    try {
        await show('a', 'Damatong core');
        expect(apiA.storefrontContent).toHaveBeenCalledTimes(1);
        await show('b', 'Moyao core');
        expect(client.getQueryData<{ blocks: Array<{ title: string }> }>(key)?.blocks[0].title).toBe(
            'Damatong core',
        );
        await show('a', 'Damatong core');
        expect(apiB.storefrontContent).toHaveBeenCalledTimes(1);
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});
