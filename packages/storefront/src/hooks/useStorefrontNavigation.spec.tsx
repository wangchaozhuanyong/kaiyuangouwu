// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CollectionSummary } from '../types';

import { useStorefrontNavigation } from './useStorefrontNavigation';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = vi.hoisted(() => ({
    navigate: vi.fn(),
    back: vi.fn(),
    state: {
        location: { pathname: '/category', search: {}, searchStr: '' },
        resolvedLocation: { pathname: '/category', search: {}, searchStr: '' },
        status: 'idle',
    },
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => router.navigate,
    useRouter: () => ({ history: { back: router.back } }),
    useRouterState: ({ select }: { select: (state: typeof router.state) => unknown }) => select(router.state),
}));

describe('storefront navigation state', () => {
    let root: ReturnType<typeof createRoot>;
    let value: ReturnType<typeof useStorefrontNavigation>;
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
        value = useStorefrontNavigation({ collections });
        return null;
    }
    beforeEach(() => {
        router.navigate.mockClear();
        router.state.location = { pathname: '/category', search: {}, searchStr: '' };
        router.state.resolvedLocation = router.state.location;
        router.state.status = 'idle';
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => act(() => root.unmount()));

    it('uses the loaded category default and keeps filters when returning to categories', () => {
        act(() => root.render(<Harness />));
        expect(value.activeCollectionId).toBe('first');
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
});
