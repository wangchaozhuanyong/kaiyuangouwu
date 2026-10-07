import { Channel, Order, TransactionSubscriber } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationService } from './admin-notification.service';

describe('AdminNotificationService', () => {
    for (const eventType of [
        'commerce.fulfillment.manual_delivery_failed',
        'commerce.fulfillment.manual_delivery_overdue',
    ]) {
        for (const activeIncident of [null, { id: 8, activeFingerprint: `${eventType}:1` }]) {
            it(`ignores late ${eventType} after CANCELLED with ${activeIncident ? 'old' : 'no'} active incident`, async () => {
                const test = manualIncidentTest({ state: 'CANCELLED' }, activeIncident);
                const result = await test.service.upsertIncident(null, manualIncidentInput(eventType));
                expect(result).toBeNull();
                expect(test.repository.findOne).not.toHaveBeenCalled();
                expect(test.repository.save).not.toHaveBeenCalled();
                expect(test.incidentResponse.appendSystemEvidence).not.toHaveBeenCalled();
                expect(test.configService.get).not.toHaveBeenCalled();
                expect(test.worker.dispatch).not.toHaveBeenCalled();
                expect(test.taskQuery.getOne).toHaveBeenCalledOnce();
            });
        }
    }

    for (const payload of [
        { channelId: '2', orderId: '37', deliveryId: '1' },
        { channelId: '5', orderId: '38', deliveryId: '1' },
        { channelId: '5', orderId: '37', deliveryId: '2' },
    ]) {
        it(`rejects stale manual incident scope ${JSON.stringify(payload)} before writing`, async () => {
            const test = manualIncidentTest();
            await expect(
                test.service.upsertIncident(null, { ...manualIncidentInput(), payload }),
            ).rejects.toThrow('归属不一致');
            expect(test.repository.save).not.toHaveBeenCalled();
            expect(test.worker.dispatch).not.toHaveBeenCalled();
        });
    }

    it('rejects wrong current sales Channel and managed context Channel', async () => {
        const test = manualIncidentTest();
        test.orderRepository.findOne.mockResolvedValueOnce({ id: '37', salesChannelId: '2' });
        await expect(test.service.upsertIncident(null, manualIncidentInput())).rejects.toThrow('归属不一致');
        await expect(
            test.service.upsertIncident({ channelId: '2' } as never, manualIncidentInput()),
        ).rejects.toThrow('归属不一致');
        expect(test.repository.save).not.toHaveBeenCalled();
    });

    it('persists the first legitimate manual incident while holding Delivery through the commit', async () => {
        const test = manualIncidentTest();
        const result = await test.service.upsertIncident(null, manualIncidentInput());
        expect(result).toMatchObject({ id: 11, incidentStatus: 'OPEN', deliveryStatus: 'PENDING' });
        expect(test.timeline).toEqual(['save-locked', 'commit', 'dispatch-after-commit']);
        expect(test.worker.dispatch).toHaveBeenCalledOnce();
    });

    it('aggregates a legitimate pending manual incident without re-dispatching it', async () => {
        const test = manualIncidentTest(
            {},
            { id: 8, occurrenceCount: 1, severity: 'P1', deliveryStatus: 'PENDING', payload: {} },
        );
        const result = await test.service.upsertIncident(null, manualIncidentInput());
        expect(result).toMatchObject({ id: 8, occurrenceCount: 2 });
        expect(test.worker.dispatch).not.toHaveBeenCalled();
        expect(test.timeline).toEqual(['save-locked', 'commit']);
    });

    it('defers notification dispatch to the caller native transaction commit without blocking its return', async () => {
        const test = manualIncidentTest({}, null, true);
        await test.service.upsertIncident({ channelId: '5' } as never, manualIncidentInput());
        expect(test.subscriber.awaitCommit).toHaveBeenCalledOnce();
        expect(test.worker.dispatch).not.toHaveBeenCalled();
        test.queryRunner.isTransactionActive = false;
        test.commit();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(test.worker.dispatch).toHaveBeenCalledWith(11);
    });

    it('does not dispatch a manual incident whose caller native transaction rolls back', async () => {
        const test = manualIncidentTest({}, null, true);
        await test.service.upsertIncident({ channelId: '5' } as never, manualIncidentInput());
        test.queryRunner.isTransactionActive = false;
        test.rollback();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(test.worker.dispatch).not.toHaveBeenCalled();
    });

    it('keeps other incident source semantics even when its event name is the manual failure name', async () => {
        const test = serviceTest();
        const result = await test.service.upsertIncident(null, {
            ...manualIncidentInput(),
            sourceType: 'OtherSource',
        });
        expect(result).toMatchObject({ incidentStatus: 'OPEN', deliveryStatus: 'PENDING' });
        expect(test.worker.dispatch).toHaveBeenCalledOnce();
    });
    it('does not reclaim a pending incident and alerts immediately when a sent incident becomes critical', async () => {
        const existing = {
            id: 5,
            occurrenceCount: 1,
            severity: 'P1',
            deliveryStatus: 'SENT',
            sentAt: new Date(),
            payload: {},
            silent: true,
        };
        const test = serviceTest({ findOne: vi.fn().mockResolvedValue(existing) });
        const input = {
            eventType: 'inventory.variant.low',
            category: 'INVENTORY',
            severity: 'P0' as const,
            fingerprint: 'stock:5',
            title: '缺货',
        };
        await test.service.upsertIncident(null, input);
        expect(existing).toMatchObject({ deliveryStatus: 'PENDING', silent: false });
        expect(test.worker.dispatch).toHaveBeenCalledTimes(1);
        await test.service.upsertIncident(null, input);
        expect(test.worker.dispatch).toHaveBeenCalledTimes(1);
    });

    it('returns an existing one-off record for the same deduplication key', async () => {
        const existing = { id: 7, dedupKey: 'order:7', deliveryStatus: 'SENT' };
        const test = serviceTest({ findOne: vi.fn().mockResolvedValue(existing) });

        const result = await test.service.enqueueOneOff(null, {
            eventType: 'commerce.order.placed',
            category: 'ORDER',
            severity: 'P3',
            dedupKey: 'order:7',
            title: '新订单',
        });

        expect(result).toBe(existing);
        expect(test.repository.save).not.toHaveBeenCalled();
        expect(test.worker.dispatch).not.toHaveBeenCalled();
    });

    it('persists P0 routing and priority before dispatching the durable record', async () => {
        const test = serviceTest();

        const result = await test.service.enqueueOneOff(null, {
            eventType: 'system.database.down',
            category: 'SYSTEM',
            severity: 'P0',
            dedupKey: 'database:incident-1',
            title: '数据库中断',
            payload: { password: 'must-not-persist', error: 'connection failed' },
        });

        expect(result).toMatchObject({
            id: 11,
            ownerDepartmentCode: 'TECH',
            escalationDepartmentCode: 'EXEC',
            actionRequired: true,
            priority: 100,
            silent: false,
            payload: { error: 'connection failed' },
        });
        expect(test.worker.dispatch).toHaveBeenCalledWith(11);
        expect(test.repository.save.mock.invocationCallOrder[0]).toBeLessThan(
            test.worker.dispatch.mock.invocationCallOrder[0],
        );
    });

    it('does not allow a sent one-off record to be retried', async () => {
        const test = serviceTest({
            findOne: vi.fn().mockResolvedValue({ id: 4, deliveryStatus: 'SENT' }),
        });

        await expect(test.service.retryDelivery('4')).rejects.toThrow('只能重试失败或死信');
        expect(test.repository.save).not.toHaveBeenCalled();
    });

    it('aggregates a repeated incident and sends a new reminder so the group is notified', async () => {
        const occurredAt = new Date('2026-09-03T11:00:00.000Z');
        const existing = {
            id: 8,
            occurrenceCount: 1,
            lastOccurredAt: new Date('2026-09-03T10:00:00.000Z'),
            payload: {},
            title: '库存不足',
            severity: 'P1',
            sentAt: new Date('2026-09-03T09:00:00.000Z'),
            telegramMessageId: '88',
            deliveryAction: 'SEND',
            deliveryStatus: 'SENT',
            availableAt: new Date('2026-09-03T10:00:00.000Z'),
            claimedAt: null,
            claimedBy: null,
        };
        const test = serviceTest({ findOne: vi.fn().mockResolvedValue(existing) });

        const result = await test.service.upsertIncident(null, {
            eventType: 'inventory.variant.low',
            category: 'INVENTORY',
            severity: 'P1',
            fingerprint: 'inventory:variant-8',
            title: '库存仍然不足',
            payload: { saleableStock: 1 },
            occurredAt,
        });

        expect(result).toMatchObject({
            occurrenceCount: 2,
            deliveryAction: 'SEND',
            deliveryStatus: 'PENDING',
            payload: { saleableStock: 1 },
        });
        expect(test.worker.dispatch).toHaveBeenCalledWith(8);
    });

    it('persists a new incident even when Telegram delivery is disabled', async () => {
        const test = serviceTest({}, { enabled: false });

        const result = await test.service.upsertIncident(null, {
            eventType: 'system.database.down',
            category: 'SYSTEM',
            severity: 'P0',
            fingerprint: 'database:offline-notification-channel',
            title: '数据库中断',
        });

        expect(result).toMatchObject({ incidentStatus: 'OPEN', deliveryStatus: 'SKIPPED' });
        expect(test.repository.save).toHaveBeenCalled();
        expect(test.incidentResponse.appendSystemEvidence).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ id: 11 }),
            'CREATED',
            expect.any(String),
            expect.any(Object),
            expect.any(Date),
        );
        expect(test.worker.dispatch).not.toHaveBeenCalled();
    });
});

