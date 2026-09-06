import { Customer, Order } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ReferralProgramConfig } from '../entities/referral-program-config.entity';
import { ReferralRelationship } from '../entities/referral-relationship.entity';
import { StorefrontDailyVisitor } from '../entities/storefront-daily-visitor.entity';

import { ReferralService } from './referral.service';

function queryBuilder(result: { many?: any[]; rawMany?: any[]; count?: number }) {
    const builder: Record<string, any> = {};
    for (const method of ['innerJoin', 'leftJoinAndSelect', 'where', 'andWhere', 'select', 'distinct']) {
        builder[method] = vi.fn().mockReturnValue(builder);
    }
    builder.getMany = vi.fn().mockResolvedValue(result.many ?? []);
    builder.getRawMany = vi.fn().mockResolvedValue(result.rawMany ?? []);
    builder.getCount = vi.fn().mockResolvedValue(result.count ?? 0);
    return builder;
}

describe('referral today metrics queries', () => {
    it('uses account registration time and net settled order data', async () => {
        const todayOrdersQuery = queryBuilder({
            many: [
                {
                    id: 'paid-order',
                    customerId: 'customer-1',
                    currencyCode: 'CNY',
                    totalWithTax: 10_000,
                    payments: [
                        {
                            amount: 10_000,
                            state: 'Settled',
                            refunds: [{ total: 2_500, state: 'Settled' }],
                        },
                    ],
                },
                {
                    id: 'authorized-order',
                    customerId: 'customer-2',
                    currencyCode: 'CNY',
                    totalWithTax: 10_000,
                    payments: [{ amount: 10_000, state: 'Authorized', refunds: [] }],
                },
                {
                    id: 'fully-refunded-order',
                    customerId: 'customer-3',
                    currencyCode: 'USD',
                    totalWithTax: 5_000,
                    payments: [
                        {
                            amount: 5_000,
                            state: 'Settled',
                            refunds: [{ total: 5_000, state: 'Settled' }],
                        },
                    ],
                },
            ],
        });
        const previousBuyersQuery = queryBuilder({ rawMany: [{ customerId: 'customer-1' }] });
        const customerRegistrationsQuery = queryBuilder({ count: 4 });
        const invitedTodayQuery = queryBuilder({ count: 2 });
        const invitedPurchasersQuery = queryBuilder({ count: 1 });
        const orderQueries = [todayOrdersQuery, previousBuyersQuery];
        const relationshipQueries = [invitedTodayQuery, invitedPurchasersQuery];
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Order) {
                    return { createQueryBuilder: vi.fn().mockImplementation(() => orderQueries.shift()) };
                }
                if (entity === Customer) {
                    return { createQueryBuilder: vi.fn().mockReturnValue(customerRegistrationsQuery) };
                }
                if (entity === StorefrontDailyVisitor) return { count: vi.fn().mockResolvedValue(3) };
                if (entity === ReferralRelationship) {
                    return {
                        createQueryBuilder: vi.fn().mockImplementation(() => relationshipQueries.shift()),
                    };
                }
                throw new Error(`Unexpected repository: ${String(entity)}`);
            }),
        };
        const service = new ReferralService(
            connection as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );

        const result = await service.todayMetrics({ channelId: 'channel-1' } as any);

        expect(result).toMatchObject({
            visitorCount: 3,
            newCustomerCount: 4,
            consumerCount: 1,
            firstTimeConsumerCount: 0,
            returningConsumerCount: 1,
            orderCount: 1,
            todayInvitedCount: 2,
            todayInvitedPurchaserCount: 1,
            salesByCurrency: [{ currencyCode: 'CNY', sales: 7_500 }],
        });
        expect(customerRegistrationsQuery.where).toHaveBeenCalledWith('customerUser.createdAt >= :utcStart', {
            utcStart: expect.any(String),
        });
        expect(customerRegistrationsQuery.andWhere).toHaveBeenCalledWith('customerUser.createdAt < :utcEnd', {
            utcEnd: expect.any(String),
        });
        const settledStateCall = todayOrdersQuery.where.mock.calls.find(([query]: [string]) =>
            query.includes('settledStates'),
        );
        expect(settledStateCall?.[1].settledStates).not.toContain('PaymentAuthorized');
        const settlementJoin = todayOrdersQuery.innerJoin.mock.calls.find(
            ([, alias]: [string, string]) => alias === 'settledTodayPayment',
        );
        expect(settlementJoin?.[2]).toContain('settledTodayPayment.updatedAt >= :utcStart');
        expect(settlementJoin?.[2]).toContain('settledTodayPayment.updatedAt < :utcEnd');
        expect(settlementJoin?.[3]).toMatchObject({
            utcStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/),
            utcEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/),
        });
        expect(previousBuyersQuery.andWhere).toHaveBeenCalledWith(
            'referralOrder.id NOT IN (:...currentOrderIds)',
            { currentOrderIds: ['paid-order'] },
        );
    });

    it('uses the payment-settlement event time for an invited customer first purchase', async () => {
        const registrations: any[] = [];
        const eventBus = {
            registerBlockingEventHandler: vi.fn(registration => registrations.push(registration)),
        };
        const service = new ReferralService(
            {} as any,
            {} as any,
            {} as any,
            eventBus as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );
        const rewardSettledOrder = vi
            .spyOn(service as any, 'rewardSettledOrder')
            .mockResolvedValue(undefined);
        service.onApplicationBootstrap();
        const settledAt = new Date('2026-08-27T00:00:01+08:00');
        const eventRegistration = registrations.find(
            item => item.id === 'referral-reward-on-payment-settled',
        );

        await eventRegistration.handler({
            toState: 'PaymentSettled',
            ctx: { channelId: 'channel-1' },
            order: { id: 'order-1' },
            createdAt: settledAt,
        });

        expect(rewardSettledOrder).toHaveBeenCalledWith({ channelId: 'channel-1' }, 'order-1', settledAt);
    });

    it('keeps first-purchase conversion data when rewards are temporarily disabled', async () => {
        const relationship = { firstPaidOrderAt: null };
        const saveRelationship = vi.fn().mockResolvedValue(relationship);
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === ReferralRelationship) {
                    return {
                        findOne: vi.fn().mockResolvedValue(relationship),
                        save: saveRelationship,
                    };
                }
                if (entity === ReferralProgramConfig) {
                    return { findOne: vi.fn().mockResolvedValue({ enabled: false }) };
                }
                throw new Error(`Unexpected repository: ${String(entity)}`);
            }),
        };
        const orderService = {
            findOne: vi.fn().mockResolvedValue({
                id: 'order-1',
                customer: { id: 'customer-1' },
                totalWithTax: 10_000,
            }),
        };
        const service = new ReferralService(
            connection as any,
            {} as any,
            orderService as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );
        const settledAt = new Date('2026-08-27T00:00:01+08:00');

        await (service as any).rewardSettledOrder({ channelId: 'channel-1' }, 'order-1', settledAt);

        expect(relationship.firstPaidOrderAt).toBe(settledAt);
        expect(saveRelationship).toHaveBeenCalledWith(relationship, { reload: false });
    });
});
