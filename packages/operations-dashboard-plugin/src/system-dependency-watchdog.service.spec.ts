import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { SystemDependencyWatchdog } from './system-dependency-watchdog.service';

describe('SystemDependencyWatchdog', () => {
    it('sends one direct P0 alert after two consecutive database failures', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const watchdog = createWatchdog({
            query: vi.fn().mockRejectedValue(new Error('database unavailable')),
            sendMessage,
        });

        await watchdog.check();
        expect(sendMessage).not.toHaveBeenCalled();
        await watchdog.check();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId: '-1001',
                silent: false,
                text: expect.stringContaining('[危急]'),
            }),
        );
    });

    it('reports dead notification rows directly instead of relying on the broken queue', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const watchdog = createWatchdog({
            query: vi.fn().mockResolvedValue([{ result: 1 }]),
            dead: 2,
            sendMessage,
        });

        await watchdog.check();
        await watchdog.check();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringMatching(/\[重要\][\s\S]*失败待处理：2/u),
            }),
        );
    });

    it('respects the global security switch and the recovery-notification policy', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const disabled = createWatchdog({
            query: vi.fn().mockRejectedValue(new Error('database unavailable')),
            config: { notifySecurityEvents: false },
            sendMessage,
        });
        await disabled.check();
        await disabled.check();
        expect(sendMessage).not.toHaveBeenCalled();
        const query = vi
            .fn()
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValue([{ result: 1 }]);
        const mutedRecovery = createWatchdog({ query, sendMessage, config: { sendResolved: false } });
        for (let i = 0; i < 4; i++) await mutedRecovery.check();
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('immediately notifies a pipeline severity upgrade and supplies Chinese time and entry', async () => {
        let fresh = true;
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const watchdog = createWatchdog({
            query: vi.fn().mockResolvedValue([{ result: 1 }]),
            dead: 1,
            backlog: 2,
            runtime: vi.fn(() =>
                Promise.resolve({ heartbeatAt: new Date(Date.now() - (fresh ? 0 : 120000)) }),
            ),
            config: { adminBaseUrl: 'https://console.example/dashboard' },
            sendMessage,
        });
        await watchdog.check();
        await watchdog.check();
        expect(sendMessage.mock.calls[0][0].text).toContain('[重要]');
        fresh = false;
        await watchdog.check();
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0].text).toContain('[危急]');
        expect(sendMessage.mock.calls[1][0].text).toContain('时间：');
        expect(sendMessage.mock.calls[1][0].text).toContain(
            'https://console.example/dashboard/settings/system-ops',
        );
    });
});

function createWatchdog(options: {
    query: ReturnType<typeof vi.fn>;
    dead?: number;
    backlog?: number;
    runtime?: ReturnType<typeof vi.fn>;
    config?: { notifySecurityEvents?: boolean; sendResolved?: boolean; adminBaseUrl?: string };
    sendMessage: ReturnType<typeof vi.fn>;
}) {
    const deliveryRepository = {
        count: vi.fn(({ where }: { where: { deliveryStatus: unknown } }) =>
            Promise.resolve(where.deliveryStatus === 'DEAD' ? (options.dead ?? 0) : (options.backlog ?? 0)),
        ),
        findOne: vi.fn().mockResolvedValue(null),
    };
    const runtimeRepository = { findOne: options.runtime ?? vi.fn().mockResolvedValue(null) };
    const connection = {
        rawConnection: {
            query: options.query,
            getRepository: vi.fn((entity: unknown) =>
                entity === AdminNotificationDelivery ? deliveryRepository : runtimeRepository,
            ),
        },
    };
    const configService = {
        cachedConfig: vi.fn().mockReturnValue({ enabled: true, chatId: '-1001', ...options.config }),
    };
    const telegram = {
        configured: vi.fn().mockReturnValue(true),
        sendMessage: options.sendMessage,
    };
    return new SystemDependencyWatchdog(
        connection as never,
        { isServer: true } as never,
        configService as never,
        telegram as never,
    );
}
