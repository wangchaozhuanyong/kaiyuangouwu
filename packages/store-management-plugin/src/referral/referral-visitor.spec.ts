import { describe, expect, it, vi } from 'vitest';

import { ReferralService } from './referral.service';

describe('referral storefront visitors', () => {
    it('stores one daily visitor when the same IP visits repeatedly', async () => {
        const rows = new Map<string, any>();
        const repository = {
            findOne: vi.fn(({ where }) => Promise.resolve(rows.get(where.visitorKeyHash) ?? null)),
            save: vi.fn(entity => {
                rows.set(entity.visitorKeyHash, entity);
                return Promise.resolve(entity);
            }),
        };
        const service = new ReferralService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );
        const ctx = {
            activeUserId: undefined,
            channelId: 'channel-1',
            req: { ip: '203.0.113.10' },
        } as any;

        await service.recordVisit(ctx);
        await service.recordVisit(ctx);

        expect(rows.size).toBe(1);
        expect([...rows.values()][0]).toMatchObject({
            customerId: null,
            visitCount: 2,
        });
    });
});
