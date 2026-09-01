import { LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { CUSTOMER_AVATAR_MAX_BYTES, CustomerAvatarService } from './customer-avatar.service';

function createService() {
    const assetService = {
        findAll: vi.fn(),
        create: vi.fn(),
    };
    const customerService = {
        findOneByUserId: vi.fn().mockResolvedValue({ id: 'customer-1' }),
    };
    return {
        assetService,
        customerService,
        service: new CustomerAvatarService(assetService as any, customerService as any),
    };
}

const ctx = { activeUserId: 'user-1' } as any;

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

        await expect(
            service.uploadMine(
                ctx,
                Promise.resolve({
                    filename: 'me.png',
                    mimetype: 'image/png',
                    createReadStream: () => Readable.from(Buffer.from('png-data')),
                }),
            ),
        ).resolves.toBe(avatar);

        const input = assetService.create.mock.calls[0][1];
        expect(input.tags).toEqual(['customer-avatar', 'customer-avatar-owner:customer-1']);
        const replayableUpload = await input.file;
        expect(replayableUpload.filename).toMatch(/^customer-avatar-customer-1-\d+\.png$/u);
        expect(replayableUpload.mimetype).toBe('image/png');
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

    it('returns no avatar for a guest or an account without a customer profile', async () => {
        const { assetService, customerService, service } = createService();
        customerService.findOneByUserId.mockResolvedValue(null);

        await expect(service.findMine(ctx)).resolves.toBeNull();
        await expect(service.findMine({ activeUserId: null } as any)).resolves.toBeNull();
        expect(assetService.findAll).not.toHaveBeenCalled();
    });
});