function serviceTest(
    repositoryOverrides: Record<string, unknown> = {},
    configOverrides: Record<string, unknown> = {},
) {
    const repository = {
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockImplementation(value => {
            if (value.id == null) value.id = 11;
            return Promise.resolve(value);
        }),
        ...repositoryOverrides,
    };
    const connection = {
        rawConnection: { options: { type: 'sqljs' }, getRepository: vi.fn().mockReturnValue(repository) },
        getRepository: vi.fn().mockReturnValue(repository),
        withTransaction: vi.fn((ctxOrWork: unknown, maybeWork?: (ctx: unknown) => unknown) => {
            const work = typeof ctxOrWork === 'function' ? ctxOrWork : maybeWork;
            return Promise.resolve(work?.({}));
        }),
    };
    const configService = {
        get: vi.fn().mockResolvedValue({
            enabled: true,
            tokenConfigured: true,
            chatId: '-1001',
            minSeverity: 'P3',
            notifyOrderEvents: true,
            notifyPaymentEvents: true,
            notifyFulfillmentEvents: true,
            notifyRefundEvents: true,
            notifyInventoryEvents: true,
            p0RepeatMinutes: 30,
            p1RepeatMinutes: 120,
            p1EscalationMinutes: 60,
            p2Silent: true,
            p3Silent: true,
            routeOverrides: [],
            ...configOverrides,
        }),
        shouldDeliver: vi.fn().mockReturnValue(true),
    };
    const worker = { dispatch: vi.fn().mockResolvedValue(true) };
    const incidentResponse = { appendSystemEvidence: vi.fn().mockResolvedValue(undefined) };
    return {
        connection,
        configService,
        repository,
        worker,
        incidentResponse,
        service: new AdminNotificationService(
            connection as never,
            configService as never,
            worker as never,
            incidentResponse as never,
        ),
    };
}

