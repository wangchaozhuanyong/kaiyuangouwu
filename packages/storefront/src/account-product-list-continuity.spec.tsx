// @vitest-environment jsdom
import { notifyManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { BrowsingHistoryPage } from './pages/browsing-history-page';
import { FavoriteProductsPage } from './pages/favorite-products-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { BrowsingHistoryPageContext, FavoriteProductsPageContext } from './storefront-page-contexts';
import { MarketConfig, Product, StorefrontLanguage } from './types';

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn(), canGoBack: () => false } }),
}));
vi.mock('./desktop-layout', () => ({ useDesktopLayout: () => false }));
vi.mock('./storefront-ui/product-section', () => ({
    ProductSection: ({ products: items }: { products: Product[] }) => (
        <section>
            {items.map(product => (
                <article key={product.id} data-product={product.id}>
                    {product.name}
                </article>
            ))}
        </section>
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Keep Query observer notifications inside act rather than racing a second timer tick.
notifyManager.setScheduler(callback => queueMicrotask(callback));
afterAll(() => notifyManager.setScheduler(callback => setTimeout(callback, 0)));

const market: MarketConfig = {
    code: 'fixture-market',
    currencyCode: 'MYR',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Fixture',
};
const products: Product[] = ['A', 'B', 'C', 'D'].map(id => ({
    id,
    name: `Product ${id}`,
    slug: id,
    description: '',
    createdAt: '',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [],
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function fixture(kind: 'favorites' | 'history', initialIds = ['A', 'B', 'C'], confirmed = true) {
    const client = createStorefrontQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
    const request = deferred<Product[]>();
    const read = vi.fn((_ids: string[], _signal?: AbortSignal) => request.promise);
    const api = { productsByIds: read } as unknown as ShopApi;
    let props = {
        api,
        productIds: initialIds,
        market,
        locale: market.locale,
        language: 'zh' as StorefrontLanguage,
        onRemove: vi.fn(),
        onClear: vi.fn(),
    };
    const key = (ids: string[], scope = market, language = 'zh_Hans') =>
        storefrontQueryKeys.productsByIds(storefrontQueryKeys.market(scope), language, ids);
    if (confirmed)
        client.setQueryData(
            key(initialIds),
            products.filter(product => initialIds.includes(product.id)),
        );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (next: Partial<typeof props> = {}) => {
        props = { ...props, ...next };
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    {kind === 'favorites' ? (
                        <FavoriteProductsPageContext.Provider value={props}>
                            <FavoriteProductsPage />
                        </FavoriteProductsPageContext.Provider>
                    ) : (
                        <BrowsingHistoryPageContext.Provider value={props}>
                            <BrowsingHistoryPage />
                        </BrowsingHistoryPageContext.Provider>
                    )}
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
    };
    const settle = async (callback: () => void) => {
        await act(async () => {
            callback();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    };
    const cards = () =>
        Array.from(host.querySelectorAll('[data-product]'), card => card.getAttribute('data-product'));
    const leave = async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <p>Other page</p>
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
    };
    const cleanup = () => {
        act(() => root.unmount());
        client.clear();
        host.remove();
    };
    return { render, settle, cards, leave, cleanup, client, key, request, read, host, api };
}

describe.each(['favorites', 'history'] as const)('%s product list continuity', kind => {
    it('keeps only remaining confirmed cards while an uncached ID set loads and fails', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            expect(page.cards()).toEqual(['A', 'B', 'C']);
            await page.render({ productIds: ['B', 'C'] });
            expect(page.cards()).toEqual(['B', 'C']);
            expect(page.host.querySelector('[data-page-pending]')).toBeNull();
            await page.settle(() => page.request.reject(new Error('Fixture new read failure')));
            expect(page.cards()).toEqual(['B', 'C']);
            expect(page.host.querySelector('.inline-error')).not.toBeNull();
            expect(page.client.getQueryState(page.key(['B', 'C']))?.status).toBe('error');
            expect(page.client.getQueryData(page.key(['B', 'C']))).toBeUndefined();
            const recovery = deferred<Product[]>();
            page.read.mockImplementation(() => recovery.promise);
            await page.settle(() => {
                const retry = page.host.querySelector<HTMLButtonElement>('.inline-error button');
                expect(retry).not.toBeNull();
                retry?.click();
                retry?.click();
            });
            expect(page.read).toHaveBeenCalledTimes(2);
            expect(page.cards()).toEqual(['B', 'C']);
            await page.settle(() => recovery.resolve([{ ...products[1], name: 'Updated B' }, products[2]]));
            expect(page.host.textContent).toContain('Updated B');
            expect(page.host.querySelector('.inline-error')).toBeNull();
        } finally {
            page.cleanup();
        }
    });

    it('accepts an explicit empty response and never resurrects it as retained cards', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            await page.render({ productIds: ['B', 'C'] });
            expect(page.cards()).toEqual(['B', 'C']);
            await page.settle(() => page.request.resolve([]));
            expect(page.cards()).toEqual([]);
            expect(page.host.textContent).toContain('已下架');
            expect(page.host.querySelector('[data-page-pending]')).toBeNull();
            const next = deferred<Product[]>();
            page.read.mockImplementation(() => next.promise);
            await page.render({ productIds: ['B'] });
            expect(page.cards()).toEqual([]);
            expect(page.host.querySelector('[data-page-pending]')).not.toBeNull();
        } finally {
            page.cleanup();
        }
    });

    it('leaves confirmed same-key refresh errors to the shared feedback without another inline alert', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            await page.settle(() => {
                void page.client.refetchQueries(
                    { queryKey: page.key(['A', 'B', 'C']) },
                    { cancelRefetch: false },
                );
            });
            await page.settle(() => page.request.reject(new Error('Fixture background failure')));
            expect(page.cards()).toEqual(['A', 'B', 'C']);
            expect(page.host.querySelector('.inline-error')).toBeNull();
            expect(page.host.textContent).not.toContain('加载失败');
            expect(page.client.getQueryState(page.key(['A', 'B', 'C']))?.status).toBe('error');
        } finally {
            page.cleanup();
        }
    });

    it('filters immediately in current ID order, including additions and late old responses', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            await page.render({ productIds: ['C', 'B', 'D'] });
            expect(page.cards()).toEqual(['C', 'B']);
            const next = deferred<Product[]>();
            page.read.mockImplementation(() => next.promise);
            await page.render({ productIds: ['B'] });
            expect(page.cards()).toEqual(['B']);
            const signal = page.read.mock.calls[0][1] as AbortSignal;
            expect(signal.aborted).toBe(true);
            await page.settle(() => page.request.resolve([products[2], products[1], products[3]]));
            expect(page.cards()).toEqual(['B']);
            await page.settle(() => next.resolve([products[2], { ...products[1], name: 'Current B' }]));
            expect(page.cards()).toEqual(['B']);
            expect(page.host.textContent).toContain('Current B');
        } finally {
            page.cleanup();
        }
    });

    it.each(['api', 'market', 'currency', 'language'] as const)(
        'does not retain across a changed %s scope',
        async scope => {
            const page = fixture(kind);
            try {
                await page.render();
                const changed =
                    scope === 'api'
                        ? {
                              api: {
                                  productsByIds: vi.fn(() => deferred<Product[]>().promise),
                              } as unknown as ShopApi,
                          }
                        : scope === 'market'
                          ? { market: { ...market, code: 'other-market' } }
                          : scope === 'currency'
                            ? { market: { ...market, currencyCode: 'CNY' } }
                            : { language: 'en' as StorefrontLanguage };
                await page.render({ productIds: ['B', 'C'], ...changed });
                expect(page.cards()).toEqual([]);
                expect(page.host.querySelector('[data-page-pending]')).not.toBeNull();
            } finally {
                page.cleanup();
            }
        },
    );

    it.each([{ initialIds: ['A', 'B', 'C'] }, { initialIds: ['A'] }])(
        'clears all retained cards when removing the final IDs from $initialIds',
        async ({ initialIds }) => {
            const page = fixture(kind, initialIds);
            try {
                await page.render();
                expect(page.cards()).toEqual(initialIds);
                await page.render({ productIds: [] });
                expect(page.cards()).toEqual([]);
                expect(page.host.textContent).toContain(
                    kind === 'favorites' ? '暂无收藏商品' : '暂无浏览足迹',
                );
                expect(page.host.querySelector('[data-page-pending]')).toBeNull();
                await page.render({ productIds: ['B', 'C'] });
                expect(page.cards()).toEqual([]);
                expect(page.host.querySelector('[data-page-pending]')).not.toBeNull();
            } finally {
                page.cleanup();
            }
        },
    );

    it('retains cards while the new ID query is offline, with a visible local retry', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            await page.settle(() => onlineManager.setOnline(false));
            await page.render({ productIds: ['B', 'C'] });
            expect(page.cards()).toEqual(['B', 'C']);
            expect(page.host.querySelector('.inline-error')?.textContent).toContain('网络不可用');
            expect(page.host.querySelector('.inline-error button')).not.toBeNull();
            expect(page.read).not.toHaveBeenCalled();
            expect(page.client.getQueryData(page.key(['B', 'C']))).toBeUndefined();
        } finally {
            page.cleanup();
            onlineManager.setOnline(true);
        }
    });

    it('keeps initial brand loading and full-page failures when there are no confirmed cards', async () => {
        const page = fixture(kind, ['A'], false);
        try {
            await page.render();
            expect(page.host.querySelector('[data-page-pending]')).not.toBeNull();
            await page.settle(() => page.request.reject(new Error('Fixture initial failure')));
            expect(page.cards()).toEqual([]);
            expect(page.host.textContent).toContain('加载失败');
            expect(page.host.querySelector('.inline-error')).toBeNull();
        } finally {
            page.cleanup();
        }
    });

    it('does not carry local retention through unmount, but immediately reuses complete successful queries', async () => {
        const page = fixture(kind);
        try {
            await page.render();
            await page.render({ productIds: ['B', 'C'] });
            expect(page.cards()).toEqual(['B', 'C']);
            await page.leave();
            expect((page.read.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
            await page.settle(() => page.request.resolve([products[1], products[2]]));
            page.read.mockImplementation(() => deferred<Product[]>().promise);
            await page.render();
            expect(page.cards()).toEqual([]);
            expect(page.host.querySelector('[data-page-pending]')).not.toBeNull();
            await page.settle(() =>
                page.client.setQueryData(page.key(['B', 'C']), [products[1], products[2]]),
            );
            await page.leave();
            await page.render();
            expect(page.cards()).toEqual(['B', 'C']);
            expect(page.host.querySelector('[data-page-pending]')).toBeNull();
        } finally {
            page.cleanup();
        }
    });
});
