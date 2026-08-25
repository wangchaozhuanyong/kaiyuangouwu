import 'reflect-metadata';

import { Asset, UserInputError } from '@vendure/core';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontExternalImageService } from './storefront-external-image.service';

function imageStream(headers: Record<string, string>, chunks: Buffer[]): Readable {
    const stream = Readable.from(chunks) as Readable & { headers: Record<string, string> };
    stream.headers = headers;
    return stream;
}

describe('StorefrontExternalImageService', () => {
    it('imports a public bitmap through the configured safe import strategy', async () => {
        const stream = imageStream({ 'content-type': 'image/png', 'content-length': '8' }, [
            Buffer.from('png-data'),
        ]);
        const asset = new Asset({ id: 'asset-1', preview: '/assets/preview/import.png' });
        const importStrategy = { getStreamFromPath: vi.fn().mockResolvedValue(stream) };
        const assetService = { createFromFileStream: vi.fn().mockResolvedValue(asset) };
        const service = new StorefrontExternalImageService(
            {
                importExportOptions: { assetImportStrategy: importStrategy },
                assetOptions: { uploadMaxFileSize: 1024 },
            } as any,
            assetService as any,
        );

        await expect(
            service.import({ channelId: 'default-channel' } as any, 'https://cdn.example.com/hero'),
        ).resolves.toBe(asset);
        expect(importStrategy.getStreamFromPath).toHaveBeenCalledWith('https://cdn.example.com/hero');
        expect(assetService.createFromFileStream).toHaveBeenCalledWith(
            expect.any(Readable),
            'storefront-external-image.png',
            expect.objectContaining({ channelId: 'default-channel' }),
        );
    });

    it('rejects unsupported SVG and oversized responses before creating an asset', async () => {
        const assetService = { createFromFileStream: vi.fn() };
        const createService = (stream: Readable) =>
            new StorefrontExternalImageService(
                {
                    importExportOptions: {
                        assetImportStrategy: { getStreamFromPath: vi.fn().mockResolvedValue(stream) },
                    },
                    assetOptions: { uploadMaxFileSize: 8 },
                } as any,
                assetService as any,
            );

        await expect(
            createService(
                imageStream({ 'content-type': 'image/svg+xml' }, [Buffer.from('<svg></svg>')]),
            ).import({} as any, 'https://cdn.example.com/icon.svg'),
        ).rejects.toBeInstanceOf(UserInputError);
        await expect(
            createService(
                imageStream({ 'content-type': 'image/png', 'content-length': '9' }, [Buffer.alloc(9)]),
            ).import({} as any, 'https://cdn.example.com/large.png'),
        ).rejects.toBeInstanceOf(UserInputError);
        expect(assetService.createFromFileStream).not.toHaveBeenCalled();
    });

    it('normalizes stored Asset identifiers to the storefront asset route', () => {
        const service = new StorefrontExternalImageService({} as any, {} as any);

        expect(service.storefrontUrl(new Asset({ preview: 'preview/imported.png' }))).toBe(
            '/assets/preview/imported.png',
        );
        expect(
            service.storefrontUrl(
                new Asset({ preview: 'https://damatong.net/assets/preview/imported.png?token=public' }),
            ),
        ).toBe('/assets/preview/imported.png?token=public');
        expect(
            service.storefrontUrl(new Asset({ preview: 'https://third-party.example.com/image.png' })),
        ).toBe('');
        expect(
            service.storefrontUrl(
                new Asset({
                    mimeType: 'image/svg+xml',
                    source: 'source/icon.svg',
                    preview: 'preview/icon.png',
                }),
            ),
        ).toBe('/assets/source/icon.svg');
    });
});
