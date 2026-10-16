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

    it.each([
        { publicPath: '/zh/category', language: 'zh', suppliedLanguage: 'en' },
        { publicPath: '/en/category', language: 'en', suppliedLanguage: 'zh' },
        { publicPath: '/category', language: null, suppliedLanguage: 'zh' },
    ])(
        'derives hidden route ownership from $publicPath and strips internal fields on output',
        ({ publicPath, language, suppliedLanguage }) => {
            const url = new URL(publicPath, 'https://example.test');
            url.searchParams.set('collectionId', 'parent');
            url.searchParams.set('page', '2');
            url.searchParams.set('sort', 'price-asc');
            url.searchParams.append('__route', '/checkout');
            url.searchParams.append('__route', '/account');
            url.searchParams.set('__storefrontLanguage', suppliedLanguage);
            url.hash = '#offers';

            const input = publicRouteRewrite.input({ url });
            expect(input.pathname).toBe('/category');
            expect(input.searchParams.getAll('__route')).toEqual(['/category']);
            expect(input.searchParams.get('__storefrontLanguage')).toBe(language);
            expect(input.searchParams.get('collectionId')).toBe('parent');
            expect(input.searchParams.get('page')).toBe('2');
            expect(input.searchParams.get('sort')).toBe('price-asc');

            const output = publicRouteRewrite.output({ url: new URL(input) });
            expect(output.pathname).toBe(publicPath);
            expect(output.searchParams.has('__route')).toBe(false);
            expect(output.searchParams.has('__storefrontLanguage')).toBe(false);
            expect(Object.fromEntries(output.searchParams)).toEqual({
                collectionId: 'parent',
                page: '2',
                sort: 'price-asc',
            });
            expect(output.hash).toBe('#offers');
        },
    );

    it('rebinds retained search to the actual destination when navigation uses search true', async () => {
        const root = createRootRoute();
        const product = createRoute({
            getParentRoute: () => root,
            path: '/product',
            validateSearch: normalizeRouteSearch,
        });
        const services = createRoute({
            getParentRoute: () => root,
            path: '/services',
            validateSearch: normalizeRouteSearch,
        });
        const router = createRouter({
            routeTree: root.addChildren([product, services]),
            history: createMemoryHistory({
                initialEntries: ['/zh/product?id=p-1&__route=%2Fcheckout&__storefrontLanguage=en'],
            }),
            rewrite: publicRouteRewrite,
        });
        await router.load();
        expect(router.state.location.search).toMatchObject({
            id: 'p-1',
            __route: '/product',
            __storefrontLanguage: 'zh',
        });
        expect(router.state.matches.at(-1)?.search).toMatchObject({ __route: '/product' });

        await router.navigate({ to: '/services', search: true });
        expect(router.state.location.pathname).toBe('/services');
        expect(router.state.location.search).toMatchObject({
            id: 'p-1',
            __route: '/services',
            __storefrontLanguage: 'zh',
        });
        expect(router.state.matches.at(-1)?.search).toMatchObject({ __route: '/services' });
        const publicUrl = new URL(router.history.location.href, 'https://example.test');
        expect(publicUrl.pathname).toBe('/zh/services');
        expect(Object.fromEntries(publicUrl.searchParams)).toEqual({ id: 'p-1' });
    });

    it('retains the hidden route for router ownership without exposing it in business route state', () => {
        const normalized = normalizeRouteSearch({
            __route: '/checkout',
            __storefrontLanguage: 'en',
            id: 'p-1',
            page: '2',
            collectionId: 'parent',
            sort: 'price-asc',
        });
        expect(normalized).toMatchObject({ __route: '/checkout', __storefrontLanguage: 'en' });
        const route = routeFromRouterLocation('/product', normalized);
        expect(route).toMatchObject({
            name: 'product',
            publicLanguage: 'en',
            id: 'p-1',
            page: 2,
            collectionId: 'parent',
            sort: 'price-asc',
        });
        expect(route).not.toHaveProperty('__route');
        expect(route).not.toHaveProperty('__storefrontLanguage');
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
