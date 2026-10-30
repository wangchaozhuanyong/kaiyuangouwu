import { MODULE_METADATA } from '@nestjs/common/constants';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { storefrontAssetPresets } from '../../dev-server/storefront-asset-presets';

import { AssetServer } from './asset-server';
import { AssetServerPlugin } from './plugin';

async function harness(worker = false) {
    const pixels = Buffer.from(
        Array.from({ length: 120 * 80 * 4 }, (_, index) => (index * 73 + Math.floor(index / 17)) % 256),
    );
    const landscape = await sharp(pixels, { raw: { width: 120, height: 80, channels: 4 } })
        .png()
        .toBuffer();
    const portrait = await sharp(landscape).rotate(90).toBuffer();
    const files = new Map<string, Buffer>([
        ['preview/landscape.png', landscape],
        ['source/portrait.png', portrait],
    ]);
    const storage = {
        fileExists: vi.fn((key: string) => Promise.resolve(files.has(key))),
        readFileToBuffer: vi.fn((key: string): Promise<Buffer> => {
            const image = files.get(key);
            return image ? Promise.resolve(image) : Promise.reject(new Error('missing'));
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

describe('public inline media previews', () => {
    it('reads prepared pixels without reading originals, converting, or writing on a public cache miss', async () => {
        const { server, storage } = await harness();
        expect(await server.readPreparedPublicInlinePreview('preview/landscape.png', 512)).toBeUndefined();
        expect(storage.readFileToBuffer).not.toHaveBeenCalled();
        expect(storage.writeFileFromBuffer).not.toHaveBeenCalled();
        const preview = await server.readPublicInlinePreview('preview/landscape.png', 512);
        expect(preview).toBeDefined();
        storage.readFileToBuffer.mockClear();
        storage.writeFileFromBuffer.mockClear();
        expect(await server.readPreparedPublicInlinePreview('preview/landscape.png', 512)).toBe(preview);
        expect(storage.readFileToBuffer.mock.calls.every(([path]) => path.startsWith('cache/'))).toBe(true);
        expect(storage.writeFileFromBuffer).not.toHaveBeenCalled();
    });

    it('fits the twelve-card budget with valid pixels and reuses the existing derivative cache', async () => {
        const { server, storage } = await harness(true);
        const compact = await server.readPublicInlinePreview('preview/landscape.png', 512);
        expect(compact).toBeDefined();
        if (!compact) throw new Error('Expected compact preview');
        expect(compact.length).toBeLessThanOrEqual(512);
        expect(await sharp(Buffer.from(compact.split(',')[1], 'base64')).metadata()).toMatchObject({
            format: 'webp',
        });
        const writes = storage.writeFileFromBuffer.mock.calls.length;
        expect(await server.readPublicInlinePreview('preview/landscape.png', 512)).toBe(compact);
        expect(storage.writeFileFromBuffer).toHaveBeenCalledTimes(writes);
    });
    it.each([false, true])('returns bounded real WebP pixels without cropping (worker=%s)', async worker => {
        const { server } = await harness(worker);
        for (const [identifier, width, height] of [
            ['preview/landscape.png', 24, 16],
            ['source/portrait.png', 16, 24],
        ] as const) {
            const preview = await server.readPublicInlinePreview(identifier);
            expect(preview).toMatch(/^data:image\/webp;base64,/u);
            if (!preview) throw new Error('Expected a public inline preview');
            expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(1024);
            const image = Buffer.from(preview.split(',')[1], 'base64');
            expect(await sharp(image).metadata()).toMatchObject({ format: 'webp', width, height });
        }
    });

    it('reuses simultaneous work and persisted derivatives through the existing storage cache', async () => {
        const { server, storage, files } = await harness();
        const previews = await Promise.all(
            Array.from({ length: 6 }, () => server.readPublicInlinePreview('preview/landscape.png')),
        );
        expect(new Set(previews).size).toBe(1);
        expect(storage.writeFileFromBuffer).toHaveBeenCalledOnce();
        const [key, value] = storage.writeFileFromBuffer.mock.calls[0];
        expect(key).toMatch(/^cache\/preview\/landscape[\da-f]+\.webp$/u);
        expect(files.get(key)).toEqual(value);
        const sourceReads = () =>
            storage.readFileToBuffer.mock.calls.filter(([path]) => path === 'preview/landscape.png').length;
        expect(sourceReads()).toBe(1);
        expect(await server.readPublicInlinePreview('preview/landscape.png')).toBe(previews[0]);
        expect(storage.writeFileFromBuffer).toHaveBeenCalledOnce();
        expect(sourceReads()).toBe(1);

        const restarted = new AssetServer(
            { presets: storefrontAssetPresets } as never,
            { assetOptions: { assetStorageStrategy: storage } } as never,
            { isWorker: false } as never,
        );
        expect(await restarted.readPublicInlinePreview('preview/landscape.png')).toBe(previews[0]);
        expect(storage.writeFileFromBuffer).toHaveBeenCalledOnce();
        expect(sourceReads()).toBe(1);
    });

    it('serves an already prepared inline preview while an unrelated worker conversion is blocked', async () => {
        const { server, storage, files } = await harness(true);
        const preview = await server.readPublicInlinePreview('preview/landscape.png');
        expect(preview).toBeTypeOf('string');
        const original = files.get('preview/landscape.png');
        const read = storage.readFileToBuffer.getMockImplementation();
        if (!original || !read) throw new Error('Missing image storage fixture');
        files.set('preview/busy.png', original);
        let release: (() => void) | undefined;
        let started: (() => void) | undefined;
        const blocked = new Promise<void>(resolve => {
            started = resolve;
        });
        storage.readFileToBuffer.mockImplementation(async key => {
            if (key === 'preview/busy.png') {
                started?.();
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            }
            return read(key);
        });
        const conversion = server.preparePublicDerivative('preview/busy.png', 'storefront-hero-fit-480', 90);
        await blocked;
        let received: string | undefined;
        const cached = server.readPublicInlinePreview('preview/landscape.png').then(value => {
            received = value;
        });
        try {
            await vi.waitFor(() => expect(received).toBe(preview), { timeout: 200 });
            expect(storage.writeFileFromBuffer).toHaveBeenCalledOnce();
        } finally {
            release?.();
            await conversion;
            await cached;
        }
    });

    it('rejects private, absolute, malformed and traversal paths before reading any storage', async () => {
        const { server, storage } = await harness();
        for (const identifier of [
            'avatars/v2/private.png',
            'cache/preview/cached.webp',
            '/preview/landscape.png',
            'https://store.invalid/assets/preview/landscape.png',
            'preview/../private.png',
            'preview/%2e%2e/private.png',
            'preview/./landscape.png',
            'preview/\\private.png',
            'preview/%5cprivate.png',
            'preview//landscape.png',
            'preview/',
            'preview/bad%2',
            'preview/image.png?q=90',
            'source/image.png#fragment',
            'source/%00.png',
        ])
            await expect(server.readPublicInlinePreview(identifier)).rejects.toThrow(
                'Invalid public media path',
            );
        expect(storage.fileExists).not.toHaveBeenCalled();
        expect(storage.readFileToBuffer).not.toHaveBeenCalled();
    });

    it('returns no preview for unavailable sources, with no original-image fallback', async () => {
        const { server, storage, files } = await harness();
        files.set('source/not-an-image.png', Buffer.from('not an image'));
        expect(await server.readPublicInlinePreview('preview/missing.png')).toBeUndefined();
        expect(await server.readPublicInlinePreview('source/not-an-image.png')).toBeUndefined();
        expect(storage.writeFileFromBuffer).not.toHaveBeenCalled();
    });

    it('reduces once when needed and never returns an oversized data URL', async () => {
        const { server } = await harness();
        const transform = vi.spyOn(server as any, 'transformedBuffer');
        transform.mockResolvedValueOnce(Buffer.alloc(800)).mockResolvedValueOnce(Buffer.alloc(500));
        const preview = await server.readPublicInlinePreview('preview/landscape.png');
        expect(preview?.length).toBeLessThanOrEqual(1024);
        expect(transform.mock.calls.map(([, parameters]) => parameters)).toMatchObject([
            { width: 24, height: 24, mode: 'resize', format: 'webp', quality: 24 },
            { width: 16, height: 16, mode: 'resize', format: 'webp', quality: 16 },
        ]);
        transform.mockReset().mockResolvedValue(Buffer.alloc(800));
        expect(await server.readPublicInlinePreview('preview/landscape.png')).toBeUndefined();
        expect(transform).toHaveBeenCalledTimes(2);
    });

    it.each([
        [false, 2],
        [true, 1],
    ] as const)(
        'shares the existing transform queue (worker=%s, concurrency=%s)',
        async (worker, concurrency) => {
            const { server, storage, files } = await harness(worker);
            const original = files.get('preview/landscape.png');
            if (!original) throw new Error('Expected the landscape fixture');
            files.set('preview/second.png', original);
            files.set('preview/third.png', original);
            let active = 0;
            let maximum = 0;
            const releases: Array<() => void> = [];
            const read = storage.readFileToBuffer.getMockImplementation();
            if (!read) throw new Error('Expected the storage reader fixture');
            storage.readFileToBuffer.mockImplementation(async key => {
                if (key.startsWith('preview/')) {
                    active++;
                    maximum = Math.max(maximum, active);
                    await new Promise<void>(resolve => releases.push(resolve));
                    active--;
                }
                return read(key);
            });
            const pending = Promise.all(
                ['landscape', 'second', 'third'].map(name =>
                    server.readPublicInlinePreview(`preview/${name}.png`),
                ),
            );
            await vi.waitFor(() => expect(releases).toHaveLength(concurrency));
            expect(maximum).toBe(concurrency);
            for (let index = 0; index < 3; index++) {
                await vi.waitFor(() => expect(releases[index]).toBeTypeOf('function'));
                releases[index]();
            }
            expect((await pending).every(Boolean)).toBe(true);
            expect(maximum).toBe(concurrency);
        },
    );

    it('exports a reader alias backed by the same AssetServer instance', () => {
        expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AssetServerPlugin)).toContainEqual({
            provide: 'STOREFRONT_PUBLIC_IMAGE_PREVIEW',
            useExisting: AssetServer,
        });
        expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AssetServerPlugin)).toContain(
            'STOREFRONT_PUBLIC_IMAGE_PREVIEW',
        );
    });
});
