import { LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { CUSTOMER_AVATAR_MAX_BYTES, CustomerAvatarService } from './customer-avatar.service';

function createService() {
    const assetService = {
        findAll: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
        create: vi.fn(),
    };
    const customerService = {
        findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-1' }),
    };
    const query: any = {
        getOneOrFail: vi.fn().mockResolvedValue({ id: 'channel-1' }),
        getRawOne: vi.fn().mockResolvedValue({ bytes: '0' }),
    };
    query.getExists = vi.fn().mockResolvedValue(false);
    for (const method of ['where', 'andWhere', 'setLock', 'innerJoin', 'select', 'addSelect'])
        query[method] = vi.fn(() => query);
    const repository = {
        createQueryBuilder: vi.fn(() => query),
        findOne: vi.fn().mockResolvedValue(null),
        remove: vi.fn(),
    };
    const connection = {
        rawConnection: { options: { type: 'postgres' }, entityMetadatas: [] },
        getRepository: vi.fn(() => repository),
        withTransaction: vi.fn((_ctx, work) => work(_ctx)),
    };
    const storage = { deleteFile: vi.fn().mockResolvedValue(undefined) };
    return {
        assetService,
        customerService,
        query,
        repository,
        connection,
        storage,
        service: new CustomerAvatarService(
            assetService as any,
            customerService as any,
            connection as any,
            { assetOptions: { assetStorageStrategy: storage } } as any,
            { getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default' }) } as any,
        ),
    };
}

const ctx = { activeUserId: 'user-1', channelId: 'channel-1' } as any;
const imageBytes = () =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
const upload = (bytes: Buffer) =>
    Promise.resolve({
        filename: 'avatar.png',
        mimetype: 'image/png',
        createReadStream: () => Readable.from(bytes),
    });

describe('CustomerAvatarService', () => {
    it('returns the latest avatar belonging to the active customer', async () => {
        const { assetService, service } = createService();
        const avatar = { id: 'asset-2', preview: '/assets/avatar.webp' };
        assetService.findAll.mockResolvedValue({ items: [avatar], totalItems: 2 });

        await expect(service.findMine(ctx)).resolves.toBe(avatar);
        expect(assetService.findAll).toHaveBeenCalledWith(ctx, {
            take: 1,
            tags: ['customer-avatar', 'customer-avatar-owner:customer-1'],
            tagsOperator: LogicalOperator.AND,
            sort: { createdAt: SortOrder.DESC },
        });
    });

    it('uploads a validated image with customer-scoped tags', async () => {
        const { assetService, service } = createService();
        const avatar = { id: 'asset-1', preview: '/assets/avatar.png' };
        assetService.create.mockResolvedValue(avatar);
        const bytes = await imageBytes();

        await expect(
            service.uploadMine(
                ctx,
                Promise.resolve({
                    filename: 'me.png',
                    mimetype: 'image/png',
                    createReadStream: () => Readable.from(bytes),
                }),
            ),
        ).resolves.toBe(avatar);

        const input = assetService.create.mock.calls[0][1];
        expect(input.tags).toEqual(['customer-avatar', 'customer-avatar-owner:customer-1']);
        const replayableUpload = await input.file;
        expect(replayableUpload.filename).toMatch(/^customer-avatar-[a-f0-9-]+\.webp$/u);
        expect(replayableUpload.mimetype).toBe('image/webp');
    });

    it.each(['customer quota', 'channel quota', 'channel file count', 'frequency'])(
        'enforces %s before storage under a database lock',
        async condition => {
            const test = createService();
            if (condition === 'customer quota')
                test.assetService.findAll.mockResolvedValue({ items: [], totalItems: 5 });
            if (condition === 'channel quota')
                test.query.getRawOne.mockResolvedValue({ bytes: String(1024 ** 3) });
            if (condition === 'channel file count')
                test.query.getRawOne.mockResolvedValue({ bytes: '10', count: '10000' });
            if (condition === 'frequency') {
                test.query.getExists.mockResolvedValue(true);
                test.assetService.findAll.mockResolvedValue({
                    items: [{ createdAt: new Date() }],
                    totalItems: 1,
                });
            }
            await expect(test.service.uploadMine(ctx, upload(await imageBytes()))).rejects.toThrow();
            expect(test.assetService.create).not.toHaveBeenCalled();
            expect(test.query.setLock).toHaveBeenCalledWith('pessimistic_write');
        },
    );

    it('rejects fake MIME, truncated images and excessive pixels without creating assets', async () => {
        const test = createService();
        const png = await imageBytes();
        const oversized = await sharp({
            create: { width: 4001, height: 4000, channels: 3, background: '#fff' },
        })
            .png()
            .toBuffer();
        for (const bytes of [Buffer.from('not an image'), png.subarray(0, 45), oversized]) {
            await expect(test.service.uploadMine(ctx, upload(bytes))).rejects.toThrow('图片安全检查未通过');
        }
        expect(test.assetService.create).not.toHaveBeenCalled();
    });

    it('fully decodes, resizes and removes metadata from actual content despite a spoofed MIME', async () => {
        const test = createService();
        test.assetService.create.mockResolvedValue({ id: 'new' });
        const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } })
            .jpeg()
            .withMetadata({ exif: { IFD0: { Artist: 'synthetic-private-metadata' } } })
            .toBuffer();
        await test.service.uploadMine(ctx, upload(bytes));
        const input = await test.assetService.create.mock.calls[0][1].file;
        const chunks: Buffer[] = [];
        for await (const chunk of input.createReadStream()) chunks.push(chunk);
        const normalized = await sharp(Buffer.concat(chunks)).metadata();
        expect(normalized).toMatchObject({ format: 'webp', width: 512, height: 384 });
        expect(normalized.exif).toBeUndefined();
    });

    it('retains old avatars on upload failure and deletes an unreferenced replacement only after commit', async () => {
        const test = createService();
        const old = {
            id: 'old',
            createdAt: new Date(0),
            source: 'old.webp',
            preview: 'preview.webp',
            tags: [{ value: 'customer-avatar' }, { value: 'customer-avatar-owner:customer-1' }],
            channels: [{ id: 'channel-1' }, { id: 'default' }],
        };
        test.assetService.findAll.mockResolvedValue({ items: [old], totalItems: 1 });
        test.repository.findOne.mockResolvedValue(old as any);
        test.assetService.create.mockRejectedValueOnce(new Error('DB unavailable'));
        await expect(test.service.uploadMine(ctx, upload(await imageBytes()))).rejects.toThrow(
            'DB unavailable',
        );
        expect(test.repository.remove).not.toHaveBeenCalled();
        test.assetService.create.mockResolvedValue({ id: 'new' });
        await test.service.uploadMine(ctx, upload(await imageBytes()));
        expect(test.repository.remove).toHaveBeenCalledWith(old);
        expect(test.storage.deleteFile.mock.calls).toEqual([['old.webp'], ['preview.webp']]);
    });

    it('rejects unsupported, empty, and oversized files before creating an asset', async () => {
        const { assetService, service } = createService();

        await expect(
            service.uploadMine(
                ctx,
                Promise.resolve({
                    filename: 'avatar.svg',
                    mimetype: 'image/svg+xml',
                    createReadStream: () => Readable.from(Buffer.from('<svg/>')),
                }),
            ),
        ).rejects.toThrow('头像仅支持 JPG、PNG 或 WebP 图片');
        await expect(
            service.uploadMine(
                ctx,
                Promise.resolve({
                    filename: 'avatar.png',
                    mimetype: 'image/png',
                    createReadStream: () => Readable.from(Buffer.alloc(0)),
                }),
            ),
        ).rejects.toThrow('头像图片不能为空');
        await expect(
            service.uploadMine(
                ctx,
                Promise.resolve({
                    filename: 'avatar.png',
                    mimetype: 'image/png',
                    createReadStream: () => Readable.from(Buffer.alloc(CUSTOMER_AVATAR_MAX_BYTES + 1)),
                }),
            ),
        ).rejects.toThrow('头像图片不能超过 5MB');
        expect(assetService.create).not.toHaveBeenCalled();
    });

    it.each(['source', 'preview'])('retains the old quota row when %s cleanup fails', async failing => {
        const test = createService();
        const old = {
            id: 'old',
            createdAt: new Date(0),
            source: 'source',
            preview: 'preview',
            tags: [{ value: 'customer-avatar' }, { value: 'customer-avatar-owner:customer-1' }],
            channels: [{ id: 'channel-1' }, { id: 'default' }],
        };
        test.assetService.findAll.mockResolvedValue({ items: [old], totalItems: 1 });
        test.repository.findOne.mockResolvedValue(old as any);
        test.assetService.create.mockResolvedValue({ id: 'new' });
        test.storage.deleteFile.mockImplementation(key =>
            key === failing ? Promise.reject(new Error('synthetic storage outage')) : Promise.resolve(),
        );
        await expect(test.service.uploadMine(ctx, upload(await imageBytes()))).resolves.toEqual({
            id: 'new',
        });
        expect(test.repository.remove).not.toHaveBeenCalled();
        test.storage.deleteFile.mockResolvedValue(undefined);
        await test.service.uploadMine(ctx, upload(await imageBytes()));
        expect(test.repository.remove).toHaveBeenCalledWith(old);
    });

    it('returns no avatar for a guest or an account without a customer profile', async () => {
        const { assetService, customerService, service } = createService();
        customerService.findOneByUserId.mockResolvedValue(null);

        await expect(service.findMine(ctx)).resolves.toBeNull();
        await expect(service.findMine({ activeUserId: null } as any)).resolves.toBeNull();
        expect(assetService.findAll).not.toHaveBeenCalled();
    });
});
