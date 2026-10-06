import { PresetOnlyStrategy } from '@vendure/asset-server-plugin';
import { ConfigService, SessionService } from '@vendure/core';
import {
    StorefrontMediaDeliveryService,
    StorefrontMediaManifestService,
    StorefrontPromotionAccessService,
} from '@vendure/store-management-plugin';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { transformImage } from '../asset-server-plugin/src/transform-image';

import {
    CatalogAssetAccessStrategy,
    createCatalogImageTransformStrategies,
    PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
} from './catalog-asset-access-strategy';
import { storefrontAssetPresets } from './storefront-asset-presets';
vi.mock('@vendure/store-management-plugin', () => ({
    StorefrontMediaManifestService: class {},
    StorefrontMediaDeliveryService: class {},
    StorefrontPromotionAccessService: class {},
}));
function harness(userId?: string) {
    const ctx = { channelId: 'shop-a', languageCode: 'en' };
    const isPublic = vi.fn((_ctx: unknown, _host: string, path: string) =>
        Promise.resolve(path === 'preview/public-hero.jpg'),
    );
    const record = vi.fn(() => Promise.resolve(true));
    const getSessionFromToken = vi.fn().mockResolvedValue(userId ? { user: { id: userId } } : undefined);
    const resolveRequest = vi.fn().mockResolvedValue({ host: 'shop.example.com', ctx });
    const instances = new Map<unknown, unknown>([
        [ConfigService, { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } }],
        [SessionService, { getSessionFromToken }],
        [StorefrontPromotionAccessService, { resolveRequest }],
        [StorefrontMediaManifestService, { isPublic }],
        [StorefrontMediaDeliveryService, { record }],
    ]);
    const headers = { setHeader: vi.fn() };
    const strategy = new CatalogAssetAccessStrategy();
    strategy.init({ get: (type: unknown) => instances.get(type) } as never);
    const read = (path: string) =>
        strategy.getImageTransformParameters({
            req: {
                path,
                originalUrl: `/assets${path}?preset=thumbnail`,
                session: { token: 'fixture-session' },
                get: vi.fn(),
                res: headers,
            },
            input: { preset: 'thumbnail' },
            availablePresets: [],
        } as never);
    return { read, isPublic, record, resolveRequest, getSessionFromToken, ctx, headers };
}
describe('catalog media boundary', () => {
    it('encodes an existing WebP logo as a real bounded PNG', async () => {
        const webp = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#997a37' } })
            .webp()
            .toBuffer();
        const strategy = createCatalogImageTransformStrategies(true)[0];
        const parameters = await strategy.getImageTransformParameters({
            input: { preset: 'storefront-icon-96', format: 'png', quality: 82 },
            availablePresets: [{ name: 'storefront-icon-96', width: 96, height: 96, mode: 'resize' }],
        } as never);
        const png = await (await transformImage(webp, parameters)).toBuffer();
        const metadata = await sharp(png).metadata();
        expect(metadata).toMatchObject({ format: 'png', width: 96, height: 96 });
    });
    it.each([
        ['storefront-icon-96', 96],
        ['storefront-thumbnail-fit-320', 320],
    ] as const)('allows PNG only for the bounded icon variant %s', async (preset, size) => {
        const strategy = createCatalogImageTransformStrategies(true)[0];
        const result = await strategy.getImageTransformParameters({
            input: { preset, format: 'png', width: 10000, height: 10000, quality: 82 },
            availablePresets: storefrontAssetPresets,
        } as never);
        expect(result).toMatchObject({ format: 'png', width: size, height: size, quality: 82 });
        const webp = await sharp({
            create: { width: 512, height: 512, channels: 4, background: '#997a37' },
        })
            .webp()
            .toBuffer();
        const png = await (await transformImage(webp, result)).toBuffer();
        expect(await sharp(png).metadata()).toMatchObject({
            format: 'png',
            width: size,
            height: size,
        });
    });
    it('retains the existing format restriction for other catalog images', async () => {
        const strategy = createCatalogImageTransformStrategies(true)[0];
        const result = await strategy.getImageTransformParameters({
            input: { preset: 'storefront-hero-fit-480', format: 'png' },
            availablePresets: [{ name: 'storefront-hero-fit-480', width: 480 }],
        } as never);
        expect(result.format).toBeUndefined();
    });
    it('authorizes before preset selection and omits store dependencies during base schema bootstrap', () => {
        expect(createCatalogImageTransformStrategies(false)[0]).toBeInstanceOf(CatalogAssetAccessStrategy);
        expect(createCatalogImageTransformStrategies(false)[1]).toBeInstanceOf(PresetOnlyStrategy);
        expect(createCatalogImageTransformStrategies(true)).toHaveLength(1);
    });
    it('authorizes the exact store and image before allowing the finite public TTL', async () => {
        const test = harness();
        await expect(test.read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.isPublic).toHaveBeenCalledWith(test.ctx, 'shop.example.com', 'preview/public-hero.jpg');
        expect(test.record).toHaveBeenCalledWith(
            'shop-a',
            'shop.example.com',
            '/assets/preview/public-hero.jpg?preset=thumbnail',
        );
        expect(test.headers.setHeader).toHaveBeenLastCalledWith(
            'Cache-Control',
            'public, max-age=300, s-maxage=300, must-revalidate',
        );
        expect(test.getSessionFromToken).not.toHaveBeenCalled();
    });
    it.each(['/preview/private.jpg', '/source/private.jpg', '/cache/preview/private_hash.webp', '/%ZZ'])(
        'rejects anonymous private and malformed paths: %s',
        async path => {
            const test = harness();
            await expect(test.read(path)).rejects.toThrow('Asset access denied');
            expect(test.headers.setHeader).not.toHaveBeenCalledWith(
                'Cache-Control',
                PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
            );
            expect(test.record).not.toHaveBeenCalled();
        },
    );
    it('checks the current manifest on each request and honors withdrawal and cross-store denial', async () => {
        const test = harness();
        await test.read('/preview/public-hero.jpg');
        test.isPublic.mockResolvedValue(false);
        await expect(test.read('/preview/public-hero.jpg')).rejects.toThrow('Asset access denied');
        const other = { channelId: 'shop-b', languageCode: 'en' };
        test.resolveRequest.mockResolvedValue({ ctx: other, host: 'other.example.com' });
        await expect(test.read('/preview/public-hero.jpg')).rejects.toThrow('Asset access denied');
        expect(test.isPublic).toHaveBeenLastCalledWith(other, 'other.example.com', 'preview/public-hero.jpg');
    });
    it('preserves authenticated private reads without making them cacheable', async () => {
        const test = harness('customer-a');
        await expect(test.read('/preview/private.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.headers.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(test.headers.setHeader).not.toHaveBeenCalledWith(
            'Cache-Control',
            PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
        );
    });
    it('keeps authenticated reads available on public lookup failure and rejects guests', async () => {
        for (const user of [undefined, 'customer-a']) {
            const test = harness(user);
            test.isPublic.mockRejectedValue(new Error('Publication lookup unavailable'));
            if (user)
                await expect(test.read('/preview/private.jpg')).resolves.toEqual({ preset: 'thumbnail' });
            else
                await expect(test.read('/preview/private.jpg')).rejects.toThrow(
                    'Publication lookup unavailable',
                );
            expect(test.headers.setHeader).not.toHaveBeenCalledWith(
                'Cache-Control',
                PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
            );
        }
    });
    it('serves a public image privately when exact purge tracking is unavailable', async () => {
        const test = harness();
        test.record.mockResolvedValue(false);
        await expect(test.read('/preview/public-hero.jpg')).resolves.toEqual({ preset: 'thumbnail' });
        expect(test.headers.setHeader).not.toHaveBeenCalledWith(
            'Cache-Control',
            PUBLIC_CATALOG_ASSET_CACHE_CONTROL,
        );
    });
});
