// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { refreshStorefrontQueries, storefrontQueryKeys } from '../query-client';
import { invalidateStorefrontRealtimeQueries } from '../realtime-updates';
import { type PublicPageData } from '../storefront-page-data';
import { type StorefrontContentResponse } from '../types';
import { useStorefrontVisualPreset } from '../use-storefront-visual-preset';

import { useStorefrontPublicData } from './useStorefrontPublicData';

vi.mock('../api/helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../api/helpers')>()),
    SEND_CLIENT_CHANNEL_TOKEN: false,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
afterEach(() => {
    act(() => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.storefrontPreset;
});

async function setup(mode: 'missing' | 'partial' | 'complete') {
    const market = enabledMarkets[0];
    let revision = 0;
    const label = () => `revision-${revision}`;
    const config = () => ({
        code: market.code,
        defaultLanguageCode: 'zh_Hans' as const,
        defaultCurrencyCode: market.currencyCode,
        customFields: {},
        availableCountries: [],
        description: label(),
    });
    const content = (): StorefrontContentResponse => ({
        blocks: [],
        settings: {
            heroAutoplayIntervalSeconds: 5,
            auth: {
                emailPasswordEnabled: true,
                emailAutoRegistrationEnabled: false,
                emailQuickRegistrationEnabled: false,
                googleEnabled: false,
                googleClientId: null,
            },
        },
        flashSales: [],
        systemAnnouncements: [
            { id: label(), title: label(), content: '', linkUrl: null, startsAt: null, endsAt: null },
        ],
    });
    const products = () => [
        {
            id: label(),
            createdAt: '2026-01-01T00:00:00Z',
            name: label(),
            slug: label(),
            description: '',
            featuredAsset: null,
            assets: [],
            collections: [],
            variants: [],
        },
    ];
    const collections = () => [
        {
            id: label(),
            name: label(),
            slug: label(),
            description: '',
            position: 0,
            parentId: '',
            featuredAsset: null,
            children: [],
        },
    ];
    const flashSales = () => [{ id: label(), startsAt: null, endsAt: null, items: [] }];
    const visualPreset = () => ({ presetId: revision ? 'neo-minimalist' : 'classic' });
    const page = (): PublicPageData => ({
        schemaVersion: 1,
        version: label(),
        generatedAt: Date.now() + 1,
        route: '/',
        scope: {
            host: window.location.host,
            channelCode: market.code,
            languageCode: 'zh_Hans',
            currencyCode: market.currencyCode,
            priceContext: 'public',
        },
        config: config(),
        products: products(),
        collections: collections(),
        flashSales: flashSales(),
        ...(mode === 'complete' ? { content: content(), visualPreset: visualPreset() } : {}),
        media: [],
        failures: mode === 'partial' ? ['content', 'visualPreset'] : [],
    });
    const fetch = vi.fn(() =>
        Promise.resolve(mode === 'missing' ? new Response('', { status: 404 }) : Response.json(page())),
    );
    vi.stubGlobal('fetch', fetch);
    const api = {
        storefrontConfig: vi.fn(() => Promise.resolve(config())),
        storefrontContent: vi.fn(() => Promise.resolve(content())),
        products: vi.fn(() => Promise.resolve(products())),
        collections: vi.fn(() => Promise.resolve(collections())),
        activeFlashSales: vi.fn(() => Promise.resolve(flashSales())),
        storefrontVisualPreset: vi.fn(() => Promise.resolve(visualPreset())),
        reviewSettings: vi.fn(() => Promise.resolve({ enabled: true })),
        activeStoreCommerceMode: vi.fn(() => Promise.resolve('RETAIL')),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(document.createElement('div'));
    let data: ReturnType<typeof useStorefrontPublicData> | undefined;
    function Probe() {
        const [resolved, setResolved] = useState(false);
        data = useStorefrontPublicData({
            api: api as unknown as ShopApi,
            market,
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: resolved,
            customerAuthenticated: false,
        });
        useStorefrontVisualPreset(api as unknown as ShopApi, market, 'zh_Hans', resolved);
        const configured = data.configQuery.data !== undefined;
        useEffect(() => {
            if (configured) setResolved(true);
        }, [configured]);
        return null;
    }
    cleanups.push(() => {
        root.unmount();
        client.clear();
    });
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        );
        await Promise.resolve();
    });
    const current = () => {
        if (!data) throw new Error('Public data probe is not mounted');
        return data;
    };
    const assertRevision = (expected: number) => {
        const next = `revision-${expected}`;
        expect(current().configQuery.data?.description).toBe(next);
        expect(current().systemAnnouncements[0]?.title).toBe(next);
        expect(current().products[0]?.name).toBe(next);
        expect(current().collections[0]?.name).toBe(next);
        expect(current().activeFlashSales[0]?.id).toBe(next);
        expect(document.documentElement.dataset.storefrontPreset).toBe(
            expected ? 'neo-minimalist' : 'classic',
        );
    };
    const settle = (assertion: () => void) =>
        vi.waitFor(async () => {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            assertion();
        });
    const expectRevision = (expected: number) => settle(() => assertRevision(expected));
    await expectRevision(0);
    fetch.mockClear();
    const refresh = () =>
        refreshStorefrontQueries(client, {
            marketCode: storefrontQueryKeys.market(market),
            languageCode: 'zh_Hans',
        });
    const publication = () =>
        invalidateStorefrontRealtimeQueries(
            client,
            { version: 1, id: 'content-publication', occurredAt: '', topics: ['content'] },
            { marketCode: storefrontQueryKeys.market(market), languageCode: 'zh_Hans' },
        );
    return { api, current, fetch, refresh, publication, expectRevision, settle, publish: () => revision++ };
}

