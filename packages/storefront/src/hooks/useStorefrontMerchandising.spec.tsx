// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import type { RouteState } from '../storefront-router';

import { useStorefrontMerchandising } from './useStorefrontMerchandising';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('home merchandising request scope', () => {
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let route: RouteState['name'];
    let contentReady: boolean;
    const catalog = vi.fn((_input: { sort: string }) => Promise.resolve({ items: [], totalItems: 0 }));
    const api = { catalog, productSales: vi.fn(() => Promise.resolve({})) } as unknown as ShopApi;

    function Harness() {
        useStorefrontMerchandising({
            api,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: false,
            customer: null,
            recentProductIds: [],
            products: [],
            contentBlocks: [],
            configuredBlockTypes: [],
            activeRoute: route,
            contentReady,
        });
        return null;
    }

    async function render() {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
    }

    beforeEach(() => {
        catalog.mockClear();
        route = 'category';
        contentReady = false;
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
    });

    it('waits for homepage content and does not request home catalogs on other routes', async () => {
        contentReady = true;
        await render();
        expect(catalog).not.toHaveBeenCalled();

        route = 'home';
        contentReady = false;
        await render();
        expect(catalog).not.toHaveBeenCalled();

        contentReady = true;
        await render();
        await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
        expect(catalog.mock.calls.map(([input]) => input.sort).sort()).toEqual(['recommended', 'sales']);

        route = 'category';
        await render();
        expect(catalog).toHaveBeenCalledTimes(2);
    });

    it('loads recommendations without fetching home best sellers on the recommendations route', async () => {
        route = 'recommendations';
        contentReady = true;
        await render();
        await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(1));
        expect(catalog.mock.calls[0][0].sort).toBe('recommended');
    });
});
