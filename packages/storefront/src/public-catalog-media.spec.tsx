// organize-imports-ignore
// @vitest-environment jsdom
import type { Product } from './types';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { mediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { publicCatalogRequest } from './catalog-route-query';
import { enabledMarkets } from './i18n';
import { usePublicCatalogMedia } from './public-catalog-media';
import { invalidatePublicPageReads } from './public-page-transport';
import { storefrontQueryKeys } from './query-client';
import { publicSeoQueryKey, seedPublicPage } from './storefront-page-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const market = enabledMarkets[0];
const source = '/assets/preview/late-catalog.webp?v=one';
const input = { sort: 'recommended' as const, take: 16 };
const mediaKey = publicSeoQueryKey(
    storefrontQueryKeys.market(market),
    'zh_Hans',
    publicCatalogRequest(input, '/category'),
    'public-media',
    [],
);

function fixture() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement('div');
    const root = createRoot(host);
    let products = [
        { id: 'selected', featuredAsset: { id: 'asset', preview: source }, variants: [] },
    ] as unknown as Product[];
    let active = true;
    let result: ReturnType<typeof usePublicCatalogMedia> | undefined;
    function Harness() {
        result = usePublicCatalogMedia({
            market,
            language: 'zh',
            catalogs: active ? [{ input, pathname: '/category', products }] : [],
        });
        return <output>{JSON.stringify(result.media.map(item => item.identity))}</output>;
    }
    const render = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            ),
        );
    render();
    function page() {
        const value = syntheticPage('synthetic-a', 'en', 'catalog');
        value.scope.channelCode = market.code;
        value.config.code = market.code;
        value.scope.languageCode = 'zh_Hans';
        value.scope.host = window.location.host;
        value.scope.currencyCode = market.currencyCode;
        value.collections = [];
        value.catalog = { items: products, totalItems: products.length };
        value.request = publicCatalogRequest(input, '/category');
        value.media = [mediaDescriptor(source, 'card')];
        return value;
    }
    return {
        client,
        host,
        page,
        render,
        get result() {
            if (!result) throw new Error('Missing media observer render');
            return result;
        },
        update(next: { products?: Product[]; active?: boolean }) {
            products = next.products ?? products;
            active = next.active ?? active;
            render();
        },
        dispose() {
            act(() => root.unmount());
            client.clear();
        },
    };
}

describe('current displayed catalog media borrowing', () => {
    it('never overwrites the existing active collection read owner, metadata or refresh function', async () => {
        const f = fixture();
        const queryKey = storefrontQueryKeys.collections(storefrontQueryKeys.market(market), 'zh_Hans');
        const queryFn = vi.fn(() => Promise.resolve([]));
        const meta = { publicAggregatePart: true, persistPublic: true };
        const owner = new QueryObserver(f.client, { queryKey, queryFn, meta, enabled: true });
        const stop = owner.subscribe(() => undefined);
        try {
            await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(f.client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
            f.render();
            await f.client.refetchQueries({ queryKey, exact: true, type: 'active' });
            expect(queryFn).toHaveBeenCalledTimes(2);
            const query = f.client.getQueryCache().find({ queryKey, exact: true });
            if (!query) throw new Error('Missing collection query');
            expect(query.options.queryFn).toBe(queryFn);
            expect(query.meta).toEqual(meta);
        } finally {
            stop();
            f.dispose();
        }
    });
    it('uses only validated existing exact-query hints for displayed artwork and never starts a request', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const f = fixture();
        try {
            await act(async () => {
                f.client.setQueryData(mediaKey, [mediaDescriptor(source, 'card')]);
                await Promise.resolve();
            });
            expect(f.result.media).toEqual([]);
            const page = f.page();
            page.generatedAt += 1;
            page.media.push(
                mediaDescriptor('/assets/preview/not-displayed.webp', 'card'),
                mediaDescriptor(source, 'hero'),
            );
            await act(async () => {
                seedPublicPage(f.client, page);
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([page.media[0]]));
            f.update({
                products: [
                    { id: 'graphql-only', featuredAsset: { id: 'asset', preview: source } },
                ] as Product[],
            });
            expect(f.result.media).toEqual([]);
            f.update({
                products: [
                    {
                        id: 'different-version',
                        featuredAsset: { id: 'asset', preview: source.replace('one', 'two') },
                    },
                ] as Product[],
            });
            expect(f.result.media).toEqual([]);
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            f.dispose();
            vi.unstubAllGlobals();
        }
    });

    it('drops hints on query invalidation, publication generation, error, removal and route departure', async () => {
        const f = fixture();
        try {
            const seed = async () => {
                await act(async () => {
                    const page = f.page();
                    page.generatedAt += 10;
                    seedPublicPage(f.client, page);
                    await Promise.resolve();
                });
                await vi.waitFor(() => expect(f.result.media).toHaveLength(1));
            };
            await seed();
            await act(async () => {
                await f.client.invalidateQueries({ queryKey: mediaKey, exact: true, refetchType: 'none' });
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([]));
            await seed();
            const previousGeneration = f.result.generation;
            await act(async () => {
                invalidatePublicPageReads();
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([]));
            expect(f.result.generation).not.toBe(previousGeneration);
            await seed();
            await act(async () => {
                const query = f.client.getQueryCache().find({ queryKey: mediaKey, exact: true });
                if (!query) throw new Error('Missing media query');
                query.setState({ status: 'error', error: new Error('Denied') });
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([]));
            await seed();
            await act(async () => {
                f.client.removeQueries({ queryKey: mediaKey, exact: true });
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([]));
            await seed();
            f.update({ active: false });
            expect(f.result.media).toEqual([]);
        } finally {
            f.dispose();
        }
    });

    it.each(['host', 'currency', 'language', 'store'] as const)(
        'does not borrow another %s scope',
        async mismatch => {
            const f = fixture();
            try {
                const page = f.page();
                if (mismatch === 'host') page.scope.host = 'other.invalid';
                if (mismatch === 'currency') page.scope.currencyCode = 'USD';
                if (mismatch === 'language') page.scope.languageCode = 'en';
                if (mismatch === 'store') {
                    page.scope.channelCode = 'other-store';
                    page.config.code = 'other-store';
                }
                await act(async () => {
                    seedPublicPage(f.client, page);
                    await Promise.resolve();
                });
                expect(f.result.media).toEqual([]);
            } finally {
                f.dispose();
            }
        },
    );

    it.each(['PREVIEW', 'CLOSED'] as const)('withdraws borrowed artwork on %s', async mode => {
        const f = fixture();
        try {
            await act(async () => {
                seedPublicPage(f.client, f.page());
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toHaveLength(1));
            await act(async () => {
                const page = f.page();
                page.generatedAt += 10;
                page.config.accessMode = mode;
                if (mode === 'CLOSED')
                    f.client.setQueryData(
                        [
                            ...storefrontQueryKeys.config(storefrontQueryKeys.market(market), 'zh_Hans'),
                            'public',
                        ],
                        page.config,
                    );
                else seedPublicPage(f.client, page);
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(f.result.media).toEqual([]));
        } finally {
            f.dispose();
        }
    });
});
