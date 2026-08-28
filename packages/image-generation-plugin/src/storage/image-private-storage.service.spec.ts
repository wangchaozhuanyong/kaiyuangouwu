import type { RequestContext, TransactionalConnection } from '@vendure/core';
import { UserInputError } from '@vendure/core';
import { mkdtemp, rm } from 'node:fs/promises';
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
