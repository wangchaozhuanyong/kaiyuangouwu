import type { RequestContext } from '@vendure/core';
import { Customer } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import {
    CustomerOperationsService,
    deriveCustomerSegment,
    scoreFrequency,
    scoreRecency,
} from './customer-operations.service';
import { CustomerFollowUpEvent } from './entities/customer-follow-up-event.entity';
import { CustomerFollowUp } from './entities/customer-follow-up.entity';
import { CustomerOperationsProfile } from './entities/customer-operations-profile.entity';

const ctx = { channelId: 'channel-1', activeUserId: 'admin-1' } as unknown as RequestContext;

describe('customer operations scoring', () => {
    it('segments active, valuable, at-risk, dormant, and new customers deterministically', () => {
        expect(
            deriveCustomerSegment({ orderCount: 0, recencyDays: null, monetaryScore: 0, registeredDays: 5 }),
        ).toMatchObject({ segment: 'NEW', churnRisk: 'NONE' });
        expect(
            deriveCustomerSegment({ orderCount: 4, recencyDays: 10, monetaryScore: 5, registeredDays: 100 }),
        ).toMatchObject({ segment: 'VIP', churnRisk: 'LOW' });
        expect(
            deriveCustomerSegment({ orderCount: 2, recencyDays: 70, monetaryScore: 2, registeredDays: 100 }),
        ).toMatchObject({ segment: 'AT_RISK', churnRisk: 'MEDIUM' });
        expect(
            deriveCustomerSegment({ orderCount: 2, recencyDays: 130, monetaryScore: 2, registeredDays: 200 }),
        ).toMatchObject({ segment: 'DORMANT', churnRisk: 'HIGH' });
        expect(scoreRecency(7)).toBe(5);
        expect(scoreRecency(91)).toBe(1);
        expect(scoreFrequency(10)).toBe(5);
        expect(scoreFrequency(0)).toBe(0);
    });
});

describe('customer follow-up transitions', () => {
    it('rejects a customer outside the active channel before creating a task', async () => {
        const queryBuilder = {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(null),
        };
        const service = new CustomerOperationsService(
            {
                getRepository: vi.fn((_ctx: RequestContext, entity: unknown) => {
                    if (entity === CustomerFollowUp) return { findOne: vi.fn().mockResolvedValue(null) };
                    if (entity === Customer) return { createQueryBuilder: vi.fn(() => queryBuilder) };
                    throw new Error('Unexpected repository');
                }),
            } as never,
            {} as never,
            {} as never,
        );

        await expect(
            service.createFollowUp(ctx, {
                customerId: 'other-channel-customer',
                priority: 'P2',
                dueAt: new Date(Date.now() + 86_400_000),
                title: '跨店铺任务',
                note: '不应创建',
                idempotencyKey: 'cross-channel-customer-1',
            }),
        ).rejects.toThrow('error.entity-with-id-not-found');
        expect(queryBuilder.getOne).toHaveBeenCalledOnce();
    });

    it('completes an open task with outcome evidence and schedules a no-response retry', async () => {
        const profile = Object.assign(new CustomerOperationsProfile(), {
            id: 'profile-1',
            channelId: 'channel-1',
            nextFollowUpAt: null,
        });
        const followUp = Object.assign(new CustomerFollowUp(), {
            id: 'follow-up-1',
            channelId: 'channel-1',
            customerId: 'customer-1',
            profileId: profile.id,
            status: 'OPEN',
            events: [],
        });
        const harness = createHarness({ profile, followUp });

        const result = await harness.service.updateFollowUp(ctx, {
            id: followUp.id,
            action: 'COMPLETE',
            outcomeCode: 'NO_RESPONSE',
            note: '已拨打登记电话，暂未接通',
            idempotencyKey: 'complete-follow-up-1',
        });

        expect(result.status).toBe('COMPLETED');
        expect(result.outcomeCode).toBe('NO_RESPONSE');
        expect(harness.savedEvents).toEqual([
            expect.objectContaining({ eventType: 'COMPLETED', actorUserId: 'admin-1' }),
        ]);
        expect(profile.nextFollowUpAt).toBeInstanceOf(Date);
    });

    it('returns the existing result for an idempotent retry without appending another event', async () => {
        const profile = Object.assign(new CustomerOperationsProfile(), {
            id: 'profile-1',
            channelId: 'channel-1',
        });
        const followUp = Object.assign(new CustomerFollowUp(), {
            id: 'follow-up-1',
            channelId: 'channel-1',
            customerId: 'customer-1',
            profileId: profile.id,
            status: 'COMPLETED',
            events: [],
        });
        const existingEvent = Object.assign(new CustomerFollowUpEvent(), {
            followUpId: followUp.id,
            idempotencyKey: 'complete-follow-up-1',
        });
        const harness = createHarness({ profile, followUp, existingEvent });

        await expect(
            harness.service.updateFollowUp(ctx, {
                id: followUp.id,
                action: 'COMPLETE',
                outcomeCode: 'NO_RESPONSE',
                note: '相同请求重试',
                idempotencyKey: 'complete-follow-up-1',
            }),
        ).resolves.toBe(followUp);
        expect(harness.savedEvents).toHaveLength(0);
    });

    it('rejects a new transition after the task has ended', async () => {
        const profile = Object.assign(new CustomerOperationsProfile(), {
            id: 'profile-1',
            channelId: 'channel-1',
        });
        const followUp = Object.assign(new CustomerFollowUp(), {
            id: 'follow-up-1',
            channelId: 'channel-1',
            customerId: 'customer-1',
            profileId: profile.id,
            status: 'DISMISSED',
            events: [],
        });
        const harness = createHarness({ profile, followUp });

        await expect(
            harness.service.updateFollowUp(ctx, {
                id: followUp.id,
                action: 'RESCHEDULE',
                dueAt: new Date(Date.now() + 86_400_000),
                note: '尝试重新打开',
                idempotencyKey: 'reschedule-closed-1',
            }),
        ).rejects.toThrow('已结束');
    });

    it('rejects a stale concurrent update when the open-state guard no longer matches', async () => {
        const profile = Object.assign(new CustomerOperationsProfile(), {
            id: 'profile-1',
            channelId: 'channel-1',
        });
        const followUp = Object.assign(new CustomerFollowUp(), {
            id: 'follow-up-1',
            channelId: 'channel-1',
            customerId: 'customer-1',
            profileId: profile.id,
            status: 'OPEN',
            events: [],
        });
        const harness = createHarness({ profile, followUp, updateAffected: 0 });

        await expect(
            harness.service.updateFollowUp(ctx, {
                id: followUp.id,
                action: 'COMPLETE',
                outcomeCode: 'RESOLVED',
                note: '并发完成',
                idempotencyKey: 'concurrent-complete-1',
            }),
        ).rejects.toThrow('已被其他操作更新');
        expect(harness.savedEvents).toHaveLength(0);
    });
});