function manualIncidentInput(eventType = 'commerce.fulfillment.manual_delivery_failed') {
    return {
        eventType,
        category: 'FULFILLMENT',
        severity: 'P1' as const,
        sourceType: 'ManualDigitalDelivery',
        sourceId: '1',
        fingerprint: `${eventType}:1`,
        title: 'Synthetic test delivery failure',
        payload: { channelId: '5', orderId: '37', deliveryId: '1' },
    };
}

function manualIncidentTest(
    deliveryOverrides: Record<string, unknown> = {},
    existing: Record<string, unknown> | null = null,
    callerTransaction = false,
) {
    const test = serviceTest({ findOne: vi.fn().mockResolvedValue(existing) });
    const timeline: string[] = [];
    const queryRunner = { isTransactionActive: callerTransaction };
    const delivery = { id: '1', channelId: '5', orderId: '37', state: 'EMAIL_FAILED', ...deliveryOverrides };
    const taskQuery = {
        where: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(delivery),
    };
    const taskTarget = class NativeManualDeliveryTarget {};
    const taskRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(taskQuery),
        manager: { queryRunner },
    };
    const orderRepository = { findOne: vi.fn().mockResolvedValue({ id: '37', salesChannelId: '5' }) };
    const channelRepository = {
        findOne: vi.fn().mockResolvedValue({ id: '5', code: 'Synthetic', customFields: {} }),
    };
    const getRepository = (_ctx: unknown, target: unknown) =>
        target === taskTarget
            ? taskRepository
            : target === Order
              ? orderRepository
              : target === Channel
                ? channelRepository
                : test.repository;
    let commit: () => void = () => undefined;
    let rollback: () => void = () => undefined;
    const commitPromise = new Promise<void>((resolve, reject) => {
        commit = resolve;
        rollback = () => reject(new Error('native rollback'));
    });
    const subscriber = Object.assign(Object.create(TransactionSubscriber.prototype), {
        awaitCommit: vi.fn().mockReturnValue(commitPromise),
    });
    Object.assign(test.connection.rawConnection, {
        getMetadata: vi.fn().mockReturnValue({ target: taskTarget }),
        subscribers: [subscriber],
    });
    test.connection.getRepository.mockImplementation(getRepository);
    let depth = 0;
    test.connection.withTransaction.mockImplementation(
        async (ctxOrWork: unknown, maybeWork?: (ctx: unknown) => unknown) => {
            const work = typeof ctxOrWork === 'function' ? ctxOrWork : maybeWork;
            depth += 1;
            queryRunner.isTransactionActive = true;
            try {
                return await work?.({});
            } finally {
                depth -= 1;
                if (!depth && !callerTransaction) {
                    queryRunner.isTransactionActive = false;
                    timeline.push('commit');
                }
            }
        },
    );
    test.repository.save.mockImplementation(value => {
        expect(queryRunner.isTransactionActive).toBe(true);
        timeline.push('save-locked');
        if (value.id == null) value.id = 11;
        return Promise.resolve(value);
    });
    test.worker.dispatch.mockImplementation(() => {
        expect(queryRunner.isTransactionActive).toBe(false);
        timeline.push('dispatch-after-commit');
        return Promise.resolve(true);
    });
    return { ...test, taskQuery, orderRepository, timeline, queryRunner, subscriber, commit, rollback };
}
