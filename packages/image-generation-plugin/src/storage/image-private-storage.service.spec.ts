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
