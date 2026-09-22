import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { MarketingCampaignCost } from './entities/marketing-campaign-cost.entity';
import { StorefrontOrderAttribution } from './entities/storefront-order-attribution.entity';
import { StorefrontPageView } from './entities/storefront-page-view.entity';
import { MarketingAttributionService } from './marketing-attribution.service';

function context() {
    return {
        channelId: 1,
        activeUserId: 7,
        channel: { defaultCurrencyCode: CurrencyCode.MYR },
        userHasPermissions: vi.fn(() => true),
    } as any;
}

function reportQuery(items: unknown[]) {
    const query: any = {
        where: vi.fn(() => query),
        andWhere: vi.fn(() => query),
        innerJoinAndSelect: vi.fn(() => query),
        leftJoinAndSelect: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        addOrderBy: vi.fn(() => query),
        getMany: vi.fn(() => Promise.resolve(items)),
    };
    return query;
}

describe('marketing attribution closure', () => {
    it('uses a stable pseudonymous attribution key without exposing the source identity', () => {
        const service = new MarketingAttributionService(
            {} as any,
            {} as any,
            {
                signingSecret: 'test-attribution-signing-secret',
            } as any,
        );
        const first = service.attributionKey('1', 'customer:88');
        expect(first).toBe(service.attributionKey('1', 'customer:88'));
        expect(first).not.toContain('88');
        expect(service.attributionKey('2', 'customer:88')).not.toBe(first);
    });

    it('makes campaign cost retries idempotent and rejects key reuse with different evidence', async () => {
        let stored: any = null;
        const repository = {
            findOneBy: vi.fn(() => Promise.resolve(stored)),
            create: vi.fn((value: any) => ({ id: 1, createdAt: new Date(), ...value })),
            save: vi.fn((value: any) => {
                stored = value;
                return Promise.resolve(value);
            }),
        };
        const service = new MarketingAttributionService(
            { getRepository: vi.fn(() => repository) } as any,
            {} as any,
            { signingSecret: 'test-attribution-signing-secret' } as any,
        );
        const input = {
            businessDate: '2026-09-21',
            currencyCode: CurrencyCode.MYR,
            source: 'Google',
            medium: 'CPC',
            campaign: 'Launch',
            amountMicrounits: 120_000,
            idempotencyKey: 'cost:google:2026-09-21',
            reason: '广告平台日账单',
        };
        await expect(service.recordCost(context(), input)).resolves.toMatchObject({
            source: 'google',
            amountMicrounits: 120_000,
        });
        await expect(service.recordCost(context(), input)).resolves.toMatchObject({
            idempotencyKey: input.idempotencyKey,
        });
        await expect(service.recordCost(context(), { ...input, amountMicrounits: 130_000 })).rejects.toThrow(
            '该幂等键已用于不同',
        );
        expect(repository.save).toHaveBeenCalledTimes(1);
    });

    it('reports search terms, funnel counts, refunds, cost and refund-adjusted ROI', async () => {
        const view = {
            attributionKeyHash: 'visitor-1',
            path: '/products/red-shoe',
            source: 'google',
            medium: 'cpc',
            campaign: 'launch',
            term: 'red shoe',
            content: 'hero',
            referrerHost: 'google.com',
        };
        const attribution = {
            source: 'google',
            medium: 'cpc',
            campaign: 'launch',
            term: 'red shoe',
            content: 'hero',
            order: {
                payments: [
                    {
                        state: 'Settled',
                        amount: 10_000,
                        refunds: [{ state: 'Settled', total: 2_000 }],
                    },
                ],
            },
        };
        const cost = {
            id: 1,
            createdAt: new Date('2026-09-21T00:00:00Z'),
            businessDate: '2026-09-21',
            currencyCode: CurrencyCode.MYR,
            source: 'google',
            medium: 'cpc',
            campaign: 'launch',
            amountMicrounits: '20000',
            idempotencyKey: 'cost:test:001',
            actorUserId: '7',
            reason: '测试费用',
        };
        const queries = new Map<any, any>([
            [StorefrontPageView, reportQuery([view])],
            [StorefrontOrderAttribution, reportQuery([attribution])],
            [MarketingCampaignCost, reportQuery([cost])],
        ]);
        const connection = {
            getRepository: vi.fn((_ctx: any, entity: any) => ({
                createQueryBuilder: () => queries.get(entity),
            })),
        };
        const service = new MarketingAttributionService(
            connection as any,
            {} as any,
            {
                signingSecret: 'test-attribution-signing-secret',
            } as any,
        );
        const report = await service.report(context(), {
            from: '2026-09-21T00:00:00Z',
            to: '2026-09-21T23:59:59Z',
        });
        expect(report.items[0]).toMatchObject({
            term: 'red shoe',
            visitorCount: 1,
            productViewCount: 1,
            orderCount: 1,
            settledRevenueMicrounits: 100_000,
            refundedRevenueMicrounits: 20_000,
            netRevenueMicrounits: 80_000,
            campaignCostMicrounits: 20_000,
            refundAdjustedRoas: 4,
            refundAdjustedRoi: 3,
        });
    });

    it('expires only raw page views after 90 days while leaving frozen order attribution untouched', async () => {
        const query: any = {
            delete: vi.fn(() => query),
            from: vi.fn(() => query),
            where: vi.fn(() => query),
            execute: vi.fn(() => Promise.resolve({ affected: 8 })),
        };
        const getRepository = vi.fn(() => ({ createQueryBuilder: () => query }));
        const service = new MarketingAttributionService(
            { getRepository } as any,
            {} as any,
            {
                signingSecret: 'test-attribution-signing-secret',
            } as any,
        );
        const result = await service.purgeExpiredRawTraffic(context(), new Date('2026-09-21T00:00:00Z'));
        expect(result).toEqual({ cutoff: new Date('2026-06-23T00:00:00Z'), deletedCount: 8 });
        expect(query.from).toHaveBeenCalledWith(StorefrontPageView);
        expect(getRepository).toHaveBeenCalledTimes(1);
    });
});
