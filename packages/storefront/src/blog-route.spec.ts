import { describe, expect, it } from 'vitest';

import {
    canonicalPublicPageRequest,
    publicLocalizedHref,
    publicPageRequestFromUrl,
    publicPageRequestKey,
    publicPageRouteHref,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { routeFromRouterLocation, routeHref, routeNavigateOptions } from './storefront-router';
describe('news blog route identity', () => {
    it('links every blog entry to the available Chinese publication from either storefront language', () => {
        for (const publicLanguage of ['zh', 'en'] as const) {
            expect(routeHref({ name: 'blog', publicLanguage })).toBe('/zh/blog');
            expect(routeHref({ name: 'blog-article', id: 'official-update', publicLanguage })).toBe(
                '/zh/blog/official-update',
            );
            expect(routeNavigateOptions({ name: 'blog', publicLanguage }).search).toMatchObject({
                __storefrontLanguage: 'zh',
            });
        }
    });
    it('round-trips Chinese filters and pagination without retaining unrelated secrets', () => {
        const request = publicPageRequestFromUrl('/zh/blog?term=中文&category=claude&page=2&token=private');
        if (!request) throw new Error('Expected blog request');
        expect(request).toEqual({
            kind: 'blog',
            input: { term: '中文', category: 'claude', skip: 12, take: 12 },
        });
        const href = publicLocalizedHref(publicPageRouteHref(request), 'zh_Hans');
        expect(routeHref(routeFromRouterLocation('/zh/blog', { category: 'claude', page: 2 }))).toBe(
            '/zh/blog?page=2&category=claude',
        );
        expect(publicPageRequestFromUrl('/zh/blog?category=skills')).toMatchObject({
            kind: 'blog',
            input: { category: 'skills' },
        });
        expect(href).not.toContain('token');
        const roundTrip = publicPageRequestFromUrl(href);
        if (!roundTrip) throw new Error('Expected round-trip request');
        expect(publicPageRequestKey(roundTrip)).toBe(publicPageRequestKey(request));
        expect(() => canonicalPublicPageRequest({ kind: 'blog', input: { skip: 1 } })).toThrow();
        expect(() => canonicalPublicPageRequest({ kind: 'blog', input: { category: 'invalid' } })).toThrow();
    });
    it('keeps article slug and language in the path without duplicate id query parameters', () => {
        const route = routeFromRouterLocation('/zh/blog/official-update', {});
        expect(route.name).toBe('blog-article');
        expect(route.id).toBe('official-update');
        expect(routeHref(route)).toBe('/zh/blog/official-update');
        expect(routeNavigateOptions(route)).toMatchObject({
            to: '/blog/$slug',
            params: { slug: 'official-update' },
            search: { id: undefined },
        });
        expect(publicPageRequestFromUrl('/zh/guides/existing-guide')).toEqual({
            kind: 'article',
            id: 'existing-guide',
        });
    });
});