describe('aggregate owner fallback refresh', () => {
    it('refreshes missing endpoint sections and skin once through the shared owner', async () => {
        const fixture = await setup('missing');
        fixture.publish();
        await act(async () => {
            await Promise.all([fixture.refresh(), fixture.refresh()]);
        });
        await fixture.expectRevision(1);
        expect(fixture.fetch).toHaveBeenCalledTimes(1);
        for (const section of [
            'storefrontConfig',
            'storefrontContent',
            'products',
            'collections',
            'activeFlashSales',
            'storefrontVisualPreset',
        ] as const)
            expect(fixture.api[section]).toHaveBeenCalledTimes(2);
    });

    it('refreshes only missing sections of a successful aggregate, including its skin', async () => {
        const fixture = await setup('partial');
        fixture.publish();
        await act(async () => {
            await fixture.refresh();
        });
        await fixture.expectRevision(1);
        expect(fixture.fetch).toHaveBeenCalledTimes(1);
        expect(fixture.api.storefrontContent).toHaveBeenCalledTimes(2);
        expect(fixture.api.storefrontVisualPreset).toHaveBeenCalledTimes(2);
        for (const section of ['storefrontConfig', 'products', 'collections', 'activeFlashSales'] as const)
            expect(fixture.api[section]).not.toHaveBeenCalled();
    });

    it('recovers missing aggregate sections and skin after a content publication event', async () => {
        const fixture = await setup('partial');
        fixture.publish();
        await act(async () => {
            await fixture.publication();
        });
        await fixture.expectRevision(1);
        expect(fixture.fetch).toHaveBeenCalledTimes(1);
        expect(fixture.api.storefrontContent).toHaveBeenCalledTimes(2);
        expect(fixture.api.storefrontVisualPreset).toHaveBeenCalledTimes(2);
    });

    it('uses the complete aggregate without initial or refresh fallback reads', async () => {
        const fixture = await setup('complete');
        fixture.publish();
        await act(async () => {
            await fixture.refresh();
        });
        await fixture.expectRevision(1);
        expect(fixture.fetch).toHaveBeenCalledTimes(1);
        for (const section of [
            'storefrontConfig',
            'storefrontContent',
            'products',
            'collections',
            'activeFlashSales',
            'storefrontVisualPreset',
        ] as const)
            expect(fixture.api[section]).not.toHaveBeenCalled();
    });

    it('keeps section data and its read error separate from config, then recovers on shared retry', async () => {
        const fixture = await setup('partial');
        fixture.api.storefrontContent.mockRejectedValueOnce(new Error('Content refresh unavailable'));
        fixture.publish();
        await act(async () => {
            await fixture.refresh();
        });
        await fixture.settle(() => expect(fixture.current().contentQuery.isError).toBe(true));
        expect(fixture.current().systemAnnouncements[0]?.title).toBe('revision-0');
        expect(fixture.current().configQuery.isError).toBe(false);
        expect(fixture.current().configQuery.data?.description).toBe('revision-1');
        fixture.publish();
        await act(async () => {
            await fixture.refresh();
        });
        await fixture.expectRevision(2);
        expect(fixture.current().contentQuery.isError).toBe(false);
        expect(fixture.api.storefrontContent).toHaveBeenCalledTimes(3);
    });
});
