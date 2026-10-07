import { mediaDescriptor } from '@vendure/storefront-content-plugin';
import { describe, expect, it } from 'vitest';

import {
    PUBLIC_MEDIA_USES,
    publicContentImageKinds,
    publicHeroMobileImage,
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
        ...data,
    } as any;
}
const sources = (media: ReturnType<typeof publicPageMedia>, kind: string) =>
    media.filter(item => item.kind === kind).map(item => item.identity);

describe('public page media projection', () => {
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
