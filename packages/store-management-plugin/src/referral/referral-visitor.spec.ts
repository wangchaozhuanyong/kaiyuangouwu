import { describe, expect, it, vi } from 'vitest';

import { ReferralService } from './referral.service';

describe('referral storefront visitors', () => {
    it('stores one daily visitor when the same IP visits repeatedly', async () => {
        const rows = new Map<string, any>();
        let updateParameters: Record<string, unknown> = {};
        const queryBuilder = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn((_sql: string, parameters: Record<string, unknown>) => {
                updateParameters = { ...updateParameters, ...parameters };
                return queryBuilder;
            }),
            andWhere: vi.fn((_sql: string, parameters: Record<string, unknown>) => {
                updateParameters = { ...updateParameters, ...parameters };
                return queryBuilder;
            }),
            execute: vi.fn(() => {
                const row = rows.get(String(updateParameters.visitorKeyHash));
                if (!row) return Promise.resolve({ affected: 0 });
                row.visitCount += 1;
                row.lastSeenAt = new Date();
                return Promise.resolve({ affected: 1 });
            }),
        };
        const repository = {
            metadata: {
                findColumnWithPropertyName: vi.fn().mockReturnValue({ databaseName: 'visitCount' }),
            },
            manager: { connection: { driver: { escape: vi.fn((value: string) => `"${value}"`) } } },
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
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
