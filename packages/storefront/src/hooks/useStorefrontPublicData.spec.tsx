// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';

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
        await act(async () => vi.waitFor(() => expect(element.textContent).toContain(expected)));
    }
    try {
        await render(false, 'Published product');
        expect(element.textContent).toContain('Waiting for hero metadata');
        await act(async () => {
            finishContent();
            await pendingContent;
        });
        await act(async () => vi.waitFor(() => expect(element.textContent).toContain('Ready')));
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
