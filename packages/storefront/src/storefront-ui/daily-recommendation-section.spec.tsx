// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { Product } from '../types';

import { DailyRecommendationSection } from './daily-recommendation-section';

it('keeps compact rows across the pending-to-ready query transition without clickable fake products', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const product: Product = {
        id: 'sample',
        createdAt: '2026-10-11T00:00:00Z',
        name: 'Sample',
        slug: 'sample',
        description: '',
        featuredAsset: null,
        assets: [],
        collections: [],
        variants: [],
    };
    let finish!: (value: { items: Product[] }) => void;
    const api = {
        dailyRecommendations: () =>
            new Promise(resolve => {
                finish = resolve;
            }),
        productsByIds: () => Promise.resolve([product]),
    } as unknown as ShopApi;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <DailyRecommendationSection
                        api={api}
                        market={enabledMarkets[0]}
                        locale="en-US"
                        language="en"
                        title="Today's picks"
                        compact
                        limit={2}
                        onProduct={vi.fn()}
                    />
                </QueryClientProvider>,
            ),
        );
        expect(container.querySelector('.product-section')?.getAttribute('aria-busy')).toBe('true');
        expect(container.querySelectorAll('.search-recommendation-list .product-row')).toHaveLength(2);
        expect(container.querySelector('a')).toBeNull();
        expect(container.querySelector('.product-grid')).toBeNull();
        await act(async () => {
            finish({ items: [product] });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(container.querySelector('.product-section')?.hasAttribute('aria-busy')).toBe(false);
        expect(container.querySelectorAll('.search-recommendation-list .product-row')).toHaveLength(1);
        expect(container.querySelector('a')?.textContent).toContain('Sample');
        expect(container.querySelector('.product-grid')).toBeNull();
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});
