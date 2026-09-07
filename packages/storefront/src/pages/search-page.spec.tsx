// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { SearchPageContext } from '../storefront-page-contexts';
import { Product } from '../types';

import { SearchPage } from './search-page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
}));

describe('search result cache publication', () => {
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
        act(() =>
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

    beforeEach(() => {
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
        act(() => root.unmount());
        client.clear();
        container.remove();
        localStorage.clear();
    });

    it('preserves a newer detail response while the previous search page remains visible', () => {
        render();
        expect(client.getQueryData(productKey)).toEqual(product);
        const detail = { ...product, description: 'Full detail loaded by the destination route' };
        client.setQueryData(productKey, detail);

        // A pending route or other parent update must not publish the old search payload again.
        render();
        render();
        expect(client.getQueryData(productKey)).toEqual(detail);
    });

    it('publishes newly received result pages', async () => {
        render();
        const nextProduct = { ...product, id: 'tea', name: 'Tea' };
        await act(async () => {
            client.setQueryData(searchKey, {
                pages: [{ items: [product, nextProduct], totalItems: 2 }],
                pageParams: [0],
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(
            client.getQueryData(
                storefrontQueryKeys.product(storefrontQueryKeys.market(market), 'en', nextProduct.id),
            ),
        ).toEqual(nextProduct);
    });
});
