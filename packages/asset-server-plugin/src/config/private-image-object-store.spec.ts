import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { PrivateImageObjectStore } from './private-image-object-store';

async function png() {
    return sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
}

describe('private image object storage', () => {
    it('writes only immutable, encrypted objects and never creates a bucket or grants public ACLs', async () => {
        const send = vi.fn().mockResolvedValue({});
        const storage = new PrivateImageObjectStore('synthetic-image-bucket', 'private/v1/', { send } as any);
        await storage.put('private/v1/reference/test.png', await png());
        expect(send.mock.calls.map(([command]: any) => command.constructor.name)).toEqual([
            'HeadBucketCommand',
            'PutObjectCommand',
        ]);
        const input = (send.mock.calls[1] as any)[0].input;
        expect(input).toMatchObject({
            IfNoneMatch: '*',
            ServerSideEncryption: 'AES256',
            ContentType: 'image/png',
            CacheControl: 'private, no-store',
        });
        expect(input.ACL).toBeUndefined();
        expect(input.Metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects path traversal and cross-zone access before any network operation', async () => {
        const send = vi.fn();
        const storage = new PrivateImageObjectStore('synthetic-image-bucket', 'private/v1/', { send } as any);
        for (const key of [
            'avatars/v2/test.webp',
            'private/v1/../x',
            'private/v1/%2e%2e/x',
            'private/v1/\\x',
        ]) {
            await expect(storage.get(key)).rejects.toThrow();
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('checks complete object length and digest on reads', async () => {
        const bytes = await png();
        const send = vi.fn((command: any) =>
            Promise.resolve(
                command.constructor.name === 'HeadBucketCommand'
                    ? {}
                    : {
                          Body: Readable.from(bytes),
                          ContentLength: bytes.length,
                          Metadata: { sha256: createHash('sha256').update(bytes).digest('hex') },
                      },
            ),
        );
        const storage = new PrivateImageObjectStore('synthetic-image-bucket', 'private/v1/', { send } as any);
        expect(await storage.get('private/v1/reference/test.png')).toEqual(bytes);
        send.mockResolvedValue({
            Body: Readable.from(bytes),
            ContentLength: bytes.length,
            Metadata: { sha256: 'wrong' },
        });
        await expect(storage.get('private/v1/reference/test.png')).rejects.toThrow('integrity');
    });

    it('propagates forbidden reads instead of treating them as missing objects', async () => {
        const send = vi.fn((command: any) => {
            if (command.constructor.name === 'HeadBucketCommand') return Promise.resolve({});
            throw Object.assign(new Error('forbidden'), { $metadata: { httpStatusCode: 403 } });
        });
        const storage = new PrivateImageObjectStore('synthetic-image-bucket', 'private/v1/', { send } as any);
        await expect(storage.has('private/v1/reference/test.png')).rejects.toMatchObject({
            $metadata: { httpStatusCode: 403 },
        });
    });

    it('does not overwrite an existing key with different content', async () => {
        const send = vi.fn((command: any) => {
            if (command.constructor.name === 'PutObjectCommand')
                throw Object.assign(new Error('precondition'), { $metadata: { httpStatusCode: 412 } });
            return Promise.resolve({ Metadata: { sha256: 'different' }, ContentLength: 1 });
        });
        const storage = new PrivateImageObjectStore('synthetic-image-bucket', 'private/v1/', { send } as any);
        await expect(storage.put('private/v1/reference/test.png', await png())).rejects.toThrow(
            'different content',
        );
    });
});
