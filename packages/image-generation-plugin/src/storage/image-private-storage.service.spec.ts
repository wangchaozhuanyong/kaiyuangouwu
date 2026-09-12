import type { RequestContext, TransactionalConnection } from '@vendure/core';
import { UserInputError } from '@vendure/core';
import { lstat, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImagePrivateAsset } from '../entities/image-private-asset.entity';

import { ImagePrivateStorageService } from './image-private-storage.service';

const DAY_MS = 24 * 60 * 60 * 1_000;

afterEach(() => {
    vi.useRealTimers();
});

describe('ImagePrivateStorageService reference lifecycle', () => {
    it('advances past live files across bounded sweeps and preserves recent files and symlinks', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'private-image-sweep-'));
        const old = new Date(Date.now() - 2 * 60 * 60_000);
        const folder = path.join(root, 'reference');
        await mkdir(folder);
        for (let index = 0; index < 401; index++) {
            const file = path.join(folder, `${index}.png`);
            await writeFile(file, 'synthetic image fixture');
            await utimes(file, old, old);
        }
        const names = await readdir(folder);
        const known = new Set(names.slice(0, 400).map(name => `reference/${name}`));
        const orphan = path.join(folder, names[400]);
        await writeFile(path.join(root, 'recent.png'), 'recent');
        await symlink(folder, path.join(root, 'linked-directory'));
        const query: any = {
            where: () => query,
            andWhere: () => query,
            take: () => query,
            getMany: () => Promise.resolve([]),
        };
        const find = vi.fn((options: any) =>
            Promise.resolve(
                (options.where.storageKey?.value ?? [])
                    .filter((key: string) => known.has(key))
                    .map((storageKey: string) => ({ storageKey })),
            ),
        );
        const repository = { createQueryBuilder: () => query, find, remove: vi.fn() };
        const service = new ImagePrivateStorageService(
            { rawConnection: { getRepository: () => repository } } as any,
            { production: false, storageRoot: root },
        );
        try {
            let removed = 0;
            for (let index = 0; index < 4; index++) removed += await service.purgeExpired();
            expect(removed).toBe(1);
            await expect(lstat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
            expect((await readdir(folder)).length).toBe(400);
            expect((await lstat(path.join(root, 'recent.png'))).isFile()).toBe(true);
            expect((await lstat(path.join(root, 'linked-directory'))).isSymbolicLink()).toBe(true);
            const batches = find.mock.calls
                .map(([options]) => options.where.storageKey?.value)
                .filter(Boolean);
            expect(batches.every(batch => batch.length <= 200)).toBe(true);
            expect(new Set(batches.flat()).size).toBe(401);
        } finally {
            await service.onModuleDestroy();
            await rm(root, { recursive: true, force: true });
        }
    });
    it('re-encodes uploads without EXIF metadata before private storage', async () => {
        const storageRoot = await mkdtemp(path.join(tmpdir(), 'image-reference-metadata-'));
        const source = await sharp({
            create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
        })
            .jpeg()
            .withMetadata({ exif: { IFD0: { Artist: 'private-location-owner' } } })
            .toBuffer();
        const repository = {
            save: vi.fn((storedAsset: ImagePrivateAsset) => {
                storedAsset.id = 100;
                return Promise.resolve(storedAsset);
            }),
        };
        const connection = {
            getRepository: vi.fn(() => repository),
            rawConnection: { options: { type: 'sqljs' } },
        } as unknown as TransactionalConnection;
        const service = new ImagePrivateStorageService(connection, {
            production: false,
            storageRoot,
        });

        const asset = await service.storeReference(context(), 10, {
            filename: 'with-location.jpg',
            mimetype: 'image/jpeg',
            createReadStream: () => Readable.from(source),
        });
        const storedMetadata = await sharp(await service.read(asset)).metadata();

        expect(storedMetadata.exif).toBeUndefined();
        await rm(storageRoot, { recursive: true, force: true });
    });

    it('retains an active task reference for the output retention window', async () => {
        const now = new Date('2026-08-27T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const asset = referenceAsset(new Date(now.getTime() + DAY_MS));
        const { service, save } = storageWith(asset);

        await service.retainReferenceWhileActive(context(), asset.id);

        expect(asset.expiresAt).toEqual(new Date(now.getTime() + 90 * DAY_MS));
        expect(save).toHaveBeenCalledWith(asset, { reload: false });
    });

    it('shortens a completed task reference to twenty-four hours', async () => {
        const now = new Date('2026-08-27T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const asset = referenceAsset(new Date(now.getTime() + 90 * DAY_MS));
        const { service, save } = storageWith(asset);

        await service.expireReferenceAfterTerminal(context(), asset.id);

        expect(asset.expiresAt).toEqual(new Date(now.getTime() + DAY_MS));
        expect(save).toHaveBeenCalledWith(asset, { reload: false });
    });

    it('does not revive an expired or deleted reference', async () => {
        const now = new Date('2026-08-27T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const expired = referenceAsset(new Date(now.getTime() - 1));
        const { service: expiredService, save: expiredSave } = storageWith(expired);

        await expect(expiredService.retainReferenceWhileActive(context(), expired.id)).rejects.toBeInstanceOf(
            UserInputError,
        );
        expect(expiredSave).not.toHaveBeenCalled();

        const deleted = referenceAsset(new Date(now.getTime() + DAY_MS));
        deleted.deletedAt = new Date(now.getTime() - 1);
        const { service: deletedService, save: deletedSave } = storageWith(deleted);
        await expect(deletedService.retainReferenceWhileActive(context(), deleted.id)).rejects.toBeInstanceOf(
            UserInputError,
        );
        expect(deletedSave).not.toHaveBeenCalled();
    });

    it('removes the reference file and sensitive fields but keeps a short-lived quota tombstone', async () => {
        const asset = referenceAsset(new Date(Date.now() + DAY_MS));
        asset.originalName = 'private-person.jpg';
        asset.providerMetadata = { revisedPrompt: 'private prompt' };
        const { service, save } = storageWith(asset);

        await expect(service.deleteOwned(context(), asset.id, asset.customerId)).resolves.toBe(true);

        expect(asset.deletedAt).toBeInstanceOf(Date);
        expect(asset.originalName).toBe('deleted');
        expect(asset.providerMetadata).toBeNull();
        expect(save).toHaveBeenCalledWith(asset, { reload: false });
    });
});

describe('ImagePrivateStorageService generated resolution verification', () => {
    it('rejects a relay image that is smaller than the requested native tier', async () => {
        const storageRoot = await mkdtemp(path.join(tmpdir(), 'image-generated-resolution-'));
        const source = await sharp({
            create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' },
        })
            .png()
            .toBuffer();
        const repository = { save: vi.fn() };
        const connection = {
            getRepository: vi.fn(() => repository),
            rawConnection: { options: { type: 'sqljs' } },
        } as unknown as TransactionalConnection;
        const service = new ImagePrivateStorageService(connection, { production: false, storageRoot });

        await expect(
            service.storeGenerated(
                context(),
                10,
                { bytes: source, mimeType: 'image/png' },
                'generated.png',
                '2K',
            ),
        ).rejects.toThrow('中转站未返回原生 2K 图片');
        expect(repository.save).not.toHaveBeenCalled();
        await rm(storageRoot, { recursive: true, force: true });
    });
});

function referenceAsset(expiresAt: Date): ImagePrivateAsset {
    const asset = new ImagePrivateAsset({
        channelId: 1,
        customerId: 10,
        kind: 'REFERENCE',
        storageKey: 'reference/asset.png',
        originalName: 'asset.png',
        mimeType: 'image/png',
        byteSize: 100,
        width: 10,
        height: 10,
        sha256: 'a'.repeat(64),
        expiresAt,
        deletedAt: null,
        providerMetadata: null,
    });
    asset.id = 99;
    return asset;
}

function context(): RequestContext {
    return { channelId: 1 } as RequestContext;
}

function storageWith(asset: ImagePrivateAsset) {
    const save = vi.fn().mockResolvedValue(asset);
    const repository = {
        findOne: vi.fn().mockResolvedValue(asset),
        save,
    };
    const connection = {
        getRepository: vi.fn(() => repository),
        rawConnection: { options: { type: 'sqljs' } },
    } as unknown as TransactionalConnection;
    return {
        service: new ImagePrivateStorageService(connection, { production: false }),
        save,
    };
}

function objectFixture(failSave = false) {
    const objects = new Map<string, Buffer>();
    const records = new Map<string, ImagePrivateAsset>();
    const blobStore = {
        put: vi.fn((key: string, bytes: Buffer) => {
            objects.set(key, bytes);
            return Promise.resolve();
        }),
        get: vi.fn((key: string) => {
            const bytes = objects.get(key);
            if (!bytes) throw new Error('not found');
            return Promise.resolve(bytes);
        }),
        has: vi.fn((key: string) => Promise.resolve(objects.has(key))),
        delete: vi.fn((key: string) => {
            objects.delete(key);
            return Promise.resolve();
        }),
        list: vi.fn().mockResolvedValue({ items: [] }),
    };
    const repository = {
        save: vi.fn((asset: ImagePrivateAsset) => {
            if (failSave) throw new Error('synthetic rollback');
            asset.id ||= 'asset-1';
            records.set(String(asset.id), asset);
            return Promise.resolve(asset);
        }),
        findOne: vi.fn(({ where }: any) =>
            Promise.resolve(
                [...records.values()].find(asset =>
                    Object.entries(where).every(
                        ([field, value]) => String((asset as any)[field]) === String(value),
                    ),
                ) ?? null,
            ),
        ),
    };
    const service = new ImagePrivateStorageService(
        { getRepository: () => repository, rawConnection: { getRepository: () => repository } } as any,
        { production: false, storageRoot: '/unused-legacy-images', blobStore },
    );
    return { service, blobStore, objects, records, repository };
}

async function syntheticReference(service: ImagePrivateStorageService) {
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
    return service.storeReference(context(), 10, {
        filename: 'synthetic.png',
        mimetype: 'image/png',
        createReadStream: () => Readable.from(bytes),
    });
}

describe('private object storage ownership and lifecycle', () => {
    it('retains failed cleanup records and only counts confirmed removals', async () => {
        const { service, blobStore, repository } = objectFixture();
        const asset = await syntheticReference(service);
        asset.expiresAt = new Date(Date.now() - 1);
        const query: any = {
            where: () => query,
            andWhere: () => query,
            take: () => query,
            getMany: () => Promise.resolve([asset]),
        };
        const remove = vi.fn().mockResolvedValue(asset);
        Object.assign(repository, {
            createQueryBuilder: () => query,
            find: vi.fn().mockResolvedValue([]),
            remove,
        });
        blobStore.delete.mockRejectedValueOnce(new Error('synthetic storage outage'));
        expect(await service.purgeExpired()).toBe(0);
        expect(remove).not.toHaveBeenCalled();
        expect(await service.purgeExpired()).toBe(1);
        expect(remove).toHaveBeenCalledWith(asset);
    });

    it('stores normalized bytes privately and binds download signatures to customer and channel', async () => {
        const { service, objects, records } = objectFixture();
        const asset = await syntheticReference(service);
        expect(asset.storageKey).toMatch(/^private\/v1\/reference\//);
        expect(objects.size).toBe(1);
        expect((await service.read(asset)).length).toBe(asset.byteSize);
        expect(service.signedUrl(asset, 11)).toBeNull();
        const token = signedToken(service, asset);
        expect((await service.authorize(token))?.asset.id).toBe(asset.id);
        expect(await service.authorize(token + 'x')).toBeUndefined();
        records.set(String(asset.id), new ImagePrivateAsset({ ...asset, channelId: 999 }));
        expect(await service.authorize(token)).toBeUndefined();
    });

    it('revokes a deleted asset even when physical deletion temporarily fails', async () => {
        const { service, blobStore, objects } = objectFixture();
        const asset = await syntheticReference(service);
        const token = signedToken(service, asset);
        expect(await service.deleteOwned(context(), asset.id, 11)).toBe(false);
        expect(objects.size).toBe(1);
        blobStore.delete.mockRejectedValueOnce(new Error('synthetic storage outage'));
        expect(await service.deleteOwned(context(), asset.id, 10)).toBe(true);
        expect(objects.size).toBe(1);
        expect(asset.providerMetadata).toEqual({ storageDeletionPending: true });
        expect(await service.authorize(token)).toBeUndefined();
        await expect(service.read(asset)).rejects.toThrow('图片已删除或过期');
    });

    it('removes the object when database persistence fails', async () => {
        const { service, objects } = objectFixture(true);
        await expect(syntheticReference(service)).rejects.toThrow('synthetic rollback');
        expect(objects.size).toBe(0);
    });

    it('rejects expired links and corrupted stored data', async () => {
        const { service, objects } = objectFixture();
        const asset = await syntheticReference(service);
        const token = signedToken(service, asset);
        objects.set(asset.storageKey, Buffer.from('corrupted'));
        await expect(service.read(asset)).rejects.toThrow('图片完整性校验失败');
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 301_000);
        expect(await service.authorize(token)).toBeUndefined();
    });
});

function signedToken(service: ImagePrivateStorageService, asset: ImagePrivateAsset): string {
    const token = service.signedUrl(asset, 10)?.split('/').pop();
    if (!token) throw new Error('Expected an authorized test link');
    return token;
}
