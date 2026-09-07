import { DeletionResult } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { Channel } from '../../entity/channel/channel.entity';
import { Seller } from '../../entity/seller/seller.entity';

import { SellerService } from './seller.service';

function createFixture(channels: Array<Pick<Channel, 'id' | 'code'>> = []) {
    const seller = { id: 'seller-1', name: '美宜佳' } as Seller;
    const sellerRepository = {
        remove: vi.fn().mockResolvedValue(undefined),
    };
    const queryBuilder = {
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(channels),
    };
    const channelRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue(seller),
        getRepository: vi.fn((_ctx, entity) => (entity === Channel ? channelRepository : sellerRepository)),
    };
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const ctx = {
        translate: vi.fn((key: string, variables: Record<string, string>) =>
            key === 'message.seller-used-in-channels'
                ? `商家主体 ${variables.sellerName} 被 ${variables.channelCodes} 使用`
                : `商家主体 ${variables.sellerName} 存在数据冲突`,
        ),
    };
    const service = new SellerService(connection as any, {} as any, eventBus as any, {} as any);
    return { service, ctx, sellerRepository, queryBuilder, eventBus };
}

describe('SellerService.delete', () => {
    it('returns the exact Channel codes that prevent deletion', async () => {
        const fixture = createFixture([
            { id: 'channel-1', code: 'my-malaysia' },
            { id: 'channel-2', code: 'moyao-ai' },
        ]);

        const result = await fixture.service.delete(fixture.ctx as any, 'seller-1');

        expect(result).toEqual({
            result: DeletionResult.NOT_DELETED,
            message: '商家主体 美宜佳 被 my-malaysia, moyao-ai 使用',
        });
        expect(fixture.ctx.translate).toHaveBeenCalledWith('message.seller-used-in-channels', {
            sellerName: '美宜佳',
            channelCodes: 'my-malaysia, moyao-ai',
        });
        expect(fixture.sellerRepository.remove).not.toHaveBeenCalled();
        expect(fixture.eventBus.publish).not.toHaveBeenCalled();
    });

    it('deletes and publishes an event when no Channel uses the Seller', async () => {
        const fixture = createFixture();

        await expect(fixture.service.delete(fixture.ctx as any, 'seller-1')).resolves.toEqual({
            result: DeletionResult.DELETED,
        });
        expect(fixture.queryBuilder.where).toHaveBeenCalledWith('channel.seller = :id', {
            id: 'seller-1',
        });
        expect(fixture.sellerRepository.remove).toHaveBeenCalledOnce();
        expect(fixture.eventBus.publish).toHaveBeenCalledOnce();
    });

    it('returns a safe consistency reason if the relation changes during deletion', async () => {
        const fixture = createFixture();
        fixture.sellerRepository.remove.mockRejectedValueOnce(
            new Error('violates foreign key constraint FK_channel_seller'),
        );

        const result = await fixture.service.delete(fixture.ctx as any, 'seller-1');

        expect(result).toEqual({
            result: DeletionResult.NOT_DELETED,
            message: '商家主体 美宜佳 存在数据冲突',
        });
        expect(result.message).not.toContain('FK_channel_seller');
        expect(fixture.eventBus.publish).not.toHaveBeenCalled();
    });
});
