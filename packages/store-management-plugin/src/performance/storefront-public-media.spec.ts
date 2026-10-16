import { mediaDescriptor } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import {
    preservePublicMediaPreviews,
    PUBLIC_MEDIA_USES,
    publicContentImageKinds,
    publicHeroMobileImage,
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