function createHarness(input: {
    profile: CustomerOperationsProfile;
    followUp: CustomerFollowUp;
    existingEvent?: CustomerFollowUpEvent;
    updateAffected?: number;
}) {
    const savedEvents: CustomerFollowUpEvent[] = [];
    const eventRepository = {
        findOne: vi.fn(({ where }: { where: { idempotencyKey: string } }) =>
            Promise.resolve(
                input.existingEvent?.idempotencyKey === where.idempotencyKey ? input.existingEvent : null,
            ),
        ),
        save: vi.fn((event: CustomerFollowUpEvent) => {
            savedEvents.push(event);
            input.followUp.events = [...(input.followUp.events ?? []), event];
            return Promise.resolve(event);
        }),
    };
    const followUpRepository = {
        findOne: vi.fn(() => Promise.resolve(input.followUp)),
        save: vi.fn((followUp: CustomerFollowUp) => Promise.resolve(followUp)),
        update: vi.fn((_where: unknown, patch: Partial<CustomerFollowUp>) => {
            const affected = input.updateAffected ?? 1;
            if (affected) Object.assign(input.followUp, patch);
            return Promise.resolve({ affected });
        }),
    };
    const profileRepository = {
        findOne: vi.fn(() => Promise.resolve(input.profile)),
        save: vi.fn((profile: CustomerOperationsProfile) => Promise.resolve(profile)),
        update: vi.fn(() => Promise.resolve({ affected: 1 })),
    };
    const connection = {
        getRepository: vi.fn((_ctx: RequestContext, entity: unknown) => {
            if (entity === CustomerFollowUpEvent) return eventRepository;
            if (entity === CustomerFollowUp) return followUpRepository;
            if (entity === CustomerOperationsProfile) return profileRepository;
            throw new Error('Unexpected repository');
        }),
        withTransaction: vi.fn((_ctx: RequestContext, work: (txCtx: RequestContext) => unknown) => work(ctx)),
    };
    const service = new CustomerOperationsService(
        connection as never,
        {} as never,
        { publish: vi.fn() } as never,
    );
    return { service, savedEvents };
}
