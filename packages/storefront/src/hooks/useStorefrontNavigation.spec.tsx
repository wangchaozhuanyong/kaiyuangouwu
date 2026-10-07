// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { preloadRouteMedia } from '../route-media-preload';
import { type CollectionSummary } from '../types';

import { useStorefrontNavigation } from './useStorefrontNavigation';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = vi.hoisted(() => ({
    navigate: vi.fn(),
    back: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    history: { back: vi.fn(), canGoBack: () => true },
    state: {
        location: { pathname: '/category', search: {}, searchStr: '' },
        resolvedLocation: { pathname: '/category', search: {}, searchStr: '' },
        status: 'idle',
    },
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => router.navigate,
    useRouter: () => router,
    useRouterState: ({ select }: { select: (state: typeof router.state) => unknown }) => select(router.state),
}));
vi.mock('../route-component-preload', () => ({
    preloadStorefrontRouteComponent: vi.fn(() => Promise.resolve()),
}));
vi.mock('../route-media-preload', () => ({ preloadRouteMedia: vi.fn() }));

describe('storefront navigation state', () => {
    let root: ReturnType<typeof createRoot>;
    let value: ReturnType<typeof useStorefrontNavigation>;
    let prepareProduct: ((id: string) => Promise<void>) | undefined;
    const collections: CollectionSummary[] = [
        {
            id: 'first',
            name: '分类',
            slug: 'first',
            description: '',
            position: 1,
            parentId: 'root',
            featuredAsset: null,
            children: [],
        },
    ];
    function Harness() {
        value = useStorefrontNavigation({ collections, prepareProduct });
        return null;
    }
    beforeEach(() => {
        prepareProduct = undefined;
        vi.mocked(preloadStorefrontRouteComponent).mockClear();
        vi.mocked(preloadRouteMedia).mockClear();
        router.navigate.mockReset();
        router.navigate.mockImplementation(({ to, search = {} }) => {
            router.state.location = { pathname: to, search, searchStr: '' };
            return Promise.resolve();
        });
        router.history.back.mockReset();
        router.history.back.mockImplementation(() => {
            router.state.location = { pathname: '/services', search: {}, searchStr: '' };
        });
        router.state.location = { pathname: '/category', search: {}, searchStr: '' };
        router.state.resolvedLocation = router.state.location;
        router.state.status = 'idle';
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it('keeps the URL all-products default and remembers explicit filters when returning', () => {
        act(() => root.render(<Harness />));
        expect(value.activeCollectionId).toBe('all');
        expect(value.activeChildId).toBe('all');
        act(() => value.updateCategory({ collectionId: 'picked', minPrice: '10', inStockOnly: true }));
        act(() => value.navigate({ name: 'category' }));
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                to: '/category',
                search: expect.objectContaining({
                    collectionId: 'picked',
                    minPrice: '10',
                    inStockOnly: true,
                }),
            }),
        );
    });

    it('resynchronizes filter state after a history navigation', () => {
        act(() => root.render(<Harness />));
        router.state.location = {
            pathname: '/category',
            search: { collectionId: 'history', minPrice: '20' },
            searchStr: '',
        };
        act(() => root.render(<Harness />));
        expect(value.activeCollectionId).toBe('history');
        expect(value.minimumPrice).toBe('20');
    });

    it('keeps the resolved page visible while the destination is loading', () => {
        router.state.status = 'pending';
        router.state.location = { pathname: '/product', search: { id: 'p1' }, searchStr: '?id=p1' };
        act(() => root.render(<Harness />));
        expect(value.route.name).toBe('product');
        expect(value.displayedRoute.name).toBe('category');
    });

    it('navigates immediately while warming product data and never navigates again on resolution', async () => {
        let finishPreparation!: () => void;
        prepareProduct = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishPreparation = resolve;
                }),
        );
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'p1' }));
        expect(value.isPreparingProduct).toBe(false);
        expect(router.navigate).toHaveBeenCalledOnce();
        expect(router.state.location).toMatchObject({ pathname: '/product', search: { id: 'p1' } });
        await act(async () => {
            finishPreparation();
            await Promise.resolve();
        });
        expect(router.navigate).toHaveBeenCalledOnce();
    });

    it('does not restart a wait, prefetch or history entry when the same product is clicked repeatedly', async () => {
        vi.useFakeTimers();
        prepareProduct = vi.fn(() => new Promise<void>(() => undefined));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'p1' }));
        await act(async () => vi.advanceTimersByTimeAsync(1_000));
        act(() => value.navigate({ name: 'product', id: 'p1' }));
        await act(async () => vi.advanceTimersByTimeAsync(3_000));
        expect(value.isPreparingProduct).toBe(false);
        expect(prepareProduct).toHaveBeenCalledOnce();
        expect(router.navigate).toHaveBeenCalledOnce();
    });

    it('does not deduplicate different variants of the same product', () => {
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'p1', variantId: 'v1' }));
        act(() => value.navigate({ name: 'product', id: 'p1', variantId: 'v2' }));
        expect(router.navigate).toHaveBeenCalledTimes(2);
        expect(router.state.location.search).toMatchObject({ id: 'p1', variantId: 'v2' });
    });

    it.each(['/account', '/cart', '/services'])(
        'late product data cannot replace a direct navigation to %s',
        async target => {
            let finish!: () => void;
            prepareProduct = vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        finish = resolve;
                    }),
            );
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            act(() => {
                void router.navigate({ to: target });
            });
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(router.state.location.pathname).toBe(target);
            expect(router.navigate).toHaveBeenCalledTimes(2);
        },
    );

    it.each([true, false])(
        'late preparation cannot replace history navigation (app back: %s)',
        async appBack => {
            let finish!: () => void;
            prepareProduct = () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                });
            act(() => root.render(<Harness />));
            act(() => value.navigate({ name: 'product', id: 'old-product' }));
            act(() => {
                if (appBack) value.goBack();
                else router.history.back();
            });
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(router.state.location.pathname).toBe('/services');
            expect(router.navigate).toHaveBeenCalledOnce();
        },
    );

    it('keeps the last of two different product intents even when their data resolves in reverse order', async () => {
        const finish = new Map<string, () => void>();
        prepareProduct = id =>
            new Promise<void>(resolve => {
                finish.set(id, resolve);
            });
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'first' }));
        act(() => value.navigate({ name: 'product', id: 'second' }));
        await act(async () => {
            const resolve = finish.get('second');
            if (!resolve) throw new Error('Second prefetch did not start');
            resolve();
            await Promise.resolve();
        });
        await act(async () => {
            const resolve = finish.get('first');
            if (!resolve) throw new Error('First prefetch did not start');
            resolve();
            await Promise.resolve();
        });
        expect(router.state.location).toMatchObject({ pathname: '/product', search: { id: 'second' } });
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('leaves product failures to the destination query without replaying navigation', async () => {
        prepareProduct = vi.fn().mockRejectedValue(new Error('Fixture product failure'));
        act(() => root.render(<Harness />));
        await act(async () => {
            value.navigate({ name: 'product', id: 'failed' });
            await Promise.resolve();
        });
        expect(router.state.location.pathname).toBe('/product');
        expect(router.navigate).toHaveBeenCalledOnce();
    });

    it('warms an anchor intent without navigating or superseding a formal navigation', async () => {
        let finish!: () => void;
        prepareProduct = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'current' }));
        const link = document.createElement('a');
        link.href = `${window.location.origin}/services`;
        document.body.append(link);
        try {
            act(() => {
                link.dispatchEvent(new Event('pointerover', { bubbles: true }));
            });
            expect(preloadStorefrontRouteComponent).toHaveBeenLastCalledWith('services');
            expect(preloadRouteMedia).toHaveBeenLastCalledWith(
                expect.objectContaining({ name: 'services' }),
                [],
                [],
            );
            expect(prepareProduct).toHaveBeenCalledOnce();
            expect(router.navigate).toHaveBeenCalledOnce();
            await act(async () => {
                finish();
                await Promise.resolve();
            });
            expect(router.state.location).toMatchObject({
                pathname: '/product',
                search: { id: 'current' },
            });
        } finally {
            link.remove();
        }
    });

    it('cannot restore an old target when the scope-owned prefetch callback changes', async () => {
        let finishOldScope!: () => void;
        prepareProduct = vi.fn(() => new Promise<void>(resolve => (finishOldScope = resolve)));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'old' }));
        prepareProduct = vi.fn().mockResolvedValue(undefined);
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'new' }));
        await act(async () => {
            finishOldScope();
            await Promise.resolve();
        });
        expect(router.state.location).toMatchObject({ pathname: '/product', search: { id: 'new' } });
        expect(prepareProduct).toHaveBeenCalledExactlyOnceWith('new');
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('does not navigate when a detached scope finishes prefetching', async () => {
        let finish!: () => void;
        prepareProduct = () => new Promise<void>(resolve => (finish = resolve));
        act(() => root.render(<Harness />));
        act(() => value.navigate({ name: 'product', id: 'old' }));
        act(() => root.render(null));
        act(() => {
            void router.navigate({ to: '/account' });
        });
        await act(async () => {
            finish();
            await Promise.resolve();
        });
        expect(router.state.location.pathname).toBe('/account');
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('opens a content product target and ignores empty targets', () => {
        act(() => root.render(<Harness />));
        act(() => value.openContentTarget('PRODUCT', ' product-a '));
        expect(router.navigate).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: '/product', search: expect.objectContaining({ id: 'product-a' }) }),
        );
        router.navigate.mockClear();
        act(() => value.openContentTarget('NONE', 'product-a'));
        act(() => value.openContentTarget('PRODUCT', '   '));
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens configured support and legacy page targets through the current router', () => {
        act(() => root.render(<Harness />));
        act(() => value.openContentTarget('SUPPORT', '#/support'));
        expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/support' }));
        act(() => value.openContentTarget('PAGE', '/cart'));
        expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/cart' }));
    });
});
