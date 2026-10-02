// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
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
    });

    function mount(api: ShopApi, markets: MarketConfig[]) {
        const host = document.createElement('div');
        const root = createRoot(host);
        const client = new QueryClient();
        roots.push(root);
        clients.push(client);
        function Consumer({ market }: { market: MarketConfig }) {
            const query = useDailyRecommendations(api, market, 'zh');
            return (
                <button onClick={() => void query.refetch()}>
                    {query.status}:{query.data?.items.map(product => product.id).join(',')}
                </button>
            );
        }
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    {markets.map((market, index) => (
                        <Consumer key={index} market={market} />
                    ))}
                </QueryClientProvider>,
            ),
        );
        return { host, client };
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

    it("does not display yesterday's cached selection while waiting for today's response", () => {
        const client = new QueryClient();
        clients.push(client);
        const market = enabledMarkets[0];
        client.setQueryData(
            [
                ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), 'zh_Hans'),
                'daily-recommendations',
            ],
            {
                items: [{ id: 'yesterday', name: 'Yesterday product' }],
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
        expect(html).toContain('aria-busy="true"');
        expect(html).not.toContain('Yesterday product');
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
        expect(client.getQueryCache().getAll()).toHaveLength(2);
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
