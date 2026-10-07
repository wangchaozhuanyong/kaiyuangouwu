import { describe, expect, it, vi } from 'vitest';

import { CustomerServiceReviewService } from './customer-service-review.service';

describe('customer service review scope', () => {
    const store = { channelId: 'a', channel: { code: 'a' }, userHasPermissions: () => true } as any;
    function setup() {
        const findAndCount = vi.fn(() => Promise.resolve([[], 0]));
        const connection = { getRepository: vi.fn(() => ({ findAndCount })) };
        return {
            connection,
            findAndCount,
            service: new CustomerServiceReviewService(
                connection as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
            ),
        };
    }
    it('rejects all-store review access by SuperAdmin inside a store before querying', async () => {
        const { service, connection } = setup();
        await expect(service.list(store, 0, 25, true)).rejects.toThrow('平台管理员');
        expect(connection.getRepository).not.toHaveBeenCalled();
    });
    it('keeps normal access local and allows all-store access in the platform', async () => {
        const { service, findAndCount } = setup();
        await service.list(store);
        expect(findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { channelId: 'a' } }));
        findAndCount.mockClear();
        await service.list({ ...store, channel: { code: '__default_channel__' } }, 0, 25, true);
        expect(findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
});
