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
    const dataRetention = {
        retiredAvatarIds: vi.fn().mockResolvedValue(new Set<string>()),
        quarantineAvatar: vi.fn().mockResolvedValue({ id: 'retention-1' }),
        avatarHistory: vi.fn().mockResolvedValue([]),
        ownedAvatarRecordForRestore: vi.fn(),
        restoreAvatarRecord: vi.fn(),
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
    return {
        assetService,
        customerService,
        dataRetention,
        query,
        repository,
        connection,
        service: new CustomerAvatarService(
            assetService as any,
            customerService as any,
            connection as any,
            dataRetention as any,
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
            take: 32,
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
                test.assetService.findAll.mockResolvedValue({ items: [], totalItems: 32 });
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

    it('retains old avatars on upload failure and quarantines them only with a committed replacement', async () => {
        const test = createService();
        const old = {
            id: 'old',
            createdAt: new Date(0),
        };
        test.assetService.findAll.mockResolvedValue({ items: [old], totalItems: 1 });
        test.assetService.create.mockRejectedValueOnce(new Error('DB unavailable'));
        await expect(test.service.uploadMine(ctx, upload(await imageBytes()))).rejects.toThrow(
            'DB unavailable',
        );
        expect(test.dataRetention.quarantineAvatar).not.toHaveBeenCalled();
        test.assetService.create.mockResolvedValue({ id: 'new' });
        await test.service.uploadMine(ctx, upload(await imageBytes()));
        expect(test.dataRetention.quarantineAvatar).toHaveBeenCalledWith(ctx, old, 'customer-1', 'REPLACED');
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

    it('hides quarantined avatars without deleting the underlying asset', async () => {
        const test = createService();
        const old = { id: 'old' };
        const active = { id: 'active' };
        test.assetService.findAll.mockResolvedValue({ items: [active, old], totalItems: 2 });
        test.dataRetention.retiredAvatarIds.mockResolvedValue(new Set(['old']));

        await expect(test.service.findMine(ctx)).resolves.toBe(active);
        expect(test.repository.remove).not.toHaveBeenCalled();
    });

    it('removes the visible avatar by quarantining it for recovery', async () => {
        const test = createService();
        const active = { id: 'active' };
        test.assetService.findAll.mockResolvedValue({ items: [active], totalItems: 1 });

        await expect(test.service.removeMine(ctx)).resolves.toBe(true);
        expect(test.dataRetention.quarantineAvatar).toHaveBeenCalledWith(
            ctx,
            active,
            'customer-1',
            'REMOVED',
        );
    });

    it('returns no avatar for a guest or an account without a customer profile', async () => {
        const { assetService, customerService, service } = createService();
        customerService.findOneByUserId.mockResolvedValue(null);

        await expect(service.findMine(ctx)).resolves.toBeNull();
        await expect(service.findMine({ activeUserId: null } as any)).resolves.toBeNull();
        expect(assetService.findAll).not.toHaveBeenCalled();
    });
});
