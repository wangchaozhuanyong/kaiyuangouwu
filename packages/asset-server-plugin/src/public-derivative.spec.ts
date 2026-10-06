import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { storefrontAssetPresets } from '../../dev-server/storefront-asset-presets';

import { AssetServer } from './asset-server';
import { PresetOnlyStrategy } from './config/preset-only-strategy';

async function harness(worker = true) {
    const original = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#4488aa' } })
        .png()
        .toBuffer();
    const files = new Map<string, Buffer>([['preview/public.png', original]]);
    const storage = {
        fileExists: vi.fn((key: string) => Promise.resolve(files.has(key))),
        readFileToBuffer: vi.fn((key: string) => {
            const image = files.get(key.replace(/^\//u, ''));
            if (!image) return Promise.reject(new Error('missing'));
            return Promise.resolve(image);
        }),
        writeFileFromBuffer: vi.fn((key: string, value: Buffer) => {
            files.set(key, value);
            return Promise.resolve(key);
        }),
    };
    const server = new AssetServer(
        { presets: storefrontAssetPresets } as never,
        { assetOptions: { assetStorageStrategy: storage } } as never,
        { isWorker: worker } as never,
    );
    return { server, storage, files };
}

describe('bounded worker derivative preparation', () => {
    it('uses the existing request cache identity and reuses completed or concurrent derivatives', async () => {
        const { server, storage, files } = await harness();
        await Promise.all(
            Array.from({ length: 4 }, () =>
                server.preparePublicDerivative('preview/public.png', 'storefront-icon-96', 82),
            ),
        );
        expect(storage.writeFileFromBuffer).toHaveBeenCalledTimes(1);
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'storefront-icon-96',
            permittedQuality: [82],
            permittedFormats: ['webp'],
        });
        const parameters = await strategy.getImageTransformParameters({
            input: { preset: 'storefront-icon-96', quality: 82, format: 'webp' },
            availablePresets: storefrontAssetPresets,
        } as never);
        const key = (server as any).getFileNameFromParameters('/preview/public.png', parameters);
        expect(files.has(key)).toBe(true);
        expect(await sharp(files.get(key)).metadata()).toMatchObject({
            format: 'webp',
            width: 96,
            height: 96,
        });
        await server.preparePublicDerivative('preview/public.png', 'storefront-icon-96', 82);
        expect(storage.writeFileFromBuffer).toHaveBeenCalledTimes(1);
    });
    it('rejects request processes, private paths, traversal and arbitrary transform settings', async () => {
        const request = await harness(false);
        await expect(
            request.server.preparePublicDerivative('preview/public.png', 'storefront-icon-96', 82),
        ).rejects.toThrow('worker');
        const { server, storage } = await harness();
        for (const path of [
            'avatars/v2/private.png',
            'cache/preview/a.webp',
            'preview/../private.png',
            'preview/%2e%2e/private.png',
        ])
            await expect(server.preparePublicDerivative(path, 'storefront-icon-96', 82)).rejects.toThrow(
                'Invalid',
            );
        await expect(
            server.preparePublicDerivative('preview/public.png', 'arbitrary-huge', 82),
        ).rejects.toThrow('not allowed');
        await expect(
            server.preparePublicDerivative('preview/public.png', 'storefront-icon-96', 99),
        ).rejects.toThrow('not allowed');
        expect(storage.readFileToBuffer).not.toHaveBeenCalled();
    });
});
