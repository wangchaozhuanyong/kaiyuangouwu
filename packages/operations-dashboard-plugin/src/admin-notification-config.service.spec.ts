import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import { AdminNotificationConfigAudit } from './entities/admin-notification-config-audit.entity';
import { AdminNotificationConfig } from './entities/admin-notification-config.entity';

describe('AdminNotificationConfigService', () => {
    it('writes an actor-attributed audit in the same transaction and masks the chat id', async () => {
        const config = new AdminNotificationConfig({
            id: 1,
            key: 'telegram-internal',
            enabled: false,
            chatId: null,
            adminBaseUrl: null,
            timezone: 'Asia/Kuala_Lumpur',
            minSeverity: 'P3',
            sendResolved: true,
            p2Silent: true,
            p3Silent: true,
            notifyOrderEvents: true,
            notifyPaymentEvents: true,
            notifyFulfillmentEvents: true,
            notifyRefundEvents: true,
            notifyInventoryEvents: true,
            inventoryLowThreshold: 2,
            p1EscalationMinutes: 60,
            p0RepeatMinutes: 30,
            p1RepeatMinutes: 120,
            departmentMentions: {},
            routeOverrides: [],
            botUsername: null,
            lastConnectionAt: null,
            lastConnectionError: null,
        });
        const configRepository = {
            findOne: vi.fn().mockResolvedValue(config),
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        };
        const auditRepository = {
            save: vi.fn().mockImplementation(value => Promise.resolve(value)),
        };
        const manager = {
            getRepository: vi.fn((entity: unknown) =>
                entity === AdminNotificationConfig ? configRepository : auditRepository,
            ),
        };
        const rawConnection = {
            getRepository: manager.getRepository,
            transaction: vi.fn(work => work(manager)),
        };
        const service = new AdminNotificationConfigService(
            { rawConnection } as never,
            { configured: () => false } as never,
        );

        await service.update({ enabled: true, chatId: '-100123456' }, 'admin-7');

        expect(rawConnection.transaction).toHaveBeenCalledOnce();
        expect(configRepository.save).toHaveBeenCalledWith(config);
        expect(auditRepository.save).toHaveBeenCalledOnce();
        const audit = auditRepository.save.mock.calls[0][0] as AdminNotificationConfigAudit;
        expect(audit).toMatchObject({ actorUserId: 'admin-7', action: 'UPDATED' });
        expect(audit.changes).toMatchObject({
            enabled: { before: false, after: true },
            chatId: { before: null, after: '-***3456' },
        });
        expect(JSON.stringify(audit.changes)).not.toContain('-100123456');
    });

    it('rejects non-scalar chat ids instead of coercing them', async () => {
        const config = new AdminNotificationConfig({ key: 'telegram-internal', chatId: null });
        const configRepository = { findOne: vi.fn().mockResolvedValue(config) };
        const rawConnection = {
            getRepository: vi.fn().mockReturnValue(configRepository),
            transaction: vi.fn(),
        };
        const service = new AdminNotificationConfigService(
            { rawConnection } as never,
            { configured: () => false } as never,
        );

        await expect(service.update({ chatId: {} as never })).rejects.toThrow(
            'Telegram Chat ID 必须是数字字符串',
        );
        expect(rawConnection.transaction).not.toHaveBeenCalled();
    });
});
