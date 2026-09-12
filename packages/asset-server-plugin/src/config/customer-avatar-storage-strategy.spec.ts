import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { CustomerAvatarNamingStrategy } from './customer-avatar-naming-strategy';
import { CustomerAvatarStorageStrategy } from './customer-avatar-storage-strategy';

const key = 'avatars/v2/source/customer-avatar-synthetic.webp';
function original() {
    return {
        writeFileFromBuffer: vi.fn().mockResolvedValue('legacy'),
        readFileToBuffer: vi.fn().mockResolvedValue(Buffer.from('legacy')),
        fileExists: vi.fn().mockResolvedValue(true),
        deleteFile: vi.fn(),
        toAbsoluteUrl: (_request: unknown, id: string) => '/assets/' + id,
    };
}

describe('customer avatar isolation', () => {
    it('writes new avatars outside ordinary assets and preserves legacy reads', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'avatar-zone-'));
        const previous = original();
        try {
            const storage = new CustomerAvatarStorageStrategy(previous as any, root);
            const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } })
                .png()
                .toBuffer();
            expect(await storage.writeFileFromBuffer(key, png)).toBe(key);
            const metadata = await sharp(await storage.readFileToBuffer(key)).metadata();
            expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 384 });
            expect((await stat(path.join(root, key))).mode % 0o1000).toBe(0o600);
            expect(previous.writeFileFromBuffer).not.toHaveBeenCalled();
            expect((await storage.readFileToBuffer('source/ab/old-avatar.png')).toString()).toBe('legacy');
            await storage.deleteFile(key);
            expect(await storage.fileExists(key)).toBe(false);
            // Retrying a partially completed source/preview cleanup is idempotent.
            await expect(storage.deleteFile(key)).resolves.toBeUndefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('only sends new avatar keys to the public CDN and avatar object store', async () => {
        const objects = {
            put: vi.fn(),
            get: vi.fn().mockResolvedValue(Buffer.from('clean')),
            delete: vi.fn(),
            has: vi.fn().mockResolvedValue(true),
        };
        const storage = new CustomerAvatarStorageStrategy(
            original() as any,
            '/unused',
            objects as any,
            'https://media.example.test',
        );
        expect(storage.toAbsoluteUrl({}, key)).toBe('https://media.example.test/' + key);
        expect(storage.toAbsoluteUrl({}, 'source/old.png')).toBe('/assets/source/old.png');
        await storage.deleteFile(key);
        expect(objects.delete).toHaveBeenCalledWith(key);
    });

    it('rejects untrusted content before it can be published as an avatar', async () => {
        const objects = { put: vi.fn() };
        const storage = new CustomerAvatarStorageStrategy(original() as any, '/unused', objects as any);
        await expect(storage.writeFileFromBuffer(key, Buffer.from('<svg/>'))).rejects.toThrow();
        expect(objects.put).not.toHaveBeenCalled();
    });

    it('keeps existing naming for product images and namespaces avatar sources and previews', () => {
        const naming = new CustomerAvatarNamingStrategy();
        const ctx = {} as any;
        const source = naming.generateSourceFileName(ctx, 'customer-avatar-synthetic.webp');
        expect(source).toBe(key);
        expect(naming.generatePreviewFileName(ctx, source)).toMatch(/^avatars\/v2\/preview\//);
        expect(naming.generateSourceFileName(ctx, 'product.png')).toMatch(
            /^source\/[a-f0-9]{2}\/product.png$/,
        );
    });
});
