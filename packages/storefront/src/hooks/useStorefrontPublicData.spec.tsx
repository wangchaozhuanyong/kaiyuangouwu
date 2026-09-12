// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';

import { useStorefrontPublicData } from './useStorefrontPublicData';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps guest and signed-in copy separate and hides cached products after logout', async () => {
    let signedIn = false;
    const content = { blocks: [], flashSales: [], systemAnnouncements: [], settings: {} };
    const api = {
        storefrontConfig: vi.fn(() =>
            Promise.resolve({
                description: signedIn ? 'Private sales copy' : 'Public identity',
            }),
        ),
        storefrontContent: vi.fn(() => Promise.resolve(content)),
        storefrontAccountContent: vi.fn(() => Promise.resolve(content)),
        products: vi.fn(() => Promise.resolve([{ id: '1', name: 'Private catalog item' }])),
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
            catalogAccessGranted: authorized,
        });
        return (
            <div>
                {data.configQuery.data?.description}
                {data.products.map(product => product.name).join(',')}
            </div>
        );
    }
    async function render(authorized: boolean, expected: string) {
        signedIn = authorized;
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
        await render(false, 'Public identity');
        expect(api.products).not.toHaveBeenCalled();
        await render(true, 'Private sales copy');
        expect(element.textContent).toContain('Private catalog item');
        await render(false, 'Public identity');
        expect(element.textContent).not.toContain('Private');
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});
