import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ReferralService } from './referral.service';

const browserHeaders = { 'user-agent': 'Mozilla/5.0 Referral Unit Test Browser' };
const signingSecret = 'test-storefront-visitor-signing-secret-at-least-32-characters';

function visitorRepository() {
    const rows: any[] = [];
    let nextId = 1;
    return {
        rows,
        repository: {
            find: vi.fn(({ where }) => {
                const hashes = new Set(where.map((item: any) => item.visitorKeyHash));
                return Promise.resolve(rows.filter(row => hashes.has(row.visitorKeyHash)));
            }),
            save: vi.fn((entity: any) => {
                if (!entity.id) entity.id = String(nextId++);
                const index = rows.findIndex(row => row.id === entity.id);
                if (index < 0) rows.push(entity);
                else rows[index] = entity;
                return Promise.resolve(entity);
            }),
            remove: vi.fn((entities: any[]) => {
                for (const entity of entities) {
                    const index = rows.findIndex(row => row.id === entity.id);
                    if (index >= 0) rows.splice(index, 1);
                }
                return Promise.resolve(entities);
            }),
            createQueryBuilder: vi.fn(() => {
                const builder: any = {
                    setLock: vi.fn(() => builder),
                    where: vi.fn(() => builder),
                    getOne: vi.fn().mockResolvedValue(null),
                };
                return builder;
            }),
        },
    };
}

function serviceWith(repository: any, customerService: any = {}) {
    return new ReferralService(
        {
            rawConnection: { options: { type: 'sqlite' } },
            getRepository: vi.fn().mockReturnValue(repository),
        } as any,
        customerService,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { signingSecret } as any,
    );
}

function requestContext(overrides: Record<string, unknown> = {}) {
    return {
        activeUserId: undefined,
        channelId: 'channel-1',
        req: { ip: '203.0.113.10', headers: browserHeaders },
        ...overrides,
    } as any;
}

describe('referral storefront visitors', () => {
    it('counts repeated visits from one device once and separates devices behind one IP', async () => {
        const { rows, repository } = visitorRepository();
        const service = serviceWith(repository);
        const ctx = requestContext();

        const first = await service.recordVisit(ctx, 'company-device-visitor-0001');
        await service.recordVisit(ctx, 'company-device-visitor-0001');
        await service.recordVisit(ctx, 'company-device-visitor-0002');

        expect(first.setCookie).toContain('storefront_visitor=');
        expect(rows).toHaveLength(2);
        expect(rows.map(row => row.visitCount).sort()).toEqual([1, 2]);
    });

    it('uses a stable IP and browser fallback when local storage and cookies are unavailable', async () => {
        const { rows, repository } = visitorRepository();
        const service = serviceWith(repository);
        const ctx = requestContext();

        await service.recordVisit(ctx);
        await service.recordVisit(ctx);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ customerId: null, visitCount: 2 });
    });

    it('merges the anonymous device into the logged-in customer for the same business day', async () => {
        const { rows, repository } = visitorRepository();
        const customer = { id: 'customer-1' };
        const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
        const service = serviceWith(repository, customerService);
        const anonymousCtx = requestContext();
        const customerCtx = requestContext({ activeUserId: 'user-1' });

        await service.recordVisit(anonymousCtx, 'login-merge-device-0001');
        await service.recordVisit(customerCtx, 'login-merge-device-0001');
        await service.recordVisit(customerCtx, 'login-merge-device-0002');

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ customerId: 'customer-1', visitCount: 3 });
    });

    it('merges prior browser-id and IP rows during the rollout without inflating today visitors', async () => {
        const { rows, repository } = visitorRepository();
        const service = serviceWith(repository);
        const visitorId = 'legacy-browser-visitor-0001';
        const channelId = 'channel-1';
        const firstSeenAt = new Date('2026-08-27T01:00:00.000Z');
        rows.push(
            {
                id: 'legacy-browser-row',
                visitorKeyHash: createHash('sha256')
                    .update(`${channelId}:anonymous:${visitorId}`)
                    .digest('hex'),
                firstSeenAt,
                lastSeenAt: firstSeenAt,
                visitCount: 3,
                customerId: null,
            },
            {
                id: 'legacy-ip-row',
                visitorKeyHash: createHmac('sha256', signingSecret)
                    .update(`${channelId}:ip:203.0.113.10`)
                    .digest('hex'),
                firstSeenAt,
                lastSeenAt: firstSeenAt,
                visitCount: 2,
                customerId: null,
            },
        );

        await service.recordVisit(requestContext(), visitorId);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ visitCount: 6, customerId: null });
        expect(rows[0].visitorKeyHash).not.toBe(
            createHash('sha256').update(`${channelId}:anonymous:${visitorId}`).digest('hex'),
        );
    });

    it('does not record automated traffic', async () => {
        const { rows, repository } = visitorRepository();
        const service = serviceWith(repository);

        await expect(
            service.recordVisit(
                requestContext({
                    req: { ip: '203.0.113.10', headers: { 'user-agent': 'Googlebot/2.1' } },
                }),
                'automated-visitor-id-0001',
            ),
        ).resolves.toEqual({ recorded: false, setCookie: null });
        expect(rows).toHaveLength(0);
    });
});
