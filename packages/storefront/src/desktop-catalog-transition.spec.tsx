// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogInputFromRoute } from './catalog-route-query';
import { DesktopCatalogPage } from './pages/desktop-catalog-page';
import { storefrontQueryKeys } from './query-client';
import { type RouteState } from './storefront-router';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';
import { type MarketConfig, type Product } from './types';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const market: MarketConfig = {
    code: 'synthetic',
    currencyCode: 'MYR',
    defaultLanguageCode: 'en',
    countryCode: 'MY',
    locale: 'en-MY',
    label: 'Synthetic Malaysia',
};
const product: Product = {
    id: 'retained-product',
    name: 'Retained catalog product',
    slug: 'retained-product',
    createdAt: '2026-01-01T00:00:00Z',
    description: 'Synthetic local fixture',
    assets: [],
    featuredAsset: null,
    collections: [],
    variants: [],
};
const collection = {
    id: 'category-a',
    name: 'Category A',
    slug: 'category-a',
    description: '',
    position: 0,
    parentId: 'root',
    featuredAsset: null,
    children: [],
};
let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let catalog: ReturnType<typeof vi.fn>;

async function render(route: RouteState) {
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <StorefrontContext.Provider
                    value={
                        {
                            route,
                            market,
                            language: 'en',
                            locale: 'en-MY',
                            collections: [collection],
                            contentBlocks: [],
                            storefrontName: 'Synthetic shop',
                            storefrontTagline: '',
                            storefrontContextResolved: true,
                            api: { catalog },
                            navigate: vi.fn(),
                            refetchStorefront: vi.fn(),
                        } as unknown as StorefrontContextValue
                    }
                >
                    <DesktopCatalogPage />
                </StorefrontContext.Provider>
            </QueryClientProvider>,
        );
        await Promise.resolve();
    });
}

beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
});
afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    environment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('desktop catalog during destination preparation', () => {
    it.each(['home', 'product'] as const)(
        'keeps the last catalog while leaving for %s without a replacement read',
        async name => {
            const initial: RouteState = { name: 'category', collectionId: collection.id };
            client.setQueryData(
                storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), 'en', {
                    ...catalogInputFromRoute(initial),
                    take: 12,
                }),
                { pages: [{ items: [product], totalItems: 1 }], pageParams: [0] },
            );
            await render(initial);
            const card = container.querySelector('.product-card');
            expect(card?.textContent).toContain(product.name);
            expect(container.querySelector('.desktop-category-entry a')?.getAttribute('aria-current')).toBe(
                'page',
            );
            await render({ name, id: name === 'product' ? product.id : undefined });
            expect(catalog).not.toHaveBeenCalled();
            expect(container.querySelector('.product-card')).toBe(card);
            expect(container.textContent).toContain(product.name);
            expect(container.querySelector('[data-page-pending]')).toBeNull();
            expect(container.querySelector('.desktop-category-entry a')?.getAttribute('aria-current')).toBe(
                'page',
            );
            const unrelated = storefrontQueryKeys.catalog(storefrontQueryKeys.market(market), 'en', {
                ...catalogInputFromRoute({ name }),
                take: 12,
            });
            expect(client.getQueryState(unrelated)).toBeUndefined();
        },
    );

    it('still reads an active search without requiring a collection', async () => {
        await render({ name: 'search', term: 'Token' });
        expect(catalog).toHaveBeenCalledTimes(1);
        expect(catalog).toHaveBeenCalledWith(
            expect.objectContaining({ term: 'Token', skip: 0, take: 12 }),
            expect.any(AbortSignal),
        );
    });

    it('waits for a resolved category before reading', async () => {
        await render({ name: 'category' });
        expect(catalog).not.toHaveBeenCalled();
        await render({ name: 'category', collectionId: collection.id });
        expect(catalog).toHaveBeenCalledTimes(1);
        expect(catalog).toHaveBeenCalledWith(
            expect.objectContaining({ collectionId: collection.id, skip: 0, take: 12 }),
            expect.any(AbortSignal),
        );
    });
});
