// @vitest-environment jsdom
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { refreshStorefrontAssociations } from '../realtime-updates';
import { DailyRecommendationSection } from '../storefront-ui/daily-recommendation-section';
import { MarketConfig } from '../types';

import { useDailyRecommendations } from './useDailyRecommendations';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('shared daily recommendation query', () => {
    const clients: QueryClient[] = [];
    const roots: Array<ReturnType<typeof createRoot>> = [];
    afterEach(() => {
        act(() => roots.splice(0).forEach(root => root.unmount()));
        clients.splice(0).forEach(client => client.clear());
        vi.useRealTimers();
        focusManager.setFocused(undefined);
        onlineManager.setOnline(true);
    });

    function mount(api: ShopApi, markets: MarketConfig[]) {
        if (typeof api.productsByIds !== 'function') {
            api.productsByIds = vi.fn((ids: string[]) => Promise.resolve(ids.map(id => ({ id }) as never)));
        }
        const host = document.createElement('div');
        const root = createRoot(host);
        const client = new QueryClient();
        roots.push(root);
        clients.push(client);
        function Consumer({ market }: { market: MarketConfig }) {
            const query = useDailyRecommendations(api, market, 'zh');
            return (
                <button onClick={() => void query.retry()}>
                    {query.status}:{query.data?.items.map(product => product.id).join(',')}
                </button>
            );
        }
        const render = (visible = true) =>
            act(() =>
                root.render(
                    <QueryClientProvider client={client}>
                        {visible && markets.map((market, index) => <Consumer key={index} market={market} />)}
                    </QueryClientProvider>,
                ),
            );
        render();
        return { host, client, render };
    }

    it('shares one request and ordered selection across search and account consumers', async () => {
        const dailyRecommendations = vi.fn().mockResolvedValue({
            items: [{ id: '11' }, { id: '7' }],
            businessDate: '2026-10-02',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        const market = enabledMarkets[0];
        const { host } = mount({ dailyRecommendations } as unknown as ShopApi, [market, market]);
        await act(() => vi.waitFor(() => expect(host.textContent).toBe('success:11,7success:11,7')));
        expect(dailyRecommendations).toHaveBeenCalledTimes(1);
        expect(dailyRecommendations.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    });
    it('reconciles eight saved identities to six and restores the original order without re-reading recommendation selection', async () => {
        const ids = Array.from({ length: 8 }, (_, index) => String(index));
        let available = ids;
        const dailyRecommendations = vi.fn(() =>
            Promise.resolve({
                items: ids.map(id => ({ id })),
                businessDate: '2026-10-11',
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
        );
        const productsByIds = vi.fn((requested: string[]) =>
            Promise.resolve(
                requested
                    .filter(id => available.includes(id))
                    .reverse()
                    .map(id => ({ id })),
            ),
        );
        const market = enabledMarkets[0];
        const fixture = mount({ dailyRecommendations, productsByIds } as unknown as ShopApi, [
            market,
            market,
        ]);
        const scope = { marketCode: storefrontQueryKeys.market(market), languageCode: 'zh_Hans' };
        await act(() =>
            vi.waitFor(() =>
                expect(fixture.host.textContent).toBe(`success:${ids.join(',')}success:${ids.join(',')}`),
            ),
        );
        available = ids.filter(id => !['1', '5'].includes(id));
        await act(async () => {
            await refreshStorefrontAssociations(fixture.client, scope);
        });
        await act(() =>
            vi.waitFor(() =>
                expect(fixture.host.textContent).toBe(
                    `success:${available.join(',')}success:${available.join(',')}`,
                ),
            ),
        );
        available = ids;
        await act(async () => {
            await refreshStorefrontAssociations(fixture.client, scope);
        });
        await act(() =>
            vi.waitFor(() =>
                expect(fixture.host.textContent).toBe(`success:${ids.join(',')}success:${ids.join(',')}`),
            ),
        );
        expect(dailyRecommendations).toHaveBeenCalledTimes(1);
        expect(productsByIds).toHaveBeenCalledTimes(3);
        expect(productsByIds.mock.calls.every(call => call[0].join() === ids.join())).toBe(true);
    });

    it('keeps order across background updates, focus, reconnect, route remount and midnight; reload selects again', async () => {
        const initial = {
            items: [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
            ],
            businessDate: '2026-10-02',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        const dailyRecommendations = vi.fn().mockResolvedValue(initial);
        const api = { dailyRecommendations } as unknown as ShopApi;
        const fixture = mount(api, [enabledMarkets[0]]);
        await act(() => vi.waitFor(() => expect(fixture.host.textContent).toBe('success:a,b')));
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60_000));
        act(() => {
            vi.advanceTimersByTime(120_000);
            focusManager.setFocused(false);
            focusManager.setFocused(true);
            onlineManager.setOnline(false);
            onlineManager.setOnline(true);
        });
        expect(dailyRecommendations).toHaveBeenCalledTimes(1);
        expect(fixture.host.textContent).toBe('success:a,b');
        fixture.render(false);
        fixture.render();
        expect(fixture.host.textContent).toBe('success:a,b');
        expect(dailyRecommendations).toHaveBeenCalledTimes(1);
        dailyRecommendations.mockResolvedValue({
            ...initial,
            items: [
                { id: 'b', name: 'Updated B' },
                { id: 'a', name: 'Updated A' },
                { id: 'c', name: 'C' },
            ],
        });
        await act(async () => {
            await fixture.client.invalidateQueries();
        });
        expect(fixture.host.textContent).toBe('success:a,b');
        fixture.render(false);
        fixture.render();
        expect(fixture.host.textContent).toBe('success:a,b');
        const reloaded = mount(api, [enabledMarkets[0]]);
        await act(() => vi.waitFor(() => expect(reloaded.host.textContent).toBe('success:b,a,c')));
    });

    it('keeps the current document selection after midnight instead of removing its cards', () => {
        const client = new QueryClient();
        clients.push(client);
        const market = enabledMarkets[0];
        client.setQueryData(
            [
                ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), 'zh_Hans'),
                'daily-recommendations',
            ],
            {
                items: [
                    {
                        id: 'yesterday',
                        name: 'Yesterday product',
                        slug: 'yesterday',
                        description: '',
                        featuredAsset: null,
                        assets: [],
                        collections: [],
                        variants: [],
                    },
                ],
                expiresAt: new Date(Date.now() - 1000).toISOString(),
                businessDate: '2026-10-01',
            },
        );
        const html = renderToStaticMarkup(
            <QueryClientProvider client={client}>
                <DailyRecommendationSection
                    api={{} as ShopApi}
                    market={market}
                    locale="zh-CN"
                    language="zh"
                    title="今日推荐"
                    enabled={false}
                    onProduct={() => undefined}
                />
            </QueryClientProvider>,
        );
        expect(html).not.toContain('aria-busy="true"');
        expect(html).toContain('Yesterday product');
    });

    it('shows the first eight shared daily products under a centered account title and keeps search at ten', () => {
        const client = new QueryClient();
        clients.push(client);
        const market = enabledMarkets[0];
        const items = Array.from({ length: 10 }, (_, index) => ({
            id: String(index + 1),
            name: `Product ${index + 1}`,
            slug: `product-${index + 1}`,
            description: '',
            featuredAsset: null,
            assets: [],
            collections: [],
            variants: [],
            customFields: { fulfillmentType: 'physical' as const },
        }));
        client.setQueryData(
            [
                ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), 'zh_Hans'),
                'daily-recommendations',
            ],
            {
                items,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                businessDate: '2026-10-02',
            },
        );
        const render = (limit?: number, centered = false) =>
            renderToStaticMarkup(
                <QueryClientProvider client={client}>
                    <DailyRecommendationSection
                        api={{} as ShopApi}
                        market={market}
                        locale="zh-CN"
                        language="zh"
                        title={centered ? '专属推荐' : '今日推荐'}
                        centered={centered}
                        limit={limit}
                        enabled={false}
                        onProduct={() => undefined}
                    />
                </QueryClientProvider>,
            );
        const account = render(8, true);
        expect(account.match(/class="product-card"/gu)).toHaveLength(8);
        expect(account).toContain('class="section-header-center-label"');
        expect(account).toContain('专属推荐');
        expect(account).not.toContain('Product 9');
        expect(render().match(/class="product-card"/gu)).toHaveLength(10);
        expect(render(4, true).match(/class="product-card"/gu)).toHaveLength(4);
    });

    it('isolates stores and retries a failed query without substituting a random or catalog list', async () => {
        const dailyRecommendations = vi.fn().mockRejectedValue(new Error('Unavailable'));
        const market = enabledMarkets[0];
        const { host, client } = mount({ dailyRecommendations } as unknown as ShopApi, [
            market,
            { ...market, code: 'another-store' },
        ]);
        await act(() => vi.waitFor(() => expect(host.textContent).toBe('error:error:')));
        expect(
            client
                .getQueryCache()
                .getAll()
                .filter(query => query.queryKey[3] === 'daily-recommendations'),
        ).toHaveLength(2);
        expect(dailyRecommendations).toHaveBeenCalledTimes(2);
        dailyRecommendations.mockResolvedValue({
            items: [{ id: '9' }],
            businessDate: '2026-10-02',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        act(() => host.querySelector('button')?.click());
        await act(() => vi.waitFor(() => expect(host.textContent).toBe('success:9error:')));
    });
});
