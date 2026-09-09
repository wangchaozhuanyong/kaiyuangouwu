import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './asset.service.js';

import { HashedAssetNamingStrategy } from '../../../../asset-server-plugin/src/config/hashed-asset-naming-strategy';
import { LocalAssetStorageStrategy } from '../../../../asset-server-plugin/src/config/local-asset-storage-strategy';
import { SharpAssetPreviewStrategy } from '../../../../asset-server-plugin/src/config/sharp-asset-preview-strategy';

import { AssetService } from './asset.service';

const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(failure?: string) {
    const root = await mkdtemp(path.join(tmpdir(), 'asset-compensation-'));
    roots.push(root);
    let rollback!: () => void;
    const rollbackPromise = new Promise<void>(resolve => {
        rollback = resolve;
    });
    const repository = {
        manager: { queryRunner: { isTransactionActive: true } },
        save: vi.fn((value: any) => {
            if (failure === 'asset-save' || (failure === 'translation-save' && Array.isArray(value)))
                return Promise.reject(new Error('synthetic persistence failure'));
            return Promise.resolve(Array.isArray(value) ? value : Object.assign(value, { id: 1 }));
        }),
    };
    const preview = new SharpAssetPreviewStrategy();
    if (failure === 'preview')
        vi.spyOn(preview, 'generatePreviewImage').mockRejectedValue(new Error('synthetic decoder failure'));
    const service = new AssetService(
        { getRepository: () => repository } as any,
        {
            assetOptions: {
                permittedFileTypes: ['image/*'],
                assetStorageStrategy: new LocalAssetStorageStrategy(root),
                assetNamingStrategy: new HashedAssetNamingStrategy(),
                assetPreviewStrategy: preview,
            },
        } as any,
        {} as any,
        { publish: vi.fn().mockResolvedValue(undefined) } as any,
        {
            valuesToTags:
                failure === 'tags'
                    ? vi.fn().mockRejectedValue(new Error('synthetic tag failure'))
                    : vi.fn().mockResolvedValue([]),
        } as any,
        { assignToCurrentChannel: vi.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        { updateRelations: vi.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        { translate: (asset: unknown) => asset } as any,
        { awaitRollback: () => rollbackPromise } as any,
    );
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
    const input = {
        file: Promise.resolve({
            filename: 'synthetic.png',
            mimetype: 'image/png',
            createReadStream: () => Readable.from(bytes),
        }),
        tags: ['synthetic'],
    };
    const files = async () => {
        const entries = await readdir(root, { recursive: true });
        const details = await Promise.all(entries.map(entry => stat(path.join(root, entry))));
        return entries.filter((_entry, index) => details[index].isFile());
    };
    return { service, root, input, files, rollback };
}

describe('Asset upload filesystem compensation', () => {
    it.each(['asset-save', 'translation-save', 'preview'])(
        'removes written files after %s fails',
        async failure => {
            const test = await fixture(failure);
            await expect(test.service.create({ languageCode: 'en' } as any, test.input)).rejects.toThrow(
                'synthetic',
            );
            expect(await test.files()).toEqual([]);
        },
    );
    it.each(['tags', undefined])('removes files on outer rollback after %s', async failure => {
        const test = await fixture(failure);
        const result = test.service.create({ languageCode: 'en' } as any, test.input);
        if (failure) await expect(result).rejects.toThrow('synthetic');
        else await result;
        expect(await test.files()).toHaveLength(2);
        test.rollback();
        await vi.waitFor(async () => {
            expect(await test.files()).toEqual([]);
        });
    });
    it('keeps both files for successful uploads without rollback', async () => {
        const test = await fixture();
        await test.service.create({ languageCode: 'en' } as any, test.input);
        expect(await test.files()).toHaveLength(2);
    });
});
