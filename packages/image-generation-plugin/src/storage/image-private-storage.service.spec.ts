import type { RequestContext, TransactionalConnection } from '@vendure/core';
import { UserInputError } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImagePrivateAsset } from '../entities/image-private-asset.entity';

import { ImagePrivateStorageService } from './image-private-storage.service';

const DAY_MS = 24 * 60 * 60 * 1_000;

afterEach(() => {
    vi.useRealTimers();
});

describe('ImagePrivateStorageService reference lifecycle', () => {
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
