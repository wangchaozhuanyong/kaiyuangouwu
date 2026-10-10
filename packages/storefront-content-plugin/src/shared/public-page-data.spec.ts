import { describe, expect, it } from 'vitest';

import {
    canonicalPublicPageRequest,
    publicLanguageFromUrl,
    publicLocalizedHref,
    publicPageDataSearchParams,
    publicPageRequestFromUrl,
    publicPageRequestKey,
    publicPageRouteHref,
    storefrontNavigationCollections,
} from './public-page-data';

describe('canonical public route requests', () => {
    it('keeps language authority and entity identity in public URLs while leaving private routes alone', () => {
        expect(publicLanguageFromUrl('/zh/product?id=p-1')).toBe('zh_Hans');
        expect(publicLanguageFromUrl('/en/guides/product-help')).toBe('en');
        expect(publicLanguageFromUrl('/zh/account')).toBeUndefined();
        expect(publicLocalizedHref('/zh/product?id=p-1&utm_source=ad', 'en')).toBe(
            '/en/product?id=p-1&utm_source=ad',
        );
        expect(publicLocalizedHref('/account?tab=orders', 'en')).toBe('/account?tab=orders');
        expect(publicPageRequestFromUrl('/zh/product?id=p-1')).toEqual({ kind: 'product', id: 'p-1' });
        expect(publicPageRequestFromUrl('/en/guides/product-help')).toEqual({
            kind: 'article',
            id: 'product-help',
        });
        expect(publicPageRequestFromUrl('/zh/legal?id=terms')).toEqual({ kind: 'page', id: 'terms' });
        expect(publicPageDataSearchParams({ kind: 'article', id: 'product-help' }).get('id')).toBe(
            'product-help',
        );
    });

    it('round-trips catalog page identity without collapsing page two to page one', () => {
        const request = publicPageRequestFromUrl('/en/category?collectionId=cat&page=3');
        if (!request) throw new Error('Expected a public catalog request');
        expect(request).toMatchObject({
            kind: 'catalog',
            input: { collectionId: 'cat', skip: 24, take: 12 },
        });
        expect(publicPageRouteHref(request)).toBe('/category?collectionId=cat&page=3');
        expect(publicPageRequestFromUrl(publicPageRouteHref(request))).toEqual(request);
        for (const value of ['0', '-1', '1.5', 'Infinity', '100000']) {
            expect(() => publicPageRequestFromUrl(`/category?page=${value}`)).toThrow();
        }
    });
    it('preserves bounded arbitrary API offsets and page sizes with explicit query parameters', () => {
        for (const input of [
            { take: 2, skip: 1 },
            { take: 24, skip: 24 },
            { take: 12, skip: 1 },
        ]) {
            const request = canonicalPublicPageRequest({ kind: 'catalog', input });
            const href = publicPageRouteHref(request);
            expect(publicPageRequestFromUrl(href)).toEqual(request);
            expect(href).toContain(`skip=${input.skip}`);
            expect(href).toContain(`take=${input.take}`);
        }
        for (const query of ['take=0', 'take=49', 'skip=-1', 'skip=100001', 'skip=1.5', 'page=2&skip=1'])
            expect(() => publicPageRequestFromUrl(`/category?${query}`)).toThrow();
    });
    it('preserves the router legacy collection, child and stock aliases', () => {
        expect(publicPageRequestFromUrl('/category?collection=parent&child=child&stock=1')).toEqual(
            publicPageRequestFromUrl('/category?collectionId=parent&childId=child&inStockOnly=true'),
        );
        expect(
            publicPageRequestFromUrl('/category?collectionId=&collection=parent&childId=&child=child'),
        ).toEqual(publicPageRequestFromUrl('/category?collectionId=parent&childId=child'));
    });
    it('normalizes equivalent defaults, key order and trimmed search into one identity', () => {
        expect(publicPageRequestKey({ kind: 'catalog', input: { term: '  phone  ' } })).toBe(
            publicPageRequestKey({
                kind: 'catalog',
                path: '/category',
                input: {
                    take: 12,
                    skip: 0,
                    sort: 'RECOMMENDED',
                    inStockOnly: false,
                    term: 'phone',
                },
            }),
        );
        expect(publicPageRequestKey({ kind: 'catalog', path: '/search', input: { term: 'phone' } })).not.toBe(
            publicPageRequestKey({ kind: 'catalog', input: { term: 'phone' } }),
        );
    });

    it('uses current category child, sort and money semantics and discards private parameters', () => {
        const request = publicPageRequestFromUrl(
            '/category?collectionId=parent&childId=child&sort=price-desc&minPrice=12.345&fulfillment=digital&inStockOnly=true&token=private',
        );
        expect(request).toEqual({
            kind: 'catalog',
            path: '/category',
            input: {
                collectionId: 'child',
                sort: 'PRICE_DESC',
                fulfillmentType: 'DIGITAL',
                inStockOnly: true,
                minPriceWithTax: 1235,
                skip: 0,
                take: 12,
            },
        });
        expect(JSON.stringify(request)).not.toContain('private');
        expect(publicPageRequestFromUrl('/account?token=private')).toBeUndefined();
        expect(publicPageRequestFromUrl('//elsewhere.test/product?id=p')).toBeUndefined();
    });

    it('keeps actual detail URLs and search locations round-trippable', () => {
        const request = publicPageRequestFromUrl('/product?id=p-1&variantId=v1');
        expect(request).toEqual({ kind: 'product', id: 'p-1' });
        expect(publicPageRouteHref(request as { kind: 'product'; id: string })).toBe('/product?id=p-1');
        const search = publicPageRequestFromUrl('/search?term=phone&sort=newest');
        expect(search?.kind).toBe('catalog');
        if (!search) throw new Error('Missing test route');
        expect(publicPageRequestFromUrl(publicPageRouteHref(search))).toEqual(search);
        expect(
            publicPageDataSearchParams(search, { languageCode: 'en', currencyCode: 'MYR' }).get('path'),
        ).toBe('/search');
    });

    it.each([
        { kind: 'product', id: '../private' },
        { kind: 'catalog', input: { take: 49 } },
        { kind: 'catalog', input: { skip: 100_001 } },
        { kind: 'catalog', input: { minPriceWithTax: -1 } },
        { kind: 'catalog', input: { sort: 'unsafe' } },
        { kind: 'catalog', input: {}, path: '/account' },
    ])('rejects invalid or unbounded inputs: %j', input => {
        expect(() => canonicalPublicPageRequest(input as never)).toThrow();
    });
});

describe('public navigation visibility', () => {
    it('shares the existing empty, image and child rules without mutating source categories', () => {
        const items = [
            {
                id: 'empty',
                productVariantCount: 0,
                children: [{ id: 'empty-child', productVariantCount: 0 }],
            },
            {
                id: 'image',
                productVariantCount: 0,
                featuredAsset: { preview: ' /assets/preview/category.png ' },
            },
            {
                id: 'child',
                productVariantCount: 0,
                children: [
                    { id: 'filled', productVariantCount: 2 },
                    { id: 'empty-child', productVariantCount: 0 },
                ],
            },
            { id: 'legacy', children: null },
        ];
        const visible = storefrontNavigationCollections(items);
        expect(visible.map(item => item.id)).toEqual(['image', 'child', 'legacy']);
        expect(visible[1].children?.map(item => item.id)).toEqual(['filled']);
        expect(items[2].children).toHaveLength(2);
    });
});
