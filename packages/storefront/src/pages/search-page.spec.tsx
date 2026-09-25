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
const back = vi.hoisted(() => vi.fn());
const canGoBack = vi.hoisted(() => vi.fn(() => false));
const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => viewport.desktop }));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useRouter: () => ({ history: { back, canGoBack } }),
}));

describe('search result and product-detail cache separation', () => {
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
        navigate.mockClear();
        back.mockClear();
        canGoBack.mockReturnValue(false);
        viewport.desktop = false;
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
        expect(client.getQueryData(productKey)).toBeUndefined();
        const detail = { ...product, description: 'Full detail loaded by the destination route' };
        client.setQueryData(productKey, detail);

        // A pending route or other parent update must not publish the old search payload again.
        render();
        render();
        expect(client.getQueryData(productKey)).toEqual(detail);
    });

    it('keeps newly received result pages out of the complete detail cache', async () => {
        render();
        const nextProduct = { ...product, id: 'tea', name: 'Tea' };
        await act(async () => {
            client.setQueryData(searchKey, {
                pages: [{ items: [product, nextProduct], totalItems: 2 }],
                pageParams: [0],
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(client.getQueryData(productKey)).toBeUndefined();
        expect(
            client.getQueryData(
                storefrontQueryKeys.product(storefrontQueryKeys.market(market), 'en', nextProduct.id),
            ),
        ).toBeUndefined();
        expect(container.textContent).toContain('Tea');
    });

    it('closes a directly opened desktop search page to the home page', () => {
        viewport.desktop = true;
        render();
        const close = container.querySelector<HTMLButtonElement>('.search-close');
        expect(close?.textContent).toContain('Close search');
        act(() => close?.click());
        expect(navigate).toHaveBeenCalledWith({ to: '/', search: {} });
    });

    it('returns to the previous page when closing an entered desktop search', () => {
        viewport.desktop = true;
        canGoBack.mockReturnValue(true);
        render();
        act(() => container.querySelector<HTMLButtonElement>('.search-close')?.click());
        expect(back).toHaveBeenCalledOnce();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('closes desktop search with Escape while preserving an open dialog', async () => {
        viewport.desktop = true;
        render();
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.append(dialog);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await Promise.resolve();
        });
        expect(navigate).not.toHaveBeenCalled();
        dialog.remove();
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await Promise.resolve();
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/', search: {} });
    });

    it('returns to discovery when the search term is cleared', () => {
        viewport.desktop = true;
        render();
        const input = container.querySelector<HTMLInputElement>('.search-header input');
        if (!input) throw new Error('Search input was not mounted');
        act(() => {
            setNativeInputValue(input, '');
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/search', search: {}, replace: true });
        expect(container.querySelector('.search-discovery')).not.toBeNull();
    });

    it('shows and clears recent searches for only the current store and account', () => {
        const baseKey = `storefront-search-history:${market.code}`;
        localStorage.setItem(baseKey, JSON.stringify(['old shared search']));
        localStorage.setItem(`${baseKey}:customer:alice`, JSON.stringify(['alice search']));
        localStorage.setItem(`${baseKey}:customer:bob`, JSON.stringify(['bob search']));
        localStorage.setItem(`${baseKey}:guest`, JSON.stringify(['guest search']));
        const renderIdentity = (customerId?: string) => {
            act(() => {
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
                                customerId,
                                initialQuery: '',
                            }}
                        >
                            <SearchPage key={customerId ?? 'guest'} />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
        };

        renderIdentity('alice');
        expect(container.textContent).toContain('alice search');
        expect(container.textContent).not.toContain('bob search');
        expect(container.textContent).not.toContain('old shared search');

        renderIdentity('bob');
        expect(container.textContent).toContain('bob search');
        expect(container.textContent).not.toContain('alice search');
        act(() => {
            container.querySelector<HTMLButtonElement>('.search-recent button[aria-label="Clear"]')?.click();
        });
        expect(localStorage.getItem(`${baseKey}:customer:bob`)).toBeNull();
        expect(localStorage.getItem(`${baseKey}:customer:alice`)).not.toBeNull();
        expect(localStorage.getItem(baseKey)).not.toBeNull();

        renderIdentity();
        expect(container.textContent).toContain('guest search');
        expect(container.textContent).not.toContain('alice search');
    });

    it('keeps searching and clearing in-memory history when browser storage rejects writes', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage blocked', 'SecurityError');
        });
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('Storage blocked', 'SecurityError');
        });
        try {
            act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <SearchPageContext.Provider
                            value={{
                                api: {
                                    catalog: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
                                } as unknown as ShopApi,
                                products: [],
                                market,
                                locale: 'en-MY',
                                language: 'en',
                                storefrontCode: market.code,
                                customerId: 'alice',
                                initialQuery: '',
                            }}
                        >
                            <SearchPage />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
            const input = container.querySelector<HTMLInputElement>('.search-header input');
            if (!input) throw new Error('Search input was not mounted');
            act(() => {
                setNativeInputValue(input, 'coffee');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            act(() => {
                container.querySelector<HTMLButtonElement>('.search-submit')?.click();
            });
            expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/search' }));
            expect(setItem).toHaveBeenCalled();
            act(() => {
                setNativeInputValue(input, '');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            expect(container.querySelector('.search-recent')?.textContent).toContain('coffee');
            act(() => {
                container
                    .querySelector<HTMLButtonElement>('.search-recent button[aria-label="Clear"]')
                    ?.click();
            });
            expect(removeItem).toHaveBeenCalled();
            expect(container.querySelector('.search-recent')?.textContent).not.toContain('coffee');
        } finally {
            setItem.mockRestore();
            removeItem.mockRestore();
        }
    });

    it('does not submit unfinished Chinese text when Enter confirms an IME candidate', async () => {
        const catalog = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        const storeHistory = vi.spyOn(Storage.prototype, 'setItem');
        try {
            act(() => {
                root.render(
                    <QueryClientProvider client={client}>
                        <SearchPageContext.Provider
                            value={{
                                api: { catalog } as unknown as ShopApi,
                                products: [],
                                market,
                                locale: 'zh-CN',
                                language: 'zh',
                                storefrontCode: market.code,
                                initialQuery: '',
                            }}
                        >
                            <SearchPage />
                        </SearchPageContext.Provider>
                    </QueryClientProvider>,
                );
            });
            const input = container.querySelector('input');
            if (!input) throw new Error('Search input was not mounted');
            act(() => {
                setNativeInputValue(input, '中华');
                input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            });
            for (const options of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
                act(() => {
                    input.dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options }),
                    );
                });
                expect(navigate).not.toHaveBeenCalled();
                expect(catalog).not.toHaveBeenCalled();
                expect(storeHistory).not.toHaveBeenCalled();
            }
            await act(async () => {
                input.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13 }),
                );
                await Promise.resolve();
            });
            expect(navigate).toHaveBeenCalledTimes(1);
            expect(catalog).toHaveBeenCalledWith(
                expect.objectContaining({ term: '中华' }),
                expect.anything(),
            );
            expect(storeHistory).toHaveBeenCalledWith(expect.any(String), JSON.stringify(['中华']));
        } finally {
            storeHistory.mockRestore();
        }
    });
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Native input setter is unavailable');
    descriptor.set.call(input, value);
}
