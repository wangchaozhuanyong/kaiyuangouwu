// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { publicRouteRewrite } from './public-route-rewrite';
import { normalizeRouteSearch, routeFromRouterLocation, routeHref } from './storefront-router';

afterEach(() => window.history.replaceState({}, '', '/'));
describe('shared public language routing', () => {
    it('maps a public prefix to one existing route tree and emits its language URL without internal query fields', async () => {
        const root = createRootRoute();
        const product = createRoute({
            getParentRoute: () => root,
            path: '/product',
            validateSearch: normalizeRouteSearch,
        });
        const account = createRoute({
            getParentRoute: () => root,
            path: '/account',
            validateSearch: normalizeRouteSearch,
        });
        const router = createRouter({
            routeTree: root.addChildren([product, account]),
            history: createMemoryHistory({ initialEntries: ['/zh/product?id=p-1'] }),
            rewrite: publicRouteRewrite,
        });
        await router.load();
        expect(router.state.location.pathname).toBe('/product');
        expect(
            routeFromRouterLocation(router.state.location.pathname, router.state.location.search),
        ).toMatchObject({ name: 'product', publicLanguage: 'zh', id: 'p-1' });
        await router.navigate({ to: '/product', search: { id: 'p-2', __storefrontLanguage: 'en' } });
        expect(router.history.location.href).toBe('/en/product?id=p-2');
        await router.navigate({ to: '/account' });
        expect(router.history.location.pathname).toBe('/account');
    });

    it('preserves entity and page identity when building canonical public links', () => {
        window.history.replaceState({}, '', '/zh/category?collectionId=parent&page=2');
        expect(routeHref({ name: 'product', id: 'p-1' })).toBe('/zh/product?id=p-1');
        expect(routeHref({ name: 'category', collectionId: 'parent', page: 2 })).toBe(
            '/zh/category?page=2&collectionId=parent',
        );
        expect(routeHref({ name: 'guide', id: 'help', publicLanguage: 'en' })).toBe('/en/guides/help');
        expect(routeHref({ name: 'account' })).toBe('/account');
        expect(publicRouteRewrite.input({ url: new URL('https://example.test/zh/account') }).pathname).toBe(
            '/zh/account',
        );
    });
});
