// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopApi } from '../api';
import type { CustomerProductActivity } from '../types';

import { enabledMarkets } from '../i18n';

import { useCustomerProductActivity } from './useCustomerProductActivity';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const empty: CustomerProductActivity = { favoriteProductIds: [], recentProductVisits: [] };

describe('account product activity', () => {
    let client: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let customerId: string | null;
    let result: ReturnType<typeof useCustomerProductActivity>;
    const load = vi.fn();
    const setFavoriteProduct = vi.fn();
    const api = {
        contentReviewsApi: { myCustomerProductActivity: load, setFavoriteProduct },
    } as unknown as ShopApi;

    function Harness() {
        result = useCustomerProductActivity({
            api,
            market: enabledMarkets[0],
            language: 'zh',
            customerId,
            storefrontCode: 'account-test',
            guestFavoriteProductIds: [],
            guestRecentProductIds: [],
            setGuestFavoriteProductIds: vi.fn(),
            setGuestRecentProductIds: vi.fn(),
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
        localStorage.clear();
        load.mockReset();
        setFavoriteProduct.mockReset();
        customerId = 'customer-a';
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        localStorage.clear();
    });

    it('shows no previous account data while a different account loads', async () => {
        let resolveSecond: (value: CustomerProductActivity) => void = () => undefined;
        load.mockResolvedValueOnce({ favoriteProductIds: ['product-a'], recentProductVisits: [] });
        load.mockImplementationOnce(
            () =>
                new Promise<CustomerProductActivity>(resolve => {
                    resolveSecond = resolve;
                }),
        );
        await render();
        await vi.waitFor(() => expect(result.favoriteProductIds).toEqual(['product-a']));
        customerId = 'customer-b';
        await render();
        expect(result.favoriteProductIds).toEqual([]);
        expect(result.loading).toBe(true);
        await act(async () => {
            resolveSecond(empty);
            await Promise.resolve();
        });
        expect(result.favoriteProductIds).toEqual([]);
    });

    it('does not import a legacy store-scoped list into a logged-out guest', async () => {
        localStorage.setItem('storefront-favorite-product-ids:account-test', '["previous-account"]');
        customerId = null;
        await render();
        expect(result.favoriteProductIds).toEqual([]);
        expect(load).not.toHaveBeenCalled();
    });

    it('does not write a favorite into the next account after a delayed ownership read', async () => {
        load.mockResolvedValue(empty);
        await render();
        await vi.waitFor(() => expect(result.loading).toBe(false));
        let resolveRead: (value: CustomerProductActivity) => void = () => undefined;
        const pending = new Promise<CustomerProductActivity>(resolve => {
            resolveRead = resolve;
        });
        const ensureSpy = vi.spyOn(client, 'ensureQueryData').mockReturnValueOnce(pending);

        const action = result.toggleFavoriteProduct('product-a');
        await vi.waitFor(() => expect(ensureSpy).toHaveBeenCalled());
        customerId = 'customer-b';
        await render();
        await act(async () => {
            resolveRead(empty);
            await action;
        });

        expect(setFavoriteProduct).not.toHaveBeenCalled();
        expect(result.favoriteProductIds).toEqual([]);
    });
});
