import { buildBestSellerProducts, mediaDescriptor } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import {
    preservePublicMediaPreviews,
    PUBLIC_MEDIA_USES,
    publicContentImageKinds,
    publicHeroMobileImage,
    publicMediaPreviewPlan,
    publicMediaWithPreviews,
    publicPageMedia,
} from './storefront-public-media';

function page(data: Record<string, unknown> = {}) {
    return {
        scope: {
            host: 'shop.example',
            channelCode: 'a',
            languageCode: 'en',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        config: {},
        generatedAt: Date.parse('2026-10-16T12:00:00Z'),
        ...data,
    } as any;
}
const sources = (media: ReturnType<typeof publicPageMedia>, kind: string) =>
    media.filter(item => item.kind === kind).map(item => item.identity);

describe('public page media projection', () => {
    it.each(['/category', '/search'])('reserves previews for all twelve current cards on %s', async path => {
        const products = Array.from({ length: 12 }, (_, index) => ({
            id: String(index),
            featuredAsset: { preview: `/assets/preview/product-${index}.webp?v=2` },
        }));
        const data = page({
            request: { kind: 'catalog', path, input: { take: 12 } },
            config: {
                logoUrl: '/assets/preview/logo.webp',
                logoOnDarkUrl: '/assets/preview/other-logo.webp',
            },
            content: {
                blocks: [
                    {
                        type: 'QUICK_LINKS',
                        items: Array.from({ length: 8 }, (_, index) => ({
                            imageUrl: `/assets/preview/shortcut-${index}.webp`,
                        })),
                    },
                ],
            },
            catalog: { items: products, totalItems: 15 },
        });
        const plan = publicMediaPreviewPlan(data, publicPageMedia(data), [
            mediaDescriptor(products[0].featuredAsset.preview, 'card'),
        ]);
        const read = vi.fn(() => Promise.resolve('data:image/webp;base64,' + 'A'.repeat(487)));
        const result = await publicMediaWithPreviews(
            plan.media,
            data.scope.host,
            () => Promise.resolve(true),
            read,
            250,
            undefined,
            data.config.logoUrl,
            plan.assetLimit,
        );
        const cards = result.filter(item => item.kind === 'card' && item.identity.includes('product-'));
        expect(cards).toHaveLength(12);
        expect(cards.every(item => item.placeholder?.inlineData.length === 510)).toBe(true);
        expect(
            cards.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(6144);
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(read).toHaveBeenCalledTimes(13);
        expect(read.mock.calls.flat().some(value => String(value).includes('shortcut'))).toBe(false);
        expect(result.find(item => item.identity.includes('other-logo'))?.placeholder).toBeUndefined();
    });

    it('keeps home art direction before current product previews and decoration after them', () => {
        const data = page({
            request: { kind: 'home' },
            products: [{ id: 'p', featuredAsset: { preview: '/assets/preview/product.webp' } }],
            content: {
                blocks: [
                    {
                        type: 'HERO',
                        imageUrl: '/assets/preview/hero.webp',
                        settings: { mobileImageUrl: '/assets/preview/mobile.webp' },
                    },
                    { type: 'QUICK_LINKS', items: [{ imageUrl: '/assets/preview/shortcut.webp' }] },
                ],
            },
        });
        const plan = publicMediaPreviewPlan(data, publicPageMedia(data), [
            mediaDescriptor('/assets/preview/mobile.webp', 'hero'),
            mediaDescriptor('/assets/preview/hero.webp', 'hero'),
        ]);
        expect(plan.media.slice(0, 3).map(item => [item.identity, item.kind])).toEqual([
            ['/assets/preview/mobile.webp', 'hero'],
            ['/assets/preview/hero.webp', 'hero'],
            ['/assets/preview/product.webp', 'card'],
        ]);
        expect(plan.assetLimit).toBe(3);
    });
    it('includes all existing config logos, content items, collection children, product lists, galleries, variants and flash-sale media', () => {
        const media = publicPageMedia(
            page({
                config: {
                    logoUrl: 'preview/logo.png',
                    logoOnLightUrl: '/assets/preview/logo.png',
                    logoOnDarkUrl: '/assets/preview/dark.png',
                },
                content: {
                    blocks: [
                        { type: 'SUPPORT', imageUrl: '/assets/preview/support.png' },
                        {
                            type: 'HERO',
                            imageUrl: '/assets/preview/hero.png',
                            items: [{ imageUrl: '/assets/preview/slide.png' }],
                        },
                        { type: 'AUTH_LOGIN', imageUrl: '/assets/preview/login.png' },
                        { type: 'QUICK_LINKS', items: [{ imageUrl: '/assets/preview/quick.png' }] },
                    ],
                },
                collections: [
                    {
                        featuredAsset: { preview: '/assets/preview/parent.png' },
                        children: [{ featuredAsset: { preview: '/assets/preview/child.png' } }],
                    },
                ],
                products: [
                    {
                        featuredAsset: { preview: '/assets/preview/list.png' },
                        variants: [{ featuredAsset: { preview: '/assets/preview/list-variant.png' } }],
                    },
                ],
                catalog: {
                    items: [{ featuredAsset: { preview: '/assets/preview/catalog.png' } }],
                    totalItems: 1,
                },
                product: {
                    featuredAsset: { preview: '/assets/preview/detail.png' },
                    assets: [{ preview: '/assets/preview/gallery.png' }],
                    variants: [
                        {
                            featuredAsset: { preview: '/assets/preview/detail-variant.png' },
                            product: { featuredAsset: { preview: '/assets/preview/detail.png' } },
                        },
                    ],
                },
                flashSales: [{ items: [{ imageUrl: '/assets/preview/sale.png' }] }],
            }),
        );
        expect(sources(media, 'hero')[0]).toBe('/assets/preview/hero.png');
        expect(sources(media, 'hero')).toContain('/assets/preview/slide.png');
        expect(sources(media, 'detail')).toEqual(
            expect.arrayContaining([
                '/assets/preview/login.png',
                '/assets/preview/detail.png',
                '/assets/preview/gallery.png',
                '/assets/preview/detail-variant.png',
            ]),
        );
        expect(sources(media, 'card')).toEqual(
            expect.arrayContaining([
                '/assets/preview/list.png',
                '/assets/preview/list-variant.png',
                '/assets/preview/catalog.png',
                '/assets/preview/sale.png',
            ]),
        );
        expect(sources(media, 'icon')).toEqual(
            expect.arrayContaining([
                '/assets/preview/quick.png',
                '/assets/preview/parent.png',
                '/assets/preview/child.png',
            ]),
        );
        expect(
            sources(media, 'thumbnail').filter(source => source === '/assets/preview/logo.png'),
        ).toHaveLength(1);
        expect(media.find(item => item.identity === '/assets/preview/logo.png')).toMatchObject({
            sizes: '36px',
            width: 36,
            height: 36,
        });
    });
    it('deduplicates normalized relative/absolute asset identities within each use, preserving distinct gallery and card uses', () => {
        const media = publicPageMedia(
            page({
                products: [{ featuredAsset: { preview: 'preview/same.png' } }],
                catalog: {
                    items: [{ featuredAsset: { preview: 'https://shop.example/assets/preview/same.png' } }],
                    totalItems: 1,
                },
                product: {
                    featuredAsset: { preview: '/assets/preview/same.png' },
                    assets: [{ preview: 'preview/same.png' }],
                },
                flashSales: [{ items: [{ imageUrl: '/assets/preview/same.png' }] }],
            }),
        );
        expect(media.map(item => item.kind)).toEqual(['card', 'thumbnail', 'detail']);
        expect(media.find(item => item.kind === 'detail')).toEqual(
            mediaDescriptor('/assets/preview/same.png', 'detail'),
        );
    });
    it('retains explicit versions, skips absent or disabled content, and never inspects unrelated fields', () => {
        const media = publicPageMedia(
            page({
                config: { privateImageUrl: '/assets/preview/private.png' },
                content: {
                    blocks: [
                        { type: 'HERO', enabled: false, imageUrl: '/assets/preview/disabled.png' },
                        {
                            type: 'AUTH_REGISTER',
                            imageUrl: '/assets/preview/auth__webp_migrated_1.webp',
                            items: [{ enabled: false, imageUrl: '/assets/preview/disabled-item.png' }],
                        },
                    ],
                },
                products: [
                    { featuredAsset: null },
                    { featuredAsset: { preview: '/assets/preview/auth__webp_migrated_1.webp?v=new' } },
                ],
            }),
        );
        expect(media.map(item => item.identity)).not.toEqual(
            expect.arrayContaining([
                '/assets/preview/private.png',
                '/assets/preview/disabled.png',
                '/assets/preview/disabled-item.png',
            ]),
        );
        expect(media.find(item => item.kind === 'detail')?.version).toBe('webp-readable-1');
        expect(media.find(item => item.kind === 'card')?.version).toBe('new');
        expect(publicPageMedia(page())).toEqual([]);
    });
    it('uses the same shared purpose mapping for page descriptors and queued preparation', () => {
        expect(publicContentImageKinds('AUTH_LOGIN', 'block')).toEqual(['detail']);
        expect(publicContentImageKinds('AUTH_REGISTER', 'item')).toEqual(['detail']);
        expect(publicContentImageKinds('HERO', 'item')).toEqual(['hero']);
        expect(publicContentImageKinds('QUICK_LINKS', 'item')).toContain('icon');
        expect(PUBLIC_MEDIA_USES.collection).toEqual(['thumbnail', 'icon']);
        expect(PUBLIC_MEDIA_USES.productDetail).toEqual(['detail', 'thumbnail']);
    });
    it('adds an explicitly published phone HERO and intrinsic dimensions without replacing desktop media', () => {
        const block = {
            type: 'HERO',
            enabled: true,
            imageUrl: '/assets/preview/desktop.webp',
            settings: {
                mobileImageUrl: '/assets/preview/phone.webp?v=2',
                mobileImageWidth: 1200,
                mobileImageHeight: 900,
            },
        };
        const media = publicPageMedia(page({ content: { blocks: [block] } }));
        expect(sources(media, 'hero')).toEqual([
            '/assets/preview/desktop.webp',
            '/assets/preview/phone.webp?v=2',
        ]);
        expect(media[1]).toMatchObject({ kind: 'hero', width: 1200, height: 900, version: '2' });
        expect(block.imageUrl).toBe('/assets/preview/desktop.webp');
        block.settings.mobileImageUrl = '';
        expect(sources(publicPageMedia(page({ content: { blocks: [block] } })), 'hero')).toEqual([
            '/assets/preview/desktop.webp',
        ]);
    });
    it('includes only phone bindings consumed by services and device-poster layouts', () => {
        const blocks = [
            {
                type: 'CLIENT_PLUGINS',
                imageUrl: '/assets/preview/service.webp',
                settings: { mobileImageUrl: '/assets/preview/service-phone.webp' },
            },
            {
                type: 'CLIENT_PLUGINS',
                settings: {
                    mobileImageUrl: '/assets/preview/ignored.webp',
                    businessServicesHeroLayout: 'shared-banner',
                },
            },
            {
                type: 'CATEGORY_AD',
                settings: {
                    mobileImageUrl: '/assets/preview/category-phone.webp',
                    categoryArtworkLayout: 'device-poster',
                },
            },
            {
                type: 'CATEGORY_AD',
                settings: {
                    mobileImageUrl: '/assets/preview/ignored-poster.webp',
                    categoryArtworkLayout: 'scene-poster',
                },
            },
        ];
        const media = publicPageMedia(page({ content: { blocks } }));
        expect(sources(media, 'hero')).toEqual([
            '/assets/preview/service.webp',
            '/assets/preview/service-phone.webp',
            '/assets/preview/category-phone.webp',
        ]);
    });
    it.each([
        ['HERO', false, '/assets/preview/phone.webp'],
        ['SUPPORT', true, '/assets/preview/phone.webp'],
        ['HERO', true, 'https://other.example/assets/preview/phone.webp'],
        ['HERO', true, '/assets/cache/phone.webp'],
        ['HERO', true, '/assets/preview/%2e%2e/private.webp'],
        ['HERO', true, 'https://user:secret@shop.example/assets/preview/phone.webp'],
    ] as const)('does not project a phone binding from %s/%s/%s', (type, enabled, mobileImageUrl) => {
        const block = { type, enabled, settings: { mobileImageUrl } };
        expect(publicHeroMobileImage(block, 'https://shop.example')).toBeUndefined();
        expect(publicPageMedia(page({ content: { blocks: [block] } }))).toEqual([]);
    });
});

describe('bounded public inline image assembly', () => {
    const preview = `data:image/webp;base64,${'A'.repeat(960)}`;
    it('keeps the complete first shortcut row ahead of later products in the eight-asset preview budget', async () => {
        const apple = '/assets/preview/apple.webp';
        const products = [
            { id: 'apple-20', featuredAsset: { preview: apple } },
            { id: 'apple-100', featuredAsset: { preview: apple } },
            { id: 'google', featuredAsset: { preview: '/assets/preview/google.webp' } },
            { id: 'token', featuredAsset: { preview: '/assets/preview/token.webp' } },
        ];
        const media = publicPageMedia(
            page({
                request: { kind: 'home' },
                products,
                bestSellers: {
                    pinnedProducts: products.slice(0, 2),
                    salesByProductId: {},
                    catalog: { items: products },
                },
                content: {
                    blocks: [
                        {
                            type: 'HERO',
                            imageUrl: '/assets/preview/hero.webp',
                            settings: { mobileImageUrl: '/assets/preview/phone.webp' },
                        },
                        {
                            type: 'QUICK_LINKS',
                            items: [
                                { enabled: false, imageUrl: '/assets/preview/disabled-quick.webp' },
                                ...Array.from({ length: 6 }, (_, index) => ({
                                    imageUrl: `/assets/preview/quick-${index}.webp`,
                                })),
                            ],
                        },
                        {
                            type: 'CATEGORY_AD',
                            settings: { selectedProductIds: ['apple-20', 'apple-100'] },
                        },
                        { type: 'BEST_SELLERS', settings: { displayCount: 4 } },
                    ],
                },
            }),
        );
        let active = 0;
        let peak = 0;
        const read = vi.fn(async (_path: string) => {
            peak = Math.max(peak, ++active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            return preview;
        });
        const authorize = vi.fn((_path: string) => Promise.resolve(true));
        const preparation = { deferred: true };
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            authorize,
            read,
            250,
            preparation,
        );
        const expected = [
            'preview/hero.webp',
            'preview/phone.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/apple.webp',
        ];
        expect(read.mock.calls.map(call => call[0])).toEqual(expected);
        expect(authorize.mock.calls.map(call => call[0])).toEqual(expected);
        expect(read).toHaveBeenCalledTimes(8);
        expect(peak).toBe(2);
        expect(preparation.deferred).toBe(false);
        for (let index = 0; index < 5; index++) {
            expect(
                result.find(
                    item => item.identity === `/assets/preview/quick-${index}.webp` && item.kind === 'icon',
                )?.placeholder,
            ).toEqual({ inlineData: preview });
            expect(
                result.find(
                    item =>
                        item.identity === `/assets/preview/quick-${index}.webp` && item.kind === 'thumbnail',
                )?.placeholder,
            ).toBeUndefined();
        }
        expect(result.find(item => item.identity === apple && item.kind === 'card')?.placeholder).toEqual({
            inlineData: preview,
        });
        for (const name of ['google', 'token', 'quick-5'])
            expect(
                result.find(item => item.identity === `/assets/preview/${name}.webp`)?.placeholder,
            ).toBeUndefined();
        expect(result.filter(item => item.placeholder)).toHaveLength(8);
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(result.map(({ placeholder: _placeholder, ...item }) => item)).toEqual(media);
        expect(media.every(item => !item.placeholder)).toBe(true);
    });
    it.each<{ name: string; sales: Record<string, number> }>([
        { name: 'sales-ranked b3 before b2', sales: { b0: 0, b1: 0, b2: 20, b3: 30 } },
        { name: 'daily stable shuffle with no sales', sales: {} },
    ])('prioritizes the actual $name display order rather than raw catalog order', async ({ sales }) => {
        const fixture = page({
            request: { kind: 'home' },
            generatedAt: Date.parse('2026-10-16T12:00:00Z'),
            products: Array.from({ length: 2 }, (_, index) => ({
                id: `d${index}`,
                featuredAsset: { preview: `/assets/preview/desktop-${index}.webp` },
            })),
            bestSellers: {
                pinnedProducts: [],
                salesByProductId: sales,
                catalog: {
                    items: Array.from({ length: 4 }, (_, index) => ({
                        id: `b${index}`,
                        featuredAsset: { preview: `/assets/preview/best-${index}.webp` },
                    })),
                },
            },
            content: {
                blocks: [
                    {
                        type: 'HERO',
                        imageUrl: '/assets/preview/hero.webp',
                        settings: { mobileImageUrl: '/assets/preview/phone.webp' },
                    },
                    {
                        type: 'QUICK_LINKS',
                        items: Array.from({ length: 5 }, (_, index) => ({
                            imageUrl: `/assets/preview/quick-${index}.webp`,
                        })),
                    },
                    { type: 'CATEGORY_AD', settings: { selectedProductIds: ['d0', 'd1'] } },
                ],
            },
        });
        const actualFirstRow = buildBestSellerProducts({
            pinnedProducts: fixture.bestSellers.pinnedProducts,
            candidates: fixture.bestSellers.catalog.items,
            salesByProductId: sales,
            count: 4,
            seed: 'a:2026-10-16:best-sellers',
        }).slice(0, 2);
        if (Object.keys(sales).length) expect(actualFirstRow.map(item => item.id)).toEqual(['b3', 'b2']);
        const read = vi.fn().mockResolvedValue(preview);
        const media = publicPageMedia(fixture);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read.mock.calls.map(call => call[0])).toEqual([
            'preview/hero.webp',
            'preview/phone.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/desktop-0.webp',
        ]);
        expect(
            sources(media, 'card')
                .filter(source => source.includes('/best-'))
                .slice(0, 2),
        ).toEqual(actualFirstRow.map(item => `/assets/preview/best-${item.id.slice(1)}.webp`));
        for (const item of actualFirstRow)
            expect(
                result.find(
                    descriptor =>
                        descriptor.identity.endsWith(`best-${item.id.slice(1)}.webp`) &&
                        descriptor.kind === 'card',
                )?.placeholder,
            ).toBeUndefined();
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
    });
    it.each([
        { generatedAt: '2026-10-16T00:30:00+08:00', expected: 'very-long-product-id' },
        { generatedAt: '2026-10-16T12:00:00Z', expected: 'aaa' },
    ])(
        'uses the snapshot UTC day and published displayCount for $generatedAt',
        async ({ generatedAt, expected }) => {
            const items = [
                'apple-2026',
                'b',
                'very-long-product-id',
                'service-codex',
                'aa',
                'ccc',
                '6257',
                '1',
                'z',
                'aaa',
                '0',
            ].map(id => ({ id, featuredAsset: { preview: `/assets/preview/${id}.webp` } }));
            const media = publicPageMedia(
                page({
                    request: { kind: 'home' },
                    generatedAt: Date.parse(generatedAt),
                    bestSellers: { pinnedProducts: [], salesByProductId: {}, catalog: { items } },
                    content: {
                        blocks: [
                            {
                                type: 'HERO',
                                imageUrl: '/assets/preview/hero.webp',
                                settings: { mobileImageUrl: '/assets/preview/phone.webp' },
                            },
                            {
                                type: 'QUICK_LINKS',
                                items: Array.from({ length: 5 }, (_, index) => ({
                                    imageUrl: `/assets/preview/quick-${index}.webp`,
                                })),
                            },
                            { type: 'BEST_SELLERS', settings: { displayCount: 1 } },
                        ],
                    },
                }),
            );
            const read = vi.fn().mockResolvedValue(preview);
            const result = await publicMediaWithPreviews(
                media,
                'shop.example',
                () => Promise.resolve(true),
                read,
            );
            expect(read.mock.calls.map(call => call[0])).toEqual([
                'preview/hero.webp',
                'preview/phone.webp',
                ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
                `preview/${expected}.webp`,
            ]);
            expect(
                result.find(
                    item => item.identity === `/assets/preview/${expected}.webp` && item.kind === 'card',
                )?.placeholder,
            ).toBeDefined();
            for (const item of items.filter(candidate => candidate.id !== expected))
                expect(
                    result.find(
                        descriptor =>
                            descriptor.identity === item.featuredAsset.preview && descriptor.kind === 'card',
                    )?.placeholder,
                ).toBeUndefined();
            expect(
                result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
            ).toBeLessThanOrEqual(8192);
        },
    );
    it('keeps selected first-row product order after the complete shortcut row within eight assets', async () => {
        const products = Array.from({ length: 4 }, (_, index) => ({
            id: `p${index}`,
            featuredAsset: { preview: `/assets/preview/product-${index}.webp?v=one` },
        }));
        const media = publicPageMedia(
            page({
                request: { kind: 'home' },
                products,
                content: {
                    blocks: [
                        ...Array.from({ length: 3 }, (_, index) => ({
                            type: 'HERO',
                            imageUrl: `/assets/preview/hero-${index}.webp`,
                            settings: {
                                mobileImageUrl: `/assets/preview/phone-${index}.webp`,
                                mobileImageWidth: 1200,
                                mobileImageHeight: 900,
                            },
                        })),
                        {
                            type: 'QUICK_LINKS',
                            items: Array.from({ length: 5 }, (_, index) => ({
                                imageUrl: `/assets/preview/quick-${index}.webp`,
                            })),
                        },
                        { type: 'CATEGORY_AD', settings: { selectedProductIds: ['p2', 'p0', 'p3', 'p1'] } },
                    ],
                },
            }),
        );
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read.mock.calls.map(call => call[0])).toEqual([
            'preview/hero-0.webp',
            'preview/phone-0.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/product-2.webp',
        ]);
        expect(
            result.find(
                item => item.identity === '/assets/preview/product-2.webp?v=one' && item.kind === 'card',
            )?.placeholder,
        ).toBeDefined();
        expect(
            result.find(
                item => item.identity === '/assets/preview/product-0.webp?v=one' && item.kind === 'card',
            )?.placeholder,
        ).toBeUndefined();
        expect(result.find(item => item.identity === '/assets/preview/phone-0.webp')).toMatchObject({
            width: 1200,
            height: 900,
            placeholder: { inlineData: preview },
        });
        expect(
            result.find(item => item.identity === '/assets/preview/hero-1.webp')?.placeholder,
        ).toBeUndefined();
        expect(
            result.filter(item => item.kind === 'card' && item.identity.includes('product-')),
        ).toHaveLength(4);
        expect(sources(media, 'card').filter(source => source.includes('product-'))).toEqual(
            [2, 0, 3, 1].map(index => `/assets/preview/product-${index}.webp?v=one`),
        );
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(result.map(({ placeholder: _placeholder, ...item }) => item)).toEqual(media);
    });
    it('spends wire bytes on one use per selected asset before duplicate kinds, including preserved previews', async () => {
        const media = [
            mediaDescriptor('/assets/preview/hero.webp', 'hero'),
            ...(['icon', 'thumbnail', 'card'] as const).map(kind =>
                mediaDescriptor('/assets/preview/quick.webp', kind),
            ),
            ...Array.from({ length: 6 }, (_, index) =>
                mediaDescriptor(`/assets/preview/product-${index}.webp`, 'card'),
            ),
        ];
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read).toHaveBeenCalledTimes(8);
        expect(
            result
                .filter(item => item.kind === 'card' && item.identity.includes('product-'))
                .every(item => item.placeholder),
        ).toBe(true);
        expect(
            result.find(item => item.identity.includes('quick') && item.kind === 'icon')?.placeholder,
        ).toBeDefined();
        expect(
            result.find(item => item.identity.includes('quick') && item.kind === 'card')?.placeholder,
        ).toBeUndefined();
        const old = media.map(item => ({ ...item, placeholder: { inlineData: preview } }));
        const preserved = preservePublicMediaPreviews(media, old, 'shop.example');
        expect(
            preserved
                .filter(item => item.kind === 'card' && item.identity.includes('product-'))
                .every(item => item.placeholder),
        ).toBe(true);
        expect(preserved.map(item => item.identity)).toEqual(media.map(item => item.identity));
        expect(
            preserved.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
    });
    it('retains four desktop products and previews the first two after one hero and the complete shortcut row', async () => {
        const media = publicPageMedia(
            page({
                request: { kind: 'home' },
                products: Array.from({ length: 4 }, (_, index) => ({
                    id: `p${index}`,
                    featuredAsset: { preview: `/assets/preview/product-${index}.webp` },
                })),
                content: {
                    blocks: [
                        ...Array.from({ length: 3 }, (_, index) => ({
                            type: 'HERO',
                            imageUrl: `/assets/preview/hero-${index}.webp`,
                        })),
                        {
                            type: 'QUICK_LINKS',
                            items: Array.from({ length: 5 }, (_, index) => ({
                                imageUrl: `/assets/preview/quick-${index}.webp`,
                            })),
                        },
                        {
                            type: 'CATEGORY_AD',
                            settings: { selectedProductIds: ['p0', 'p1', 'p2', 'p3'] },
                        },
                    ],
                },
            }),
        );
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read).toHaveBeenCalledTimes(8);
        const productMedia = result.filter(
            item => item.kind === 'card' && item.identity.includes('product-'),
        );
        expect(productMedia.map(item => item.identity)).toEqual(
            Array.from({ length: 4 }, (_, index) => `/assets/preview/product-${index}.webp`),
        );
        expect(productMedia.map(item => Boolean(item.placeholder))).toEqual([true, true, false, false]);
        expect(read.mock.calls.map(call => call[0])).toEqual([
            'preview/hero-0.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/product-0.webp',
            'preview/product-1.webp',
        ]);
        expect(read.mock.calls.map(call => call[0])).not.toContain('preview/hero-1.webp');
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
    });
    it('preserves distinct mobile best-seller and desktop managed order after the full shortcut row', async () => {
        const managed = Array.from({ length: 4 }, (_, index) => ({
            id: `d${index}`,
            featuredAsset: { preview: `/assets/preview/desktop-${index}.webp?v=desktop` },
        }));
        const best = Array.from({ length: 4 }, (_, index) => ({
            id: `b${index}`,
            featuredAsset: { preview: `/assets/preview/best-${index}.webp?v=mobile` },
        }));
        const media = publicPageMedia(
            page({
                request: { kind: 'home' },
                products: managed,
                bestSellers: {
                    pinnedProducts: [
                        {
                            ...best[0],
                            featuredAsset: {
                                preview: 'https://shop.example/assets/preview/best-0.webp?v=mobile',
                            },
                        },
                    ],
                    catalog: { items: best },
                },
                content: {
                    blocks: [
                        ...Array.from({ length: 3 }, (_, index) => ({
                            type: 'HERO',
                            imageUrl: `/assets/preview/hero-${index}.webp`,
                            settings: { mobileImageUrl: `/assets/preview/phone-${index}.webp` },
                        })),
                        {
                            type: 'QUICK_LINKS',
                            items: Array.from({ length: 5 }, (_, index) => ({
                                imageUrl: `/assets/preview/quick-${index}.webp`,
                            })),
                        },
                        {
                            type: 'CATEGORY_AD',
                            settings: { selectedProductIds: managed.map(item => item.id) },
                        },
                    ],
                },
            }),
        );
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read.mock.calls.map(call => call[0])).toEqual([
            'preview/hero-0.webp',
            'preview/phone-0.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/desktop-0.webp',
        ]);
        expect(
            result.find(item => item.identity.includes('desktop-0') && item.kind === 'card')?.placeholder,
        ).toBeDefined();
        for (const source of ['desktop-1', 'best-0', 'best-1'])
            expect(
                result.find(item => item.identity.includes(source) && item.kind === 'card')?.placeholder,
            ).toBeUndefined();
        expect(
            sources(media, 'card')
                .filter(source => /\/(?:desktop|best)-/u.test(source))
                .slice(0, 4),
        ).toEqual([
            '/assets/preview/desktop-0.webp?v=desktop',
            '/assets/preview/best-0.webp?v=mobile',
            '/assets/preview/desktop-1.webp?v=desktop',
            '/assets/preview/best-1.webp?v=mobile',
        ]);
        expect(result.find(item => item.identity.includes('best-1') && item.kind === 'card')?.version).toBe(
            'mobile',
        );
        expect(
            result.find(item => item.identity.includes('best-1') && item.kind === 'thumbnail')?.placeholder,
        ).toBeUndefined();
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(result.map(({ placeholder: _placeholder, ...item }) => item)).toEqual(media);
    });
    it('uses gallery and variant covers and falls back from empty selected ids to pinned first-row ids', async () => {
        const gallery = {
            id: 'gallery',
            featuredAsset: null,
            assets: [
                { preview: '/assets/preview/desktop-gallery.webp?v=gallery' },
                { preview: '/assets/preview/unused-gallery.webp' },
            ],
        };
        const variant = {
            id: 'variant',
            featuredAsset: null,
            variants: [{ featuredAsset: { preview: '/assets/preview/desktop-variant.webp?v=variant' } }],
        };
        const media = publicPageMedia(
            page({
                request: { kind: 'home' },
                products: [
                    { id: 'unselected', featuredAsset: { preview: '/assets/preview/unselected.webp' } },
                    gallery,
                    variant,
                ],
                bestSellers: {
                    pinnedProducts: [
                        { id: 'best-gallery', assets: [{ preview: '/assets/preview/best-gallery.webp' }] },
                    ],
                    catalog: {
                        items: [
                            {
                                id: 'best-variant',
                                variants: [
                                    {
                                        product: {
                                            featuredAsset: { preview: '/assets/preview/best-variant.webp' },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                content: {
                    blocks: [
                        {
                            type: 'HERO',
                            imageUrl: '/assets/preview/hero.webp',
                            settings: { mobileImageUrl: '/assets/preview/phone.webp' },
                        },
                        {
                            type: 'QUICK_LINKS',
                            items: Array.from({ length: 5 }, (_, index) => ({
                                imageUrl: `/assets/preview/quick-${index}.webp`,
                            })),
                        },
                        {
                            type: 'FEATURED_COLLECTION',
                            settings: { selectedProductIds: [], pinnedProductIds: ['gallery', 'variant'] },
                        },
                    ],
                },
            }),
        );
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read.mock.calls.map(call => call[0])).toEqual([
            'preview/hero.webp',
            'preview/phone.webp',
            ...Array.from({ length: 5 }, (_, index) => `preview/quick-${index}.webp`),
            'preview/desktop-gallery.webp',
        ]);
        expect(
            result.find(item => item.identity.includes('desktop-gallery') && item.kind === 'card'),
        ).toMatchObject({ version: 'gallery', placeholder: { inlineData: preview } });
        expect(
            result.find(item => item.identity.includes('desktop-variant') && item.kind === 'card'),
        ).toMatchObject({ version: 'variant' });
        expect(
            result.find(item => item.identity.includes('desktop-variant') && item.kind === 'card')
                ?.placeholder,
        ).toBeUndefined();
        expect(result.some(item => item.identity.includes('unused-gallery'))).toBe(false);
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
    });
    it('inherits only matching canonical asset, version and purpose without importing old descriptors', () => {
        const old = [
            mediaDescriptor('https://shop.example/assets/preview/a.webp?v=1', 'hero', {
                inlinePreview: preview,
            }),
            mediaDescriptor('/assets/preview/removed.webp', 'hero', { inlinePreview: preview }),
        ];
        const fresh = [
            mediaDescriptor('/assets/preview/a.webp?v=1', 'hero'),
            mediaDescriptor('/assets/preview/a.webp?v=2', 'hero'),
            mediaDescriptor('/assets/preview/a.webp?v=1', 'card'),
            mediaDescriptor('https://other.test/assets/preview/a.webp?v=1', 'hero'),
        ];
        const result = preservePublicMediaPreviews(fresh, old, 'shop.example');
        expect(result).toHaveLength(fresh.length);
        expect(result.map(item => Boolean(item.placeholder))).toEqual([true, false, false, false]);
        expect(result.map(item => item.identity)).toEqual(fresh.map(item => item.identity));
        expect(fresh.every(item => !item.placeholder)).toBe(true);
    });
    it('authorizes same-store assets before storage, ignores foreign/private paths and preserves versions', async () => {
        const media = [
            mediaDescriptor('/assets/preview/allowed.webp?v=1', 'hero'),
            mediaDescriptor('/assets/preview/allowed.webp?v=2', 'card'),
            mediaDescriptor('/assets/preview/denied.webp', 'hero'),
            mediaDescriptor('https://other.test/assets/preview/foreign.webp', 'hero'),
            mediaDescriptor('/assets/cache/private.webp', 'hero'),
            mediaDescriptor('https://user:secret@shop.example/assets/preview/credentials.webp', 'hero'),
        ];
        const authorize = vi.fn((path: string) => Promise.resolve(!path.includes('denied')));
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(media, 'shop.example', authorize, read);
        expect(authorize.mock.calls.map(call => call[0])).toEqual([
            'preview/allowed.webp',
            'preview/allowed.webp',
            'preview/denied.webp',
        ]);
        expect(read).toHaveBeenCalledTimes(2);
        expect(result.filter(item => item.placeholder)).toHaveLength(2);
        expect(result.map(item => item.version)).toEqual(['1', '2', null, null, null, null]);
        expect(media.every(item => !item.placeholder)).toBe(true);
    });
    it('adds only the configured header logo after the original eight assets and covers duplicate uses', async () => {
        const body = Array.from({ length: 9 }, (_, index) =>
            mediaDescriptor(`/assets/preview/body-${index}.webp`, 'hero'),
        );
        const logoUrl = '/assets/preview/header.webp?v=current';
        const media = [
            ...body,
            mediaDescriptor('/assets/preview/light.webp', 'thumbnail'),
            mediaDescriptor('/assets/preview/dark.webp', 'thumbnail'),
            mediaDescriptor(logoUrl, 'thumbnail'),
            mediaDescriptor('/assets/preview/body-0.webp', 'card'),
            mediaDescriptor(logoUrl, 'icon'),
        ];
        const read = vi.fn().mockResolvedValue('data:image/webp;base64,AAAA');
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
            250,
            undefined,
            logoUrl,
        );
        expect(read.mock.calls.map(call => call[0])).toEqual([
            ...Array.from({ length: 8 }, (_, index) => `preview/body-${index}.webp`),
            'preview/header.webp',
        ]);
        expect(result.map(item => Boolean(item.placeholder))).toEqual([
            ...Array(8).fill(true),
            false,
            false,
            false,
            true,
            true,
            true,
        ]);
        expect(result[11].version).toBe('current');
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(media.every(item => !item.placeholder)).toBe(true);
    });
    it('keeps the original eight previews when the additional logo would exceed the existing wire budget', async () => {
        const logoUrl = '/assets/preview/header.webp';
        const media = [
            ...Array.from({ length: 8 }, (_, index) =>
                mediaDescriptor(`/assets/preview/body-${index}.webp`, 'hero'),
            ),
            mediaDescriptor(logoUrl, 'thumbnail'),
        ];
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
            250,
            undefined,
            logoUrl,
        );
        expect(read).toHaveBeenCalledTimes(9);
        expect(result.slice(0, 8).every(item => item.placeholder?.inlineData === preview)).toBe(true);
        expect(result[8].placeholder).toBeUndefined();
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
    });
    it.each([
        {
            label: 'missing',
            configured: undefined,
            projected: '/assets/preview/header.webp',
            kind: 'thumbnail',
        },
        {
            label: 'foreign',
            configured: 'https://other.test/assets/preview/header.webp',
            projected: 'https://other.test/assets/preview/header.webp',
            kind: 'thumbnail',
        },
        {
            label: 'private',
            configured: '/assets/cache/header.webp',
            projected: '/assets/cache/header.webp',
            kind: 'thumbnail',
        },
        {
            label: 'unprojected',
            configured: '/assets/preview/missing.webp',
            projected: '/assets/preview/header.webp',
            kind: 'thumbnail',
        },
        {
            label: 'different version',
            configured: '/assets/preview/header.webp?v=new',
            projected: '/assets/preview/header.webp?v=old',
            kind: 'thumbnail',
        },
        {
            label: 'different purpose',
            configured: '/assets/preview/header.webp',
            projected: '/assets/preview/header.webp',
            kind: 'card',
        },
    ] as const)('does not add a $label header candidate', async ({ configured, projected, kind }) => {
        const media = [
            ...Array.from({ length: 9 }, (_, index) =>
                mediaDescriptor(`/assets/preview/body-${index}.webp`, 'hero'),
            ),
            mediaDescriptor(projected, kind),
        ];
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
            250,
            undefined,
            configured,
        );
        expect(read).toHaveBeenCalledTimes(8);
        expect(result.slice(8).every(item => !item.placeholder)).toBe(true);
    });
    it('does not add another asset when the configured header logo is already among the first eight', async () => {
        const logoUrl = '/assets/preview/header.webp';
        const media = [
            mediaDescriptor(logoUrl, 'thumbnail'),
            ...Array.from({ length: 9 }, (_, index) =>
                mediaDescriptor(`/assets/preview/body-${index}.webp`, 'hero'),
            ),
        ];
        const read = vi.fn().mockResolvedValue(preview);
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
            250,
            undefined,
            logoUrl,
        );
        expect(read).toHaveBeenCalledTimes(8);
        expect(result.slice(8).every(item => !item.placeholder)).toBe(true);
    });
    it('requires the existing public manifest authorization for the additional header asset', async () => {
        const logoUrl = '/assets/preview/header.webp';
        const media = [
            ...Array.from({ length: 8 }, (_, index) =>
                mediaDescriptor(`/assets/preview/body-${index}.webp`, 'hero'),
            ),
            mediaDescriptor(logoUrl, 'thumbnail'),
        ];
        const read = vi.fn().mockResolvedValue(preview);
        const authorize = vi.fn((path: string) => Promise.resolve(path !== 'preview/header.webp'));
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            authorize,
            read,
            250,
            undefined,
            logoUrl,
        );
        expect(authorize).toHaveBeenCalledWith('preview/header.webp');
        expect(read).toHaveBeenCalledTimes(8);
        expect(result.slice(0, 8).every(item => item.placeholder)).toBe(true);
        expect(result[8].placeholder).toBeUndefined();
    });
    it('limits a page to eight distinct identities, two concurrent reads and the existing wire budget', async () => {
        let active = 0;
        let peak = 0;
        const read = vi.fn(async () => {
            peak = Math.max(peak, ++active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            return preview;
        });
        const media = Array.from({ length: 12 }, (_, index) =>
            mediaDescriptor(`/assets/preview/${index}.webp`, 'hero'),
        );
        media.splice(1, 0, mediaDescriptor('/assets/preview/0.webp', 'card'));
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
        );
        expect(read).toHaveBeenCalledTimes(8);
        expect(peak).toBe(2);
        expect(
            result.reduce((sum, item) => sum + (item.placeholder?.inlineData.length ?? 0), 0),
        ).toBeLessThanOrEqual(8192);
        expect(result[result.length - 1]?.placeholder).toBeUndefined();
    });
    it('ends waiting at the deadline and never mutates the page when storage completes late', async () => {
        let complete!: (value: string) => void;
        const read = vi.fn(
            () =>
                new Promise<string>(resolve => {
                    complete = resolve;
                }),
        );
        const media = [mediaDescriptor('/assets/preview/slow.webp', 'hero')];
        const result = await publicMediaWithPreviews(
            media,
            'shop.example',
            () => Promise.resolve(true),
            read,
            20,
        );
        expect(result[0].placeholder).toBeUndefined();
        complete(preview);
        await Promise.resolve();
        await Promise.resolve();
        expect(result[0].placeholder).toBeUndefined();
        expect(media[0].placeholder).toBeUndefined();
    });
    it('skips invalid or failed previews while keeping the page usable', async () => {
        const result = await publicMediaWithPreviews(
            [
                mediaDescriptor('/assets/preview/a.webp', 'hero'),
                mediaDescriptor('/assets/preview/b.webp', 'hero'),
            ],
            'shop.example',
            () => Promise.resolve(true),
            vi
                .fn()
                .mockRejectedValueOnce(new Error('missing'))
                .mockResolvedValueOnce(`${preview}${'A'.repeat(1024)}`),
        );
        expect(result.every(item => !item.placeholder)).toBe(true);
    });
    it.each(['denied', 'authorization-error', 'missing', 'storage-error', 'invalid', 'ready'])(
        'reports completed %s separately from unfinished work',
        async outcome => {
            const preparation = { deferred: true };
            const authorize = () =>
                outcome === 'authorization-error'
                    ? Promise.reject(new Error('authorization unavailable'))
                    : Promise.resolve(outcome !== 'denied');
            const read = vi.fn(() =>
                outcome === 'storage-error'
                    ? Promise.reject(new Error('storage unavailable'))
                    : Promise.resolve(
                          outcome === 'ready' ? preview : outcome === 'invalid' ? 'invalid' : undefined,
                      ),
            );
            const result = await publicMediaWithPreviews(
                [mediaDescriptor('/assets/preview/state.webp', 'hero')],
                'shop.example',
                authorize,
                read,
                250,
                preparation,
            );
            expect(preparation.deferred).toBe(false);
            expect(Boolean(result[0].placeholder)).toBe(outcome === 'ready');
            if (outcome === 'denied' || outcome === 'authorization-error')
                expect(read).not.toHaveBeenCalled();
        },
    );
    it('reports pending authorization without starting storage after the returned deadline', async () => {
        let finish!: (value: boolean) => void;
        const authorize = () =>
            new Promise<boolean>(resolve => {
                finish = resolve;
            });
        const read = vi.fn().mockResolvedValue(preview);
        const preparation = { deferred: false };
        const result = await publicMediaWithPreviews(
            [mediaDescriptor('/assets/preview/pending.webp', 'hero')],
            'shop.example',
            authorize,
            read,
            20,
            preparation,
        );
        expect(preparation.deferred).toBe(true);
        expect(result[0].placeholder).toBeUndefined();
        finish(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(read).not.toHaveBeenCalled();
        expect(preparation.deferred).toBe(true);
        expect(result[0].placeholder).toBeUndefined();
    });
    it('reports a deadline cutoff even if the worker promise settles before a delayed timer runs', async () => {
        let now = 0;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            const preparation = { deferred: false };
            const read = vi.fn().mockResolvedValue(preview);
            const result = await publicMediaWithPreviews(
                [mediaDescriptor('/assets/preview/cutoff.webp', 'hero')],
                'shop.example',
                () => {
                    now = 251;
                    return Promise.resolve(true);
                },
                read,
                250,
                preparation,
            );
            expect(preparation.deferred).toBe(true);
            expect(read).not.toHaveBeenCalled();
            expect(result[0].placeholder).toBeUndefined();
        } finally {
            clock.mockRestore();
        }
    });
    it('does not mistake the deliberate eight-identity wire limit for unfinished work', async () => {
        const preparation = { deferred: false };
        const result = await publicMediaWithPreviews(
            Array.from({ length: 9 }, (_, i) => mediaDescriptor(`/assets/preview/${i}.webp`, 'hero')),
            'shop.example',
            () => Promise.resolve(true),
            () => Promise.resolve(preview),
            250,
            preparation,
        );
        expect(result.filter(item => item.placeholder)).toHaveLength(8);
        expect(preparation.deferred).toBe(false);
    });
});
