import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationService } from './admin-notification.service';

describe('AdminNotificationService', () => {
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

    it('aggregates a repeated incident and edits its existing Telegram message', async () => {
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
            deliveryAction: 'EDIT',
            deliveryStatus: 'PENDING',
            payload: { saleableStock: 1 },
        });
        expect(test.worker.dispatch).toHaveBeenCalledWith(8);
    });
});

function serviceTest(repositoryOverrides: Record<string, unknown> = {}) {
    const repository = {
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockImplementation(value => {
            if (value.id == null) value.id = 11;
            return Promise.resolve(value);
        }),
        ...repositoryOverrides,
    };
    const connection = {
        rawConnection: { getRepository: vi.fn().mockReturnValue(repository) },
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
        }),
        shouldDeliver: vi.fn().mockReturnValue(true),
    };
    const worker = { dispatch: vi.fn().mockResolvedValue(true) };
    return {
        repository,
        worker,
        service: new AdminNotificationService(connection as never, configService as never, worker as never),
    };
}
